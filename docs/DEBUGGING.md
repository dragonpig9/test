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
| Graph shows a member as disconnected | Their only edges are expired/revoked/pending, or they left | `vouch.rules.ts` `effectiveEdge`, `trust.service.ts` | Inspect the edges in the table view or Debug → Trust edges |

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
- **Seeded selection** in demo mode is derived from handles + scheduled time, so a reset replays the same attestors.
