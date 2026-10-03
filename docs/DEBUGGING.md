# Debugging CommonHours

## Where to look first

1. **The error box in the UI** shows a human message, a stable **code**, the **module**, and a **correlation id**.
2. **Debug panel** (the "Debug" button, bottom right, dev builds only):
   - *API requests & errors* lists browser and server calls with codes and correlation ids.
   - *Ledger* shows `ledgerBalanced` and per-member `lotInvariantOk`.
   - *Attestor eligibility* recomputes every dispute's eligibility now.
   - *Policy* shows the active `POLICY` values.
3. **Audit trail:** filter by correlation id in the Activity page (expand an event) or in SQL:
   ```sql
   SELECT "occurredAt", module, action, summary, "ruleId" FROM "AuditEvent"
   WHERE "correlationId" = '<id>' ORDER BY seq;
   ```
4. **Server log:** `npm run dev` prints 5xx errors as `[correlationId] METHOD path -> status CODE message`.
5. **State dump:** `npx tsx apps/api/scripts/inspect.ts` prints balances, the lot check, scores, edges, the Mei→Sam path and disputes.

## Common failures

| Symptom / code | Likely cause | Files | Fix |
| --- | --- | --- | --- |
| "Cannot reach the CommonHours API" (`NETWORK_ERROR`) | API not running, or not on :4000 | `apps/web/vite.config.ts`, `apps/api/src/server.ts` | `npm run dev`; check `API_PORT` |
| `P1001` / "Can't reach database server" | PostgreSQL not running or wrong `DATABASE_URL` | `apps/api/.env`, `docker-compose.yml` | `npm run db:up`; `docker compose ps` |
| Tables missing / `P2021` | Migrations not applied | `apps/api/prisma/migrations` | `npm run db:migrate` |
| Empty app / no demo members | Not seeded | `apps/api/prisma/seed.ts` | `npm run db:seed` or **Reset demo** |
| `UNAUTHENTICATED` after reset | Old JWT points to a deleted member id | `apps/web/src/lib/auth.tsx` | Pick an account again in the switcher (the token is replaced) |
| `CREDIT_FLOOR_EXCEEDED` | Expected rule: available − amount < −5. `details` holds posted/reserved/requested | `modules/ledger/ledger.service.ts` `reserveCredits` | Not a bug; earn credits or reduce the duration/gift |
| `SERVICE_NOT_YET_DUE` | Confirm/dispute/partial before `scheduledAt` | `modules/exchanges/exchange.rules.ts` `isDue` | Press **+1d** on the simulated clock |
| `TERMS_VERSION_MISMATCH` | Other party edited the terms after you loaded the page | `exchange.service.ts` `acceptExchange` | Reload and review the new version |
| `PUNCTUALITY_NOT_AGREED` | Lateness dispute on an exchange without the punctuality condition | `attestation.service.ts` `openDispute` | Expected; dispute a different condition |
| Dispute stuck in `NEEDS_REVIEW` | Too few eligible attestors, deadline passed, or split panel | `attestation.eligibility.ts`, `attestation.service.ts` `runSelection` | Read `reviewReason`; retry selection or resolve mutually |
| `CREDIBILITY_TOO_LOW` / `VOUCH_LIMIT_REACHED` | Threshold or slot rule | `credibility.rules.ts` `permissionsFor`, `policy.ts` | Check My Credibility → Permissions → "To unlock" |
| `INVALID_TRANSITION` | Action not allowed from the current state; `details.allowed` lists the valid targets | `core/state-machine.ts`, `exchange.state.ts`, `attestation.state.ts` | Refresh; the UI only enables allowed actions |
| `ALREADY_DONE` (409) | Duplicate confirm/vote/settle blocked | `ledger.service.ts` (idempotency key), `exchange.service.ts` | Expected; nothing was applied twice |
| `CONFLICT` (409) "changed while you were acting" | Two concurrent writes; the conditional update lost | `exchange.service.ts` `transition` | Retry |
| Interactive transaction timeout | Long lock wait (e.g. many concurrent requests) | `core/db.ts` `withTx` (20s timeout) | Retry; check for stuck sessions in `pg_stat_activity` |
| `ledgerBalanced: false` or `lotInvariantOk: false` | A bug in a ledger write path | `ledger.service.ts` `postTransfer`, `ledger.rules.ts` | Run `npm test`; inspect the latest `LedgerTransaction` rows |
| Tests fail to create `commonhours_test` | DB user lacks `CREATEDB` | `apps/api/test/global-setup.ts` | Create it manually: `createdb commonhours_test` (Docker's default user can) |
| `TASK_LOCKED` | Provider fails a task requirement (score, relationship trust, verified contact, or owner approval at final acceptance) | `modules/task-eligibility/eligibility.rules.ts`, `eligibility.service.ts` `assertTaskEligible` | Read `details.eligibility.checks`; Debug → Task eligibility; owner presses *Approve home access* |
| `REQUIREMENT_TOO_LOW` | Requester set a minimum below the tier/category minimum | `eligibility.rules.ts` `assertRequesterRequirements` | Expected; raise it or leave empty |
| `BUDGET_EXCEEDED` | Quote total > requester's max budget | `exchange.service.ts` `assertBudget`, `pricing.rules.ts` | Expected; shorten, drop gift, raise budget |
| Price looks wrong | Skill tier or demand inputs | `pricing.service.ts` `demandFor`, `pricing.skills.ts` `effectiveSkillTier` | Debug → Pricing shows demand inputs per category, tiers and every exchange's quote/snapshot |
| Price changed after acceptance | Must never happen: accepted exchanges read `priceSnapshot` | `pricing.service.ts` `pricingOf` | Compare `pricingQuote`/`priceSnapshot` in Debug → Pricing |
| Trust did not increase | Exchange was disputed/partial/cancelled, pair window (2 per 30 days) or cap 0.7 reached; or the earned edge is weaker than an existing path (relationship trust never decreases) | `trust.earned.rules.ts`, `trust.earned.ts` | Debug → Trust updates: every row has `applied` and `reason`; one row per exchange (unique) |
| Jury pick looks surprising | Ranking is by closeness, not score | `attestation.eligibility.ts` `rankCandidates` | Debug → Jury candidates: closeness, rank, inclusion/exclusion reasons and the stored snapshot |
| No notification | Event deduplicated, or the transaction rolled back (nothing is sent for rolled-back changes) | `notification.events.ts`, `core/db.ts` `afterCommit` | Debug → Notifications shows dedupe keys; server log `[afterCommit]` |
| Email not sent | Not opted in, address unverified, demo preview, or SMTP failure | `notification.service.ts`, `email.provider.ts` | Debug → Notifications: delivery mode (no secrets), outbox status, `lastError`, attempts |
| `VERIFICATION_FAILED` | Wrong/expired code, or email delivery disabled outside demo | `profiles/profile.verification.ts` | Send a new code; configure `EMAIL_PROVIDER` |
| Graph shows a member as disconnected | Their only edges are expired/revoked/pending, or they left | `vouch.rules.ts` `effectiveEdge`, `trust.service.ts` | Inspect the edges in the table view or Debug → Trust edges |

| `UNIVERSITY_DOMAIN_MISMATCH` / student email 400 | Address does not end in the selected university's domain | `packages/shared/src/universities.ts`, `modules/student/student.rules.ts` | Expected; pick the right university |
| University code “cannot be sent” | Production without `EMAIL_PROVIDER` (no dev preview there) | `modules/student/student.verification.ts` | Configure email |
| Pool not distributed | No member with activity points, or < 0.01 per recipient (retained), or run already COMPLETED | `community-pool.service.ts`, `PoolDistribution.inputs` | `GET /api/daily-job/runs`; inspect the distribution's `inputs` |
| Daily job did not run at midnight | Host slept, or `DAILY_JOB_SCHEDULER=false` without cron | `daily-job.scheduler.ts`, `scripts/run-daily-job.ts` | Run the script; FAILED runs show `lastError` and retry safely |
| No close-friend reminder | ≤ 50 days, already sent this period, balance recovered by the pool payout, or member left | `negative-balance.service.ts` | Query `NegativeBalancePeriod` |

## Useful commands

```bash
npm test                                   # all API tests (uses commonhours_test)
npx vitest run test/ledger.integration.test.ts   # (from apps/api) one file
npm run typecheck
npx prisma studio --schema apps/api/prisma/schema.prisma   # browse tables
curl -s localhost:4000/api/health
curl -s -X POST localhost:4000/api/demo/reset
```

## Design notes that help when debugging

- **Domain clock:** services never call `new Date()` for decisions. They use `ctx.now` from `SystemState.simulatedNow` (`core/context.ts`). If times look wrong, check the demo clock.
- **Every write goes through `withTx`,** and `recordAudit` is called with the same `tx`. A failed request leaves neither the change nor its audit event behind.
- **Lock order:** exchange row → reservation row → ledger accounts (sorted by id). Keep this order in new code to avoid deadlocks.
- **Seeded selection** in demo mode is derived from handles + scheduled time, so a reset replays the same attestors (ranking by closeness first, the seed only orders equal closeness).
- **After-commit side effects:** `notify()` queues work with `afterCommit`; `withTx` runs it after the commit and swallows/logs errors. Tests call `deliverOutbox()` explicitly; `setEmailProviderForTests` injects a fake provider.
- **Two graphs:** `TrustSnapshot.graph` (vouches only, BFS hops: discovery and the attestor ≥2-hop rule) and `relGraph` (vouch + earned combined per pair, strongest path: relationship trust everywhere else).
