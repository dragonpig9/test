# CommonHours

> **Recognise value that gets overlooked.**
> Turn the skills your community already has into help everyone can access, with clear agreements and shared accountability.

CommonHours is a community service-exchange website for the HacKU fintech hackathon. Members trade tutoring, cooking, translation, design, repairs and more using **time credits** (1 hour = 1 credit, whatever the skill). They find each other through **consented vouches**, agree **terms before work starts**, and resolve disagreements **against those terms** using randomly selected community attestors.

There is no blockchain, no cryptocurrency, no cash conversion and no AI scoring. Every balance, permission, score and decision comes from backend rules (`apps/api/src/config/policy.ts`) and persisted records, and every change is written to an audit trail in the same database transaction.

---

## Quick start

Requirements: Node.js ≥ 20, npm ≥ 10, and Docker (or any PostgreSQL 14+).

```bash
npm install                         # installs all workspaces and generates the Prisma client
cp .env.example apps/api/.env       # local settings, no real secrets
npm run db:up                       # starts PostgreSQL 16 in Docker (port 5432)
npm run db:setup                    # applies migrations + seeds the demo community
npm run dev                         # API on :4000, web on :5173
```

Open http://localhost:5173 and click **Mei Chen** under "Demo account switcher". All seeded accounts use the password `commonhours-demo` (emails: `<handle>@demo.commonhours.test`).

Without Docker: point `DATABASE_URL` in `apps/api/.env` at any PostgreSQL database the user can create tables in, then run `npm run db:setup`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) + web (Vite) together |
| `npm run db:up` / `db:down` | Start / stop the Docker PostgreSQL |
| `npm run db:migrate` | `prisma migrate deploy` |
| `npm run db:seed` | Wipe and re-seed the demo community (same as the **Reset demo** button) |
| `npm test` | API unit + integration tests against `commonhours_test` (created automatically) |
| `npm run typecheck` | TypeScript checks for shared, API and web |
| `npm run build` | Production build of the web app |
| `npx tsx apps/api/scripts/inspect.ts` | Print balances, scores, edges and disputes, and check the lot invariant |

### Deploying

One **Render** Blueprint (`render.yaml`) runs the web app, the API and PostgreSQL under a single URL. Cloudflare Pages for the web app is an optional alternative. Step by step: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Stack

React 18 + TypeScript + Vite + Tailwind CSS + React Flow (`@xyflow/react`) on the front end. Node.js + Express + TypeScript + Prisma 6 + PostgreSQL on the back end. JWT auth with bcrypt-hashed passwords. Zod schemas in `packages/shared` validate requests on the server and inform the web forms. npm workspaces: `apps/web`, `apps/api`, `packages/shared`.

The earlier "Subscription Hunter" starter was not relevant to this problem and lives unchanged in `legacy/subscription-hunter/`. Its teal palette carried over.

---

## Three-minute demo

The **Demo guide** (top bar → "Demo guide", also on the Overview page) tracks progress from the database and offers one-click "Switch to …" buttons. Every step calls the real API.

| # | Act as | Do this | What to point at |
| --- | --- | --- | --- |
| 1 | Mei | **Service Board** → Category *Cooking*, tick "reachable only" → *Home-cooked Malaysian dinner* | Reachability: "3 hops · strength 0.49" |
| 2 | Mei | **Trust Network** → From Mei, To Sam | Path Mei → Alice → Ben → Sam, `0.7 × 1 × 0.7 = 0.49`, backwards-walk note |
| 3 | Mei | Click **Inspect** on Alice → Mei | Strength, age, status, liability 25% → max 5 points |
| 4 | Mei → Sam | Request the dinner (2h). On the exchange, **Propose reciprocal exchange**: 1h maths tutoring. Switch to Sam and accept both | Two separate exchanges, linked |
| 5 | Mei | **Time Credits** | Posted vs reserved vs available (Mei: 0 − 2 = −2, allowed) |
| 6 | either | **+1d** on the simulated clock, then both confirm both exchanges | Settlement. Net change Mei −1, Sam +1 |
| 7 | Sam → Mei | Sam requests Mei's *Mandarin ↔ English translation* with **Punctuality is a required condition** ticked. Mei accepts | A new, unsettled exchange |
| 8 | Sam | **+1d**, then *Open a dispute* → "was late" | Allowed only because punctuality was agreed |
| 9 | Sam | Dispute page | Credits **frozen**. Eligibility table with exclusion reasons and the recorded seed |
| 10 | selected attestors | First attestor votes *Unclear* (escalates to a panel of 3); two panel members vote *Confirmed* | Resolution + settlement |
| 11 | Mei | Time Credits / My Credibility / Activity | Ledger entry, score history 33 → 37 → 41, audit events with rule ids |
| 12 | Mei | **My Credibility** shows "Invite new members" unlocked (≥ 40) → Trust Network → *My vouches & invitations* → Create invitation | Permission earned from records |

Edge cases to show:
- **Credit floor:** switch to Ben → My Exchanges → Kofi's 3h washing-machine repair → *Accept*. The backend blocks it because Ben's available balance would go from −3 to −6, below −5.
- **Insufficient attestors:** Disputes → *All community* → Kofi–Lena kettle dispute. It is in **NEEDS_REVIEW** with frozen credits, a blocker ("only 2 eligible for 3 panel seats") and a next action.
- **Expiry:** Tomás's three oldest earned credits expired when the demo clock was set. Use **+7d** to watch his next lot expire.
- **Reset demo** restores the seeded state in about 4 seconds.

---

## What's in the box

See **[docs/FEATURE_MAP.md](docs/FEATURE_MAP.md)** for every feature's files, models, endpoints, rules and tests, and **[docs/DEBUGGING.md](docs/DEBUGGING.md)** for common failures.

```
apps/api/src/
  config/        env.ts, policy.ts   ← every adjustable rule value + rule ids
  core/          db (transactions, row locks), errors, context (domain clock), state-machine, rng, request log
  modules/<feature>/  *.routes.ts · *.service.ts (business operations) · *.rules.ts (pure rules) · *.repo.ts (queries/views)
apps/api/prisma/ schema.prisma, migrations/, seed.ts
apps/api/test/   unit + integration + demo-scenario tests
apps/web/src/
  features/<feature>/  pages, components, api hooks
  components/    UI primitives (cards, status chips, "Why?" explanations, timeline)
  lib/           API client (errors with code/module/correlation id), auth context, formatting
packages/shared/src/  types/ (DTOs, error codes), validation/ (zod)
```

### Implemented

- **Invite-only membership.** Alice is the documented **bootstrap member**: she founded the community without a voucher. Invitations carry strength and liability and show the maximum penalty. Joining requires accepting the community terms and the vouch terms, and only then is the vouch activated.
- **Vouches** as directed edges (voucher → vouchee) with strength 0.4 / 0.7 / 1.0, liability 10 / 25 / 50%, creation date, last qualifying interaction, expiry and status (pending / active / declined / expired / revoked). Vouching requires the vouchee's consent. There is a limit of 5 active + pending vouches + open invitations. Amendments need the counterparty's consent, and raising liability needs the voucher's fresh consent. Revocation is available to either party.
- **Trust graph and path finder.** An undirected view of active edges. BFS shortest path with deterministic tie-breaks (highest strength, then alphabetical handles). Connection strength is the product of effective strengths. Decay ×0.5 after 12 months without a settled exchange between the pair; expiry after 18 months. Disconnected members are shown, and a keyboard-accessible table view sits alongside the graph.
- **Listings** (offers and requests) are kept separate from **exchanges**. Discovery filters by category and active reachability. Exchange terms cover provider and recipient, deliverable, duration, scheduled time, punctuality condition, credit amount (1h = 1 credit), an optional gift bonus from the recipient (shown separately), cancellation notice and terms, and the confirmation deadline. Terms are versioned: an edit resets the other side's acceptance, and nothing can change after acceptance.
- **Ledger.** Balanced double-entry transactions with system accounts for expiry and adjustments. Reservations on acceptance, under a row-level lock so concurrent acceptances cannot bypass the −5 floor. Settlement is atomic and duplicate-proof (state check, row lock and unique idempotency key). Disputes freeze reservations; refuted disputes release them without payment. Cancellation and partial completion are supported.
- **Credit expiry.** Fully implemented as a dated-lot model. Earned positive credits expire after 12 months, oldest are spent first, debts never expire, and units backing open reservations are protected. Each expiry posts a balanced EXPIRY transaction with an explanation. The sweep runs on clock advance (or `POST /api/demo/sweeps`). There is no background scheduler, so in a real deployment it would run from cron.
- **Credibility.** A deterministic five-factor formula with a breakdown, calculation strings, history snapshots, final-finding penalties, permissions and "to unlock" guidance. Thresholds gate inviting/vouching (40), attesting (30), the guarantor requirement (< 20) and restricted categories (Equipment repair, 25).
- **Disputes and attestation.** One state machine. Eligibility rules with per-candidate reasons. Seeded random selection with the seed recorded (fixed in demo mode). Single attestor → panel of 3 on *Unclear* → majority of 2. **NEEDS_REVIEW** for insufficient candidates, no quorum or a split panel, with a next action. Members can retry selection, resolve mutually, recuse, or declare conflicts.
- **Withdrawal.** Remove listings, cancel, partial completion, revoke vouches, leave the community. Leaving blocks new commitments but keeps accepted exchanges, disputes, debts and history.
- **Audit.** A domain audit event in the same transaction for every credit, credibility, vouch and exchange change, with actor, action, entity, before/after, reason, rule id + policy version and correlation id. The Activity page shows these.
- **Demo mode.** Account switcher, simulated clock (+1d / +7d / +30d, which also runs sweeps), reset button and a state-driven guide.
- **Debug panel** (development builds only). Nine tabs backed by `/api/debug/*`. Errors carry a human message, a stable code, the module and a correlation id. Password hashes and tokens are never returned.

### Honest limitations

- **Guarantor:** "a guarantor is required" is implemented as "an active incoming vouch with effective strength ≥ 0.7". There is no separate co-signing workflow.
- **Misconduct findings:** the `MISCONDUCT_FINDING` penalty kind exists in the model, but no UI or endpoint creates one. That needs a governance process this MVP doesn't define, so nobody can be penalised for misconduct yet.
- **NEEDS_REVIEW** has no admin/steward override by design (the system never picks a winner). The only exits are a re-run selection or mutual agreement, so a dispute can stay frozen indefinitely in a very small community.
- **Mutual resolution outcomes carry no penalty**, even "refuted", because they are a settlement between the parties rather than a finding.
- **No reversal workflow for settled exchanges.** Disputes must be opened before settlement.
- Sweeps (expiry, vote deadlines) run on clock advance or on demand, not on a background schedule.
- Evidence is text only (no file uploads). There are no notifications or emails.
- The simulated clock is global (one per server), which suits a single-presenter demo, not multi-tenant use.
- Mobile layouts work, but the graph is best on desktop. A table view is provided for small screens and keyboard users.
- The production web bundle is about 560 kB (React Flow included). It is not code-split beyond the debug panel.

---

## The fairness rule

**Rule:** every hour of service earns exactly one credit, whatever the service. The credit floor is −5, and disputes are judged only against terms both members accepted before the work began.

**Who it protects.** People whose skills the market undervalues (cooking, care, translation, gardening) get the same hourly value as tutoring or design. Newcomers with no savings can receive help straight away (down to −5). Providers are protected from moving goalposts, because complaints about things never agreed ("they were late" when punctuality wasn't a condition) are rejected outright.

**Who bears the cost.** Members with scarce, market-priced skills give up price signals. An hour of electrical repair buys the same as an hour of dog walking, so some may choose not to participate. Generous givers bear the expiry cost: Tomás earns but rarely spends, so his oldest credits expire. Vouchers carry bounded reputational liability for people they vouch for. The community also absorbs up to 5 credits of unpaid debt per member who leaves in deficit.

**Where it can fail.**
- **Collusion:** two members can confirm fake exchanges to farm credits and credibility. The floor and vouch limits bound the damage but do not prevent it.
- **Small or tightly knit communities:** independence can't be staffed, and disputes sit in NEEDS_REVIEW. The demo shows exactly this.
- **Graph distance is not independence.** Friends outside the network look "far". Declared conflicts and recusal rely on honesty.
- **Agreements written vaguely** ("help with garden") leave attestors little to judge, so the rule is only as good as the terms.
- **Credibility rewards activity**, which can disadvantage members who are less able to give time, even though their contributions are equally valuable.
