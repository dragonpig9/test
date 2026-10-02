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

## 4. Trust graph & path finder
- **Purpose:** an undirected view of active vouches, BFS shortest path, connection strength.
- **Frontend:** `WEB/features/trust-graph/{TrustNetworkPage,TrustGraph,PathPanel,EdgeDetails,MemberProfile,layout,api}.ts(x)`
- **Backend:** `API/modules/trust/{trust.graph,trust.service,trust.routes}.ts`
- **Models:** reads `Member`, `Vouch`
- **Endpoints:** `GET /api/trust/graph`, `GET /api/trust/path?from&to`
- **Rules:** only effectively ACTIVE edges count; ties broken by highest strength, then alphabetical handles; strength = Π effective strengths; members who have left are excluded.
- **Test:** `test/rules.unit.test.ts` (trust graph), demo scenario (0.49).
- **Depends on:** vouches (`effectiveEdge`).

## 5. Services (listings)
- **Purpose:** offers/requests and discovery by category and reachability.
- **Frontend:** `WEB/features/services/{ServiceBoardPage,NewListingForm,api}.tsx`
- **Backend:** `API/modules/services/{listing.rules,listing.service,listing.routes}.ts`
- **Models:** `Listing`
- **Endpoints:** `GET /api/listings?category&type&reachableOnly&mine&owner`, `GET /api/listings/:id`, `POST /api/listings`, `POST /api/listings/:id/withdraw`
- **Rules:** restricted category "Equipment repair" needs credibility ≥ 25 to offer/provide; removing a listing never affects exchanges.
- **Depends on:** trust, credibility.

## 6. Exchanges
- **Purpose:** agreed work and its lifecycle.
- **Frontend:** `WEB/features/exchanges/{ExchangesPage,ExchangeDetailPage,TermsForm,api}.tsx`
- **Backend:** `API/modules/exchanges/{exchange.state,exchange.rules,exchange.repo,exchange.service,exchange.routes}.ts`
- **Models:** `Exchange` (incl. `liabilitySnapshot`, `linkedExchangeId`)
- **Endpoints:** `GET/POST /api/exchanges`, `GET /api/exchanges/:id`, `PUT /:id/terms`, `POST /:id/{accept|decline|confirm|cancel|partial|partial/accept}`
- **Rules:** credits = duration × 1/h; gift only from the recipient; terms versioned (`TERMS_VERSION_MISMATCH`); no confirm/dispute before `scheduledAt`; free cancellation until the notice cutoff, then mutual; guarantor rule; actions computed server-side (`availableActions`).
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
- **Rules:** eligibility (not a party, active, ≥2 hops from both, never a direct voucher/invitee, no conflict, score ≥ 30, not previously selected); seeded selection; 1 attestor → panel of 3 on UNCLEAR → majority 2; NEEDS_REVIEW for insufficient candidates / no quorum / split; REFUTED by attestors → provider −15 and each direct voucher from the acceptance snapshot −(pct × 20); PUNCTUALITY only if agreed.
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
- **Endpoints:** `GET /api/debug/{me|policy|trust|exchanges|ledger|credibility|eligibility|requests|audit}`
