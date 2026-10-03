# Feature map

Paths are relative to the repo root. `API` = `apps/api/src`, `WEB` = `apps/web/src`.
All adjustable values live in `API/config/policy.ts` (`POLICY`), and rule identifiers live in `RULES` in the same file. Every audit event records the rule id and `POLICY.version`.

Backend module convention: `*.routes.ts` (HTTP + input validation via shared zod schemas) → `*.service.ts` (business operations, transactions, audit) → `*.rules.ts` (pure rules, unit tested) / `*.repo.ts` (queries and view mapping). Modules call each other's exported functions and never write another module's tables.

Shared state transitions use `API/core/state-machine.ts` (`assertTransition` → `INVALID_TRANSITION` with the allowed states).

---

## 1. Auth & membership
- **Purpose:** JWT sign-in, current member + permissions, invite-only joining.
- **Frontend:** `WEB/features/auth/{LoginPage,JoinPage,api}.tsx`, `WEB/lib/auth.tsx`, `WEB/lib/api.ts`
- **Backend:** `API/modules/auth/{auth.routes,auth.service,auth.middleware}.ts`, `API/modules/members/*`
- **Models:** `Member`
- **Endpoints:** `POST /api/auth/login`, `POST /api/auth/join`, `GET /api/auth/me`, `GET /api/members[/:id]`
- **Rules:** bcrypt (cost 10); the same error for an unknown email and a wrong password; JWT `sub` = member id; `contextMiddleware` attaches the correlation id + domain clock.
- **Test:** `test/demo.scenario.test.ts` (HTTP section).
- **Depends on:** invitations, credibility (permissions).

## 2. Invitations
- **Purpose:** an invite records the inviter's consent (strength, liability). The invitee accepts the community + vouch terms, and only then is the vouch created.
- **Frontend:** `WEB/features/auth/JoinPage.tsx`, `WEB/features/vouching/VouchingPanel.tsx` (InviteModal), `TermsChooser.tsx`
- **Backend:** `API/modules/invitations/{invitation.service,invitation.routes}.ts`
- **Models:** `Invitation`, `Vouch`
- **Endpoints:** `GET/POST /api/invitations`, `POST /api/invitations/:id/revoke`, public `GET /api/invitations/code/:code`
- **Rules:** invite threshold 40 (waived below 6 members: `POLICY.bootstrap`), vouch limit 5, valid for 14 days, `TERMS_NOT_ACCEPTED`.
- **Test:** `test/vouching.integration.test.ts` (threshold), demo scenario (Mei invites).
- **Depends on:** vouches, credibility, ledger (account creation).

## 3. Vouching
- **Purpose:** consented, bounded, revocable vouches. Amendments need fresh consent.
- **Frontend:** `WEB/features/vouching/*`
- **Backend:** `API/modules/vouches/{vouch.rules,vouch.service,vouch.view,vouch.routes}.ts`
- **Models:** `Vouch`, `VouchAmendment`
- **Endpoints:** `GET/POST /api/vouches`, `GET /api/vouches/terms`, `POST /api/vouches/:id/{accept|decline|revoke|amendments}`, `POST /api/vouches/amendments/:id/{accept|decline}`
- **Rules:** strengths 0.4/0.7/1.0; liability 10/25/50% → penalty = pct × 20 points; decay ×0.5 after 12 months idle; expiry after 18 months idle; a settled exchange between the pair refreshes the timers only; strengthening goes one level up, needs ≥1 settled exchange and counterparty consent.
- **Test:** `test/vouching.integration.test.ts`, `test/rules.unit.test.ts` (decay/expiry).
- **Depends on:** credibility (thresholds), audit.

## 4. Trust graph, relationship trust & earned relationships
- **Purpose:** relationship trust = STRONGEST path over active vouches + earned relationships; earned relationships from mutually confirmed exchanges; fewest-hop navigation kept for discovery/attestor distance.
- **Frontend:** `WEB/features/trust-graph/{TrustNetworkPage,TrustGraph,PathPanel,EdgeDetails (EarnedEdgeDetails),TrustUpdateCard,MemberProfile,layout,api}.ts(x)`
- **Backend:** `API/modules/trust/trust.graph.ts` (BFS `shortestPathsFrom`/`hopDistances`, Dijkstra `strongestPathsFrom`, `combinePair`, `buildRelationshipGraph`), `trust.service.ts` (`relationshipTrust`, `relationshipTrustFrom`, `hopsFrom`, `findPath`), `trust.earned.rules.ts` (pure formula, decay, limits), `trust.earned.ts` (`recordEarnedTrust`, exactly once), `trust.view.ts`, `trust.routes.ts`
- **Models:** reads `Member`, `Vouch`; owns `EarnedRelationship`, `TrustUpdate` (unique `exchangeId`)
- **Endpoints:** `GET /api/trust/graph` (incl. `earnedEdges`), `GET /api/trust/path?from&to`, `GET /api/trust/updates?relationship|member`
- **Rules:** pair strength = 1 − (1 − vouch)(1 − earned); path = max product (−log Dijkstra), ties fewer hops then handles; earned: new 0.2, then old + 0.10 × (1 − old), cap 0.7, ≤ 2 increases per pair per 30 days, decay/expiry like vouches; only `confirmCompletion` (both confirmed in full) calls `recordEarnedTrust` — never disputed, partial, cancelled or refuted exchanges; earned edges create no vouch and no liability. Rule id `TRUST.EARNED_EDGE.v1`, `TRUST.STRONGEST_PATH.v2`.
- **Test:** `test/trust.earned.test.ts`, `test/rules.unit.test.ts`, demo scenario (0.5776).
- **Backfill:** `apps/api/scripts/backfill-earned-trust.ts` (idempotent).
- **Depends on:** vouches (`effectiveEdge`).

## 5. Services (listings)
- **Purpose:** offers/requests and discovery by category and reachability.
- **Frontend:** `WEB/features/services/{ServiceBoardPage,NewListingForm,api}.tsx`
- **Backend:** `API/modules/services/{listing.rules,listing.service,listing.routes}.ts`
- **Models:** `Listing`
- **Endpoints:** `GET /api/listings?category&type&reachableOnly&mine&owner`, `GET /api/listings/:id`, `POST /api/listings`, `POST /api/listings/:id/withdraw`
- **Rules:** restricted category "Equipment repair" needs credibility ≥ 25 to offer/provide; requests carry the requester's tier/minimums/budget, offers only a tier; discovery adds `eligibility` (task-eligibility) and `priceEstimate` (pricing); removing a listing never affects exchanges.
- **Depends on:** trust, credibility, task-eligibility, pricing.

## 6. Exchanges
- **Purpose:** agreed work and its lifecycle.
- **Frontend:** `WEB/features/exchanges/{ExchangesPage,ExchangeDetailPage,TermsForm,api}.tsx`
- **Backend:** `API/modules/exchanges/{exchange.state,exchange.rules,exchange.repo,exchange.service,exchange.routes}.ts`
- **Models:** `Exchange` (incl. `liabilitySnapshot`, `linkedExchangeId`)
- **Endpoints:** `GET/POST /api/exchanges`, `GET /api/exchanges/:id` (+ `eligibility`, `trustUpdate`, `homeAddress`), `PUT /:id/terms`, `POST /:id/{accept|decline|confirm|cancel|partial|partial/accept|home-access}`
- **Rules:** credits = pricing quote for the terms version (stored on the exchange, frozen into `priceSnapshot` at acceptance); requirements/budget only set by the recipient; eligibility checked when a provider proposes/accepts and before the reservation; gift only from the recipient; terms versioned (`TERMS_VERSION_MISMATCH`); no confirm/dispute before `scheduledAt`; free cancellation until the notice cutoff, then mutual; guarantor rule; actions computed server-side (`availableActions`).
- **Test:** `test/ledger.integration.test.ts`, `test/disputes.integration.test.ts` (invalid transitions, cancellation).
- **Depends on:** ledger, vouches, credibility, services.

## 7. Credits (ledger)
- **Purpose:** the balanced ledger, reservations, settlement and lots.
- **Frontend:** `WEB/features/credits/{CreditsPage,api}.tsx`
- **Backend:** `API/modules/ledger/{ledger.rules,ledger.repo,ledger.service,ledger.routes}.ts`
- **Models:** `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`, `Reservation`, `CreditLot`
- **Endpoints:** `GET /api/credits/summary`, `GET /api/credits/entries`
- **Rules:** posted = Σ entries; available = posted − (ACTIVE + FROZEN outgoing); new reservation needs available − amount ≥ −5 (row lock on the payer account); settlement uses the idempotency key `settle:<exchangeId>`; Σ lots = max(posted, 0).
- **Test:** `test/ledger.integration.test.ts`, `test/rules.unit.test.ts`.
- **Depends on:** audit.

## 8. Expiry
- **Purpose:** expire positive credit lots after 12 months.
- **Frontend:** lots table on `WEB/features/credits/CreditsPage.tsx`; clock buttons in `WEB/features/demo/DemoBar.tsx`
- **Backend:** `API/modules/expiry/{expiry.rules,expiry.service,expiry.routes}.ts`
- **Models:** `CreditLot`, `LedgerTransaction(kind=EXPIRY)`, system account `SYSTEM_EXPIRY`
- **Endpoints:** `GET /api/expiry/preview`; the sweep runs via `POST /api/demo/clock/advance` or `POST /api/demo/sweeps`
- **Rules:** expirable = max(0, Σ expired lots − reserved outgoing) (FIFO protection); debts never expire.
- **Test:** `test/ledger.integration.test.ts` (credit expiry), `test/rules.unit.test.ts`.

## 9. Credibility
- **Purpose:** an explainable score and permissions.
- **Frontend:** `WEB/features/credibility/CredibilityPage.tsx`, profile summary in `trust-graph/MemberProfile.tsx`
- **Backend:** `API/modules/credibility/{credibility.rules,credibility.repo,credibility.service,credibility.routes}.ts`
- **Models:** `CredibilityPenalty`, `CredibilitySnapshot` (history); inputs from `Exchange`, `Vouch`, `AttestorAssignment`
- **Endpoints:** `GET /api/credibility/me`, `GET /api/credibility/:memberId`
- **Rules:** 4 × completed (cap 10) + 15 × timely-confirmation rate + 20 × min(Σ incoming strength, 1.5) − final-finding penalties + attestation (3/vote, −2/missed, cap 15), clamped 0–100. No history → 0 for history factors. Bootstrap allowance of 1.0. Penalties only from final findings.
- **Test:** `test/rules.unit.test.ts`, `test/disputes.integration.test.ts` (no change on open; penalties on refute).

## 10. Disputes & attestation
- **Purpose:** check whether the pre-agreed activity happened.
- **Frontend:** `WEB/features/disputes/{DisputesPage,DisputeDetailPage,OpenDisputeForm,api}.tsx`
- **Backend:** `API/modules/attestation/{attestation.state,attestation.eligibility,attestation.service,attestation.repo,attestation.routes}.ts`
- **Models:** `Dispute`, `Evidence`, `AttestorSelection`, `AttestorAssignment`, `ConflictDeclaration`
- **Endpoints:** `GET/POST /api/disputes`, `GET /api/disputes/:id`, `POST /:id/{evidence|votes|recuse|retry-selection|mutual}`, `GET/POST /api/conflicts`
- **Rules:** eligibility (not a party, active, available = jury opt-in and < 2 open assignments, ≥2 vouch hops from both, never a direct voucher/invitee, no conflict, score ≥ 30, not previously selected); then rank by closeness = max(relationshipTrust(c, A), relationshipTrust(c, B)) (rounded to 0.01), lowest first, ties by seeded shuffle; snapshot (`AttestorSelection.candidates` with closeness, rank, selectionReason; `method = lowest-closeness-v2`); 1 attestor → panel of 3 on UNCLEAR → majority 2; NEEDS_REVIEW for insufficient candidates / no quorum / split; REFUTED by attestors → provider −15 and each direct voucher from the acceptance snapshot −(pct × 20); PUNCTUALITY only if agreed.
- **Test:** `test/disputes.integration.test.ts`, `test/rules.unit.test.ts` (eligibility), demo scenario.
- **Depends on:** exchanges (markDisputed / settleAfterAttestation / releaseAfterAttestation), trust, credibility.

## 11. Withdrawal
- **Purpose:** leave the community while keeping obligations.
- **Frontend:** `WEB/features/withdrawal/AccountPage.tsx` (sidebar → "Account & leaving")
- **Backend:** `API/modules/withdrawal/{withdrawal.service,withdrawal.routes}.ts`
- **Endpoints:** `GET /api/withdrawal/preview`, `POST /api/withdrawal/leave`
- **Rules:** closes listings, pending proposals, live vouches and open invites; keeps accepted/disputed exchanges, assignments, debts and history; `assertCanCommit` blocks new commitments (`MEMBER_LEFT`).
- **Test:** `test/disputes.integration.test.ts` (withdrawal).

## 12. Audit / Activity
- **Frontend:** `WEB/features/audit/ActivityPage.tsx`, `WEB/components/Timeline.tsx`
- **Backend:** `API/modules/audit/{audit.service,audit.repo,audit.routes}.ts`
- **Models:** `AuditEvent`
- **Endpoints:** `GET /api/audit?scope=mine|all&entityId`
- **Rules:** `recordAudit(tx, ctx, …)` is always called with the same `tx` as the change.
- **Test:** `test/disputes.integration.test.ts` (audit trail).

## 13. Demo
- **Frontend:** `WEB/features/demo/{DemoBar,DemoGuide,api}.tsx`
- **Backend:** `API/modules/demo/{demo.seed,demo.service,demo.routes}.ts`, `apps/api/prisma/seed.ts`
- **Endpoints:** `GET /api/demo/state`, `POST /api/demo/{switch|reset|clock/advance|sweeps}` (only when `DEMO_MODE=true`)
- **Rules:** the seed calls the real services with dated contexts; demo now = 2026-10-01 09:00 UTC; reproducible attestor seed.
- **Test:** `test/demo.scenario.test.ts`.

## 14. Debug
- **Frontend:** `WEB/features/debug/DebugPanel.tsx` (lazy, `import.meta.env.DEV` or `VITE_ENABLE_DEBUG=true`)
- **Backend:** `API/modules/debug/debug.routes.ts`, `API/core/request-log.ts` (when `DEBUG_ENDPOINTS=true` and not production)
- **Endpoints:** `GET /api/debug/{me|policy|trust|exchanges|ledger|credibility|eligibility|task-eligibility|pricing|trust-updates|notifications|requests|audit}`

## 15. Task eligibility
- **Purpose:** who may take which task: member credibility tiers + optional relationship trust; high-trust extras.
- **Frontend:** `WEB/features/task-eligibility/{EligibilityPanel,RequirementFields}.tsx` (render only; thresholds from `GET /api/eligibility/tiers`)
- **Backend:** `API/modules/task-eligibility/{eligibility.rules,eligibility.service,eligibility.routes}.ts`
- **Models:** `Listing.{trustTier,minCredibility,minRelationshipTrust}`, `Exchange.{trustTier,minCredibility,minRelationshipTrust,homeAccessApprovedAt,homeAccessApprovedVersion,eligibilitySnapshot}`
- **Endpoints:** `GET /api/eligibility/tiers`, `GET /api/eligibility/listings/:id`, `POST /api/exchanges/:id/home-access`
- **Rules:** `POLICY.taskEligibility`: STANDARD 0, RESTRICTED 25, HIGH_TRUST 35 (+ verified contact + explicit owner approval per terms version); required = max(tier, category, requester); requester may raise, never lower (`REQUIREMENT_TOO_LOW`); blocked → `TASK_LOCKED` with `details.eligibility`. Newly unlocked tiers notify the member (`credibility.service.refreshCredibility`).
- **Test:** `test/eligibility.test.ts`, demo scenario.

## 16. Pricing & skill tiers
- **Frontend:** `WEB/features/pricing/PriceBreakdown.tsx`, live quote in `WEB/features/exchanges/TermsForm.tsx`, skills on `WEB/features/profiles/ProfilePage.tsx`
- **Backend:** `API/modules/pricing/{pricing.rules (pure),pricing.service (demand, quote, estimator, pricingOf),pricing.skills (claims, reviews, effective tier),pricing.routes}.ts`
- **Models:** `Exchange.{baseCredits,skillTier,skillMultiplierPct,demandMultiplierPct,pricingQuote,priceSnapshot,priceLockedAt,maxCreditBudget}`, `SkillClaim`, `SkillReview`
- **Endpoints:** `GET /api/pricing/quote`, `GET /api/pricing/policy`, `GET/POST /api/pricing/skills`, `GET /api/pricing/skills/reviewable`, `POST /api/pricing/skills/:id/review`
- **Rules:** see README "Policy defaults"; legacy exchanges (`baseCredits = null`) keep their 1 h = 1 credit price.
- **Test:** `test/pricing.test.ts`, demo scenario (3.6 / 1.8).

## 17. Profiles & contact verification
- **Frontend:** `WEB/features/profiles/{ProfilePage,ProfileCard,api}.tsx`; cards reused in trust graph, vouching modal, exchange page; `VerifiedBadge` in `components/MemberChip.tsx`
- **Backend:** `API/modules/profiles/{profile.service (view + privacy + edit),profile.verification (email code),profile.routes}.ts`; `members/member.repo.ts` `toSummary`/`contactVerificationOf`
- **Models:** `Member` profile columns, `EmailVerification`
- **Endpoints:** `GET /api/profiles/me|:id`, `PUT /api/profiles/me`, `POST /api/profiles/me/verify-email/{request|confirm}`, `POST /api/profiles/me/verify-phone/request` (→ `PHONE_VERIFICATION_UNAVAILABLE`)
- **Rules:** contact private by default (shared only with active exchange partners when opted in); exact address only to the provider of an ACCEPTED restricted/high-trust exchange; "verified" only via `email-code`, `demo-preview` labelled demo-verified; changing the address clears verification; audit stores field names only.
- **Test:** `test/profiles.notifications.test.ts`.

## 18. Notifications & email
- **Frontend:** `WEB/features/notifications/{NotificationsPage (+ NotificationBell),NotificationList,NotificationSettings,api}.tsx`; home card in `dashboard/OverviewPage.tsx`; settings + outbox on `withdrawal/AccountPage.tsx`
- **Backend:** `API/modules/notifications/{notification.events (notify),notification.service (records, outbox, delivery, prefs),notification.reminders (sweep),email.provider (adapter),notification.routes}.ts`; `core/db.ts` `afterCommit`; `server.ts` one-minute tick
- **Models:** `Notification` (unique `dedupeKey`), `EmailOutbox` (unique `dedupeKey`, status, attempts, nextAttemptAt), `Member.{emailNotifications,emailCategories}`
- **Endpoints:** `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/{:id/read|read-all}`, `GET/PUT /api/notifications/preferences`, `GET /api/notifications/outbox`
- **Rules:** written only after the business transaction commits; failures are logged and never undo it; email only for opted-in members with a verified address; dispute/jury emails are title-only; no addresses in any notification; PREVIEW in demo without credentials, SKIPPED otherwise; retries 1 m / 5 m / 30 m / 2 h, FAILED after 5.
- **Test:** `test/profiles.notifications.test.ts`.

## 19. Student registration & university email
- **Purpose:** “Register as a student” with university buttons, fixed email suffix, code verification and a separate enrolment declaration.
- **Config:** `packages/shared/src/universities.ts` — the ONLY university ↔ domain mapping (web + API); `packages/shared/src/validation/student.ts` (zod)
- **Frontend:** `WEB/features/student/{UniversityPicker,StudentEmailField,StudentDetailsFields,StudentStatusCard,api}.tsx`; used by `auth/JoinPage.tsx` and `profiles/ProfilePage.tsx`; badge in `profiles/ProfileCard.tsx`
- **Backend:** `API/modules/student/{student.rules (pure),student.service (details),student.verification (codes),student.routes}.ts`; join hook in `invitations/invitation.service.ts`
- **Models:** `Member.{accountType,university,studentEmail (unique),studentEmailVerifiedAt,studentEmailVerifiedVia,studentDeclaredAt}`, `EmailVerification.purpose = "student"`
- **Endpoints:** `GET/PUT /api/students/me`, `POST /api/students/me/verify/{request|confirm}`; `POST /api/auth/join` accepts `student`
- **Rules:** server re-validates domain (`UNIVERSITY_DOMAIN_MISMATCH`/`VALIDATION_FAILED`); code 30 min, 5 attempts, single use, bound to the address; changing university/email clears verification and kills outstanding codes; `dev-preview` only when `NODE_ENV≠production` and never shown as verified.
- **Test:** `test/community.integration.test.ts`, `test/community.rules.test.ts`.

## 20. Activity scoring & friends leaderboard
- **Frontend:** `WEB/features/leaderboard/FriendsLeaderboard.tsx` (Overview)
- **Backend:** `API/modules/activity/{activity.rules (THE scoring function),activity.repo (qualifying exchanges),activity.service,activity.routes}.ts`; friends from `API/modules/trust/trust.friends.ts`
- **Endpoints:** `GET /api/activity/leaderboard`
- **Rules:** SETTLED exchanges (amount > 0, no unresolved dispute) in the last `POLICY.activity.windowDays` HK days; 1 point per (counterparty, day); ≤ `maxPointsPerPairPerWindow` per pair; ranks 1,1,3.

## 21. Community Credit Pool
- **Frontend:** `WEB/features/community-pool/CommunityPoolCard.tsx` (Overview); pool rewards labelled on Time Credits
- **Backend:** `API/modules/community-pool/{community-pool.rules (exact integer math, ranking),community-pool.repo,community-pool.service (distributePool, view),community-pool.routes}.ts`; expiry → pool in `API/modules/expiry/expiry.service.ts`
- **Models:** `LedgerAccountType.SYSTEM_COMMUNITY_POOL`, `LedgerTxKind.POOL_DISTRIBUTION`, `PoolDistribution` (unique runDate, inputs snapshot), `PoolGrant` (unique distribution+member, unique ledger tx)
- **Endpoints:** `GET /api/community-pool`
- **Rules:** recipients = ceil(active/2) from all ACTIVE members (not only friends or students); payment = floor(pool/recipients); remainder retained; < 0.01 each or nobody active → retained; ties by `seededShuffle("community-pool:<date>")`; ledger idempotency key `pool:<date>:<member>`.

## 22. Negative-balance tracking & reminders
- **Backend:** `API/modules/negative-balance/{negative-balance.rules,negative-balance.tracker (called by ledger postTransfer),negative-balance.service (sync + reminders)}.ts`
- **Models:** `NegativeBalancePeriod` (one open per member, partial unique index)
- **Rules:** opens when posted balance crosses below 0, closes at ≥ 0; > 50 days → up to 3 friends by relationship strength (conflicts excluded), else private reminder; `reminderSentAt` + dedupe keys = once per period; audit entry names no member.
- **Script:** `apps/api/scripts/backfill-negative-balance.ts` (the daily job also reconstructs periods from ledger history).

## 23. Daily job orchestration
- **Backend:** `API/modules/daily-job/{daily-job.schedule (pure),daily-job.service (runDailyJob),daily-job.scheduler (in-process timer),daily-job.routes}.ts`; `server.ts` starts the scheduler; `apps/api/scripts/run-daily-job.ts` for external cron
- **Models:** `DailyJobRun` (unique runDate; RUNNING/COMPLETED/FAILED; stale RUNNING re-claimed after 15 min)
- **Endpoints:** `GET /api/daily-job/runs`; demo: `POST /api/demo/clock/advance` runs every crossed 00:00; dev-only `POST /api/demo/clock/next-daily-run`, `POST /api/demo/daily-job/run`
- **Test:** `test/community.integration.test.ts` (retries, concurrency, demo controls).
