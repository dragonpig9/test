# CommonHours

> **Recognise value that gets overlooked.**
> Turn the skills your community already has into help everyone can access, with clear agreements and shared accountability.

**Find your circle. Share your skills. Build trust through helping.** CommonHours connects quality members through useful, niche communities, with an emphasis on trust, connection and meaningful exchanges.

CommonHours is a community service-exchange website for the HacKU fintech hackathon. Members trade tutoring, cooking, translation, design, repairs and more using **time credits** (1 hour = 1 credit by default; a peer-reviewed skill tier and measured demand can raise the price within published bounds). They find each other through **consented vouches**, agree **terms before work starts**, and resolve disagreements **against those terms** using randomly selected community attestors.

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

## Simple demo for judges (`/demo`)

**Submission link: `https://<your-host>/demo`.** It opens straight into a guided walkthrough, signed in as Mei through the existing demo switcher (no registration, mailbox or invitation). It turns the 15-step Demo Guide below into five chapters with the real actions embedded:

| Chapter | Guide steps | What the judge sees and does |
| --- | --- | --- |
| 1 · Find help and understand trust | 1–4 | Sam's offer, the live Mei → Alice → Ben → Sam path, Alice's vouch (base, liability backing, max penalty), Mei's credibility and the locked cat-sitting task |
| 2 · Agree, reserve and complete | 5–8 | Propose cooking (2h) and tutoring (1h), accept as Sam, see reservations, advance the shared clock explicitly, confirm, then a before/after table read from records |
| 3 · Skill and demand pricing | 9 | Sam requests translation with punctuality agreed; the backend quote (tier × demand) and the locked price after Mei accepts |
| 4 · Resolve a dispute | 10–12 | Sam's punctuality dispute, frozen credits, selected jurors (full table under Details), "Acting as …" before each vote |
| 5 · See the results | 13–15 | Settlements vs pool rewards, credibility changes, audit trail, Mei's invitation (with liability consent), notifications and email previews |

Back/Next only change the chapter shown; ticks come from backend records. Completed examples show their saved result. Nothing resets data: the walkthrough reads `GET /api/demo/walkthrough` (read-only, demo mode only) and acts through the ordinary API as the acting member. "Explore edge cases" covers home-access approval, peer-reviewed skill tiers, the credit floor, NEEDS_REVIEW and expiry. The full app (with the original Demo guide) stays one click away.

**Demo readiness.** A reset rebuilds the shared community step by step, so the server tracks `SystemState.demoStatus`: `INITIALIZING` from before the tables are truncated until the seed, its housekeeping and the edge-case fixture checks have finished, then `READY` (with a new seed version), or `FAILED` with the reason. While it is not READY the walkthrough answers `503 DEMO_PREPARING`/`DEMO_FAILED`, every write is refused, and the daily job and background tick skip. `/demo` polls `GET /api/demo/readiness`, shows "Preparing demo examples…" (bounded, then a Retry), and drops its cached data when a new seed completes. On start-up, `seed-if-empty` re-seeds a preparation that never finished and re-creates a missing floor proposal or skill claim through the ordinary services; history-bound examples (the kettle dispute, processed expiry) are reported, never fabricated.

## Hackathon demo (`DEMO_MODE=true`)

`DEMO_MODE` is one server setting (`apps/api/src/config/demo-mode.ts`, read from the environment only; browsers cannot switch it through storage, headers or query strings). `GET /api/health` reports it to the web app. With it on, verification never blocks access: no email links, codes, documents or manual checks, and no blocking banners. Everything else (invitation codes, credibility thresholds, the credit floor, pricing, the pool) is unchanged. Demo admission is recorded separately (`Member.demoAdmittedAt`); verified flags are never set, and those members show **Demo student** / **Demo member** instead of a verified badge. Set `DEMO_MODE=false` and the original verification applies again on the next request, for existing sessions and circle memberships too.

Five-minute flow:

| # | Do this | What to point at |
| --- | --- | --- |
| 1 | Sign out → **Join as a student** | No invitation code anywhere |
| 2 | Pick **HKU**, type a username (placeholder `XXX`), switch to CUHK and back | The suffix `@connect.hku.hk` changes, the username stays, the full address is previewed |
| 3 | Tick the current-student declaration → **Join** | Straight into the app; "Demo student" label; the notice says nothing was emailed |
| 4 | **Circles** → HKU Circle | Joined automatically (demo/self-declared). Seeded posts from Priya and Ben, topic tags (Coding, Tutoring, Language practice, Moving and practical help) |
| 5 | Post a message with a tag; open the circle board | Persisted chat; requests and offers from circle members filtered by tag |
| 6 | Request a service from Priya or Ben, switch accounts (demo bar), accept, **+1d**, both confirm | A normal exchange: same pricing, reservation and settlement |
| 7 | **Overview → Friends activity** | Month and year selectors (Hong Kong time); credits earned, credits spent and activity points for you and your direct friends; ⓘ explains the points |
| 8 | **Overview** banner / **My Profile → Badges** | "First Exchange" celebration; toggle whether others see your badges |

## Three-minute demo

The **Demo guide** (top bar → "Demo guide", also on the Overview page) tracks progress from the database and offers one-click "Switch to …" buttons. Every step calls the real API.

| # | Act as | Do this | What to point at |
| --- | --- | --- | --- |
| 1 | Mei | **Service Board** → Category *Cooking*, tick "reachable only" → *Home-cooked Malaysian dinner* | Reachability "3 hops · strength 0.5776", tier badge *Restricted*, price estimate |
| 2 | Mei | **Trust Network** → From Mei, To Sam | Strongest path Mei → Alice → Ben → Sam: each pair combines vouch + earned relationship, `0.76 × 1 × 0.76 = 0.5776`; violet dotted lines = earned relationships |
| 3 | Mei | Click **Inspect** on Alice → Mei | Strength, age, status, liability 10% → max 2 points (earned edges carry no liability). Alice → Ben carries 20% liability: 1.0 × 1.2 is capped at 1 |
| 4 | Mei | **Service Board** → Alice's *Feed my cat and water plants while I'm away* | **🔒 locked high-trust task**: needs credibility 35, Mei has 33; *How to unlock* shows every check, the owner-approval condition and how to become eligible |
| 5 | Mei → Sam | Request the dinner (2h). On the exchange, **Propose reciprocal exchange**: 1h maths tutoring. Switch to Sam and accept both | Two separate exchanges, each with a price breakdown and eligibility card |
| 6 | Mei | **Time Credits** | Posted vs reserved vs available (Mei: 0 − 2 = −2, allowed) |
| 7 | either | **+1d**, then both confirm both exchanges | Settlement. Net change Mei −1, Sam +1 |
| 8 | Mei | Tutoring exchange → **Earned trust** card; **Service Board**; 🔔 | Mei ↔ Sam: 0 → 0.2 → 0.28 (applied once; confirming again or reloading changes nothing). Credibility 33 → 37, so Alice's task is **unlocked** (owner approval still needed) and a "High trust tasks unlocked" notification appears |
| 9 | Sam → Mei | Sam requests Mei's *Mandarin ↔ English translation* (1h) with **Punctuality is a required condition** ticked. Mei accepts | **Skilled, high-demand price**: 1 h × 1.50 (Advanced, peer-reviewed by Priya) × 1.20 (3 unique requests ÷ 1 provider) = **1.8 credits**, locked at acceptance |
| 10 | Sam | **+1d**, then *Open a dispute* → "was late" | Allowed only because punctuality was agreed |
| 11 | Sam | Dispute page | Credits **frozen** (1.8). Jury table: exclusion reasons, closeness = max(relationship trust to each party), rank, and "Selected because this member meets the reliability requirement and has limited connections to either party." |
| 12 | selected jurors | First juror votes *Unclear* (escalates to a panel of 3); two panel members vote *Confirmed* | Resolution + settlement |
| 13 | Mei | Time Credits / My Credibility / Activity | Ledger entry, score history 33 → 37 → 41, audit events with rule ids |
| 14 | Mei | **My Credibility** shows "Invite new members" unlocked (≥ 40) → Trust Network → *My vouches & invitations* → Create invitation | Permission earned from records |
| 15 | Mei | **Overview** → 🔔 **Notifications** → **Account** | Home-screen notifications (accepted, settled, trust change, unlocked tasks, dispute, outcome), mark all as read, and the **email outbox** previews (demo mode never sends real email) |

New features (development: the demo bar also shows **Next 00:00 HKT** and **Run daily job**):

| Feature | How to demonstrate |
| --- | --- |
| Student registration | Sign out → **Join with an invitation** → *Register as a student*: pick HKU, type `chantaiman`, pick CUHK (suffix changes, username kept), paste `x@connect.hku.hk` (only `x` stays), tick the declaration. Existing members: **My Profile → Student details** (Mei is a seeded CityU student, unverified) → *Send a code* → copy it from the development preview → *Verify*. Change the university: the status returns to *not verified*. |
| Friends activity | Overview → **Friends activity**. Settle the Mei ↔ Sam exchanges (demo steps 5–7): both gain 1 point (two exchanges, same day, same person = 1); credits earned and spent are shown separately. Pick an earlier month to see history. |
| Pool | Overview → Community Credit Pool shows 5 credits (Tomás's expired credits). After step 7, press **Next 00:00 HKT**: Mei and Sam are tied on 1 point → ceil(2 ÷ 2) = 1 recipient chosen by the date seed, paid 5; **Run daily job** again says nothing was repeated. |
| Negative-balance reminders | The first daily run notifies close friends of seeded members negative for 50+ days (e.g. Mei sees “Alice Okafor could use an opportunity…”). |

Edge cases to show:
- **Credit floor:** switch to Ben → My Exchanges → Kofi's 3h washing-machine repair → *Accept*. The backend blocks it because Ben's available balance would go from −3 to −6, below −5.
- **Insufficient attestors:** Disputes → *All community* → Kofi–Lena kettle dispute. It is in **NEEDS_REVIEW** with frozen credits, a blocker ("only 2 eligible for 3 panel seats") and a next action.
- **Expiry:** Tomás's three oldest earned credits expired when the demo clock was set. Use **+7d** to watch his next lot expire.
- **High-trust approval:** after step 8, Mei offers to do Alice's cat-sitting. Accepting is blocked until Alice presses **Approve home access**; once both accept, only Mei sees Alice's private address on the exchange.
- **Pricing edge cases:** Alice's request shows "waiting for a provider" (no offers in *Other*: ×1.00, no division by zero); categories with fewer than 2 unique requests show "insufficient data" (×1.00).
- **Reset demo** restores the seeded state in about 6 seconds.

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
- **Vouches** as directed edges (voucher → vouchee) with strength 0.4 / 0.7 / 1.0, liability 10 / 20 / 30%, creation date, last qualifying interaction, expiry and status (pending / active / declined / expired / revoked). Vouching requires the vouchee's consent. There is a limit of 5 active + pending vouches + open invitations. Amendments need the counterparty's consent, and raising liability needs the voucher's fresh consent. Revocation is available to either party.
- **Liability backing.** Liability is no longer only a risk for the voucher: the more of it they accept, the more their vouch counts for the new member. The policy maps 10% → ×1.0, 20% → ×1.2 and 30% → ×1.4 (`POLICY.vouches.liabilityStrengthMultipliers`). `backedStrength = min(1, baseStrength × liabilityMultiplier)` and `effectiveStrength = backedStrength × decayFactor` once the edge has decayed. Effective strength feeds the vouched member's credibility, trust paths and the guarantor check. Example: a 0.7 vouch counts as 0.7 at 10%, 0.84 at 20% and 0.98 at 30%, and 0.49 at 30% after it decays. The voucher's penalty stays liability% × 20 points (2, 4 or 6). Liability stored before this mapping (25% or 50%) uses the nearest lower tier (×1.2 or ×1.4).
- **Trust graph and path finder.** An undirected view of active edges. BFS shortest path with deterministic tie-breaks (highest strength, then alphabetical handles). Connection strength is the product of effective strengths. Decay ×0.5 after 12 months without a settled exchange between the pair; expiry after 18 months. Disconnected members are shown, and a keyboard-accessible table view sits alongside the graph.
- **Listings** (offers and requests) are kept separate from **exchanges**. Discovery filters by category and active reachability. Exchange terms cover provider and recipient, deliverable, duration, scheduled time, punctuality condition, credit amount (1h = 1 credit), an optional gift bonus from the recipient (shown separately), cancellation notice and terms, and the confirmation deadline. Terms are versioned: an edit resets the other side's acceptance, and nothing can change after acceptance.
- **Ledger.** Balanced double-entry transactions with system accounts for expiry and adjustments. Reservations on acceptance, under a row-level lock so concurrent acceptances cannot bypass the −5 floor. Settlement is atomic and duplicate-proof (state check, row lock and unique idempotency key). Disputes freeze reservations; refuted disputes release them without payment. Cancellation and partial completion are supported.
- **Credit expiry.** Fully implemented as a dated-lot model. Earned positive credits expire after 12 months, oldest are spent first, debts never expire, and units backing open reservations are protected. Each expiry posts a balanced EXPIRY transaction into the **Community Credit Pool**. It runs in the daily job (00:00 Hong Kong) and on demo clock advance.
- **Credibility.** A deterministic five-factor formula with a breakdown, calculation strings, history snapshots, final-finding penalties, permissions and "to unlock" guidance. Thresholds gate inviting/vouching (40), attesting (30), the guarantor requirement (< 20) and restricted categories (Equipment repair, 25).
- **Disputes and attestation.** One state machine. Eligibility rules with per-candidate reasons. Seeded random selection with the seed recorded (fixed in demo mode). Single attestor → panel of 3 on *Unclear* → majority of 2. **NEEDS_REVIEW** for insufficient candidates, no quorum or a split panel, with a next action. Members can retry selection, resolve mutually, recuse, or declare conflicts.
- **Withdrawal.** Remove listings, cancel, partial completion, revoke vouches, leave the community. Leaving blocks new commitments but keeps accepted exchanges, disputes, debts and history.
- **Audit.** A domain audit event in the same transaction for every credit, credibility, vouch and exchange change, with actor, action, entity, before/after, reason, rule id + policy version and correlation id. The Activity page shows these.
- **Demo mode.** Account switcher, simulated clock (+1d / +7d / +30d, which also runs sweeps), reset button and a state-driven guide.
- **Task eligibility.** Standard (0) / Restricted (25, in a home with the owner present) / High trust (35, entering a home while the owner is absent) tiers on member credibility, plus optional requester-set minimum credibility (raise only) and relationship trust. High trust also needs a verified contact and the owner's explicit per-exchange approval. Enforced before acceptance and before any reservation; locked tasks show required vs current score, conditions and how to unlock.
- **Explainable pricing.** service credits = hours × skill × demand (+ optional gift), integer hundredths, one half-up rounding. Skill tiers (×1.00 / 1.25 / 1.50 / 2.00) only via peer review; demand = clamp(1 + 0.1 × (unique active requests ÷ eligible providers − 1), 1.0, 1.5) from real listings. Requester budgets; price snapshot locked at acceptance; the −5 floor applies to the full amount.
- **Earned trust (bug fix).** Exchanges both members confirm create/strengthen a separate earned relationship (0.2, then +0.10 × (1 − old), cap 0.7, at most 2 counted per pair per 30 days, applied exactly once per exchange, no liability). Relationship trust is the **strongest path** (Dijkstra on −log strength), so a new weak edge never lowers it.
- **Less-connected jury.** Existing filters plus availability, then lowest closeness = max(relationship trust to either party); ties randomised by the recorded seed; snapshot of reasons stored with every selection.
- **Profiles.** Photo URL, intro, affiliation, neighbourhood, languages, skills and tiers, availability, completed services, credibility breakdown and contact-verification status — self-reported, verified and record-based data shown separately. Email, phone and address private by default.
- **Notifications.** Persistent in-app notifications (bell, list, home-screen card, mark read) written after commit with dedupe keys; optional email via a persisted outbox with retries and a Gmail/SMTP adapter; per-member opt-in and categories.
- **Student registration.** “Register as a student” on the Join page (and *Student details* on My Profile for existing members): eight university buttons (HKU, CUHK, HKUST, PolyU, CityU, HKBU, Lingnan, EdUHK) with full names, keyboard and touch friendly; username field with the university's domain as a fixed suffix (placeholder `XXX`), full-address preview, no duplicate domain or extra `@`. The mapping lives only in `packages/shared/src/universities.ts`; the API re-validates it. Ownership is proven by an expiring, single-use 6-digit code; changing university/email resets verification; a current-student declaration is stored separately. Development-only preview codes are never labelled verified.
- **Two ways to join.** *Join with an invitation* (code still validated, vouch terms as before) and *Join as a student* (no code, no invitation or inviter created, the usual new-member rules). Student accounts must verify their university email unless demo mode is on.
- **University circles** ("HKU Circle" …). One room per university with persisted messages and topic tags, plus a board of circle members' requests and offers. Entry needs genuine university email verification, or a self-declared affiliation in demo mode. Access is checked on every request; changing university keeps history but moves access. Circle membership creates no friendships, vouches, credibility or relationship strength.
- **Friends activity** on the home screen, by calendar month (Asia/Hong_Kong): you + accepted direct friends with credits earned and credits spent from settled service transfers (provider and recipient counted separately, refunds subtracted; pool rewards, expiry, gifts and admin adjustments excluded) and activity points (1 per qualifying settled service, at most 1 per pair per Hong Kong day and 2 per pair per month, across roles). Equal points share a rank. Points are separate from credits, credibility and relationship strength, and are read-only.
- **Badges.** *First Exchange* (once) and *Community Regular* (a month with points on 3+ Hong Kong days with 2+ different people). In-app celebration; members choose whether others see them. No economic, trust or permission effect.
- **Community Credit Pool and daily job.** Expired credits flow into a never-expiring pool. Every day at 00:00 Asia/Hong_Kong the server (no browser needed) expires due credits, snapshots the last 7 days of activity for the whole community (separate from the monthly Friends activity view), and pays the top ceil(active ÷ 2) members equally: floor(pool ÷ recipients) hundredths each, remainder retained (108 ÷ 456 → 0.23 each, 104.88 paid, 3.12 kept). Ties use a date-seeded shuffle; inputs are recorded. One transaction, unique run/distribution/grant rows, so retries never pay twice.
- **Close-friend reminders.** A continuous negative *posted* balance period is tracked on every ledger posting (partial repayment keeps the timer, reaching 0 resets it). After the daily redistribution, members negative for more than 50 days get up to 3 closest friends (relationship strength) notified once per period — no balance or task details — or a private reminder if no friend qualifies.
- **Debug panel** (development builds only). Thirteen tabs backed by `/api/debug/*` (incl. task eligibility, pricing, trust updates, jury candidates, notifications & email). Errors carry a human message, a stable code, the module and a correlation id. Password hashes and tokens are never returned.

### Honest limitations

- **Guarantor:** "a guarantor is required" is implemented as "an active incoming vouch with effective strength ≥ 0.7". There is no separate co-signing workflow.
- **Misconduct findings:** the `MISCONDUCT_FINDING` penalty kind exists in the model, but no UI or endpoint creates one. That needs a governance process this MVP doesn't define, so nobody can be penalised for misconduct yet.
- **NEEDS_REVIEW** has no admin/steward override by design (the system never picks a winner). The only exits are a re-run selection or mutual agreement, so a dispute can stay frozen indefinitely in a very small community.
- **Mutual resolution outcomes carry no penalty**, even "refuted", because they are a settlement between the parties rather than a finding.
- **No reversal workflow for settled exchanges.** Disputes must be opened before settlement.
- Vote-deadline sweeps run on clock advance or on demand. Credit expiry runs in the daily job; on hosts that sleep idle services (Render free) the in-process timer can miss midnight — use an always-on plan or the cron script (docs/DEPLOYMENT.md).
- University email verification needs a real email provider in production (`EMAIL_PROVIDER`); the on-screen code preview is development-only. Email ownership does not prove enrolment, so enrolment stays self-declared.
- Expired credits recorded before the pool existed stay on the legacy `SYSTEM_EXPIRY` account; only new expiries feed the pool.
- Evidence is text only (no file uploads).
- **Phone verification is not implemented** (no SMS provider): phones always show "not verified". Profile photos are an https URL, not an upload.
- In demo mode without email credentials, contact verification codes appear in the on-screen email preview, so those addresses are labelled **demo-verified** (they count for high-trust tasks only in demo mode).
- Reminders and email retries run on a one-minute server timer; a multi-instance deployment would need a single worker for that timer.
- A pricing quote is fixed per terms version when saved; if demand changes before both accept, the quote is not refreshed automatically (editing the terms re-quotes).
- Databases created before this release: run `npx tsx apps/api/scripts/backfill-earned-trust.ts` once to replay earned trust for past confirmed exchanges.
- The simulated clock is global (one per server), which suits a single-presenter demo, not multi-tenant use.
- Mobile layouts work, but the graph is best on desktop. A table view is provided for small screens and keyboard users.
- The production web bundle is about 560 kB (React Flow included). It is not code-split beyond the debug panel.

---

## Policy defaults (`policy-2026.10-v4`, all in `apps/api/src/config/policy.ts`)

| Area | Default |
| --- | --- |
| Task tiers (member credibility, 0–100) | Standard **0** · Restricted **25** (in a home, owner present) · High trust **35** (entering a home, owner absent) + verified contact + explicit owner approval per terms version. Category minimum (Equipment repair 25) still applies. Required = max(tier, category, requester minimum). Requesters may add a relationship-trust minimum (0–1). |
| Price | base = hours × 100 (hundredths) · service = round½↑(base × skill% × demand% / 10 000) · total = service + gift. One rounding step, integers only. |
| Skill tiers | Standard ×1.00 · Skilled ×1.25 (1 review) · Advanced ×1.50 (1 review) · Specialist ×2.00 (2 reviews). Reviewers: credibility ≥ 40, not the claimant, no declared conflict; any decline closes the claim. |
| Demand | Window 45 days. ratio = unique unmatched requesters ÷ active providers with an open offer meeting the category minimum. demand = clamp(1 + 0.10 × (ratio − 1), 1.00, 1.50). < 2 unique requesters → ×1.00 "insufficient data"; 0 providers → ×1.00 "waiting for a provider". Duplicate requests from one person count once; expired (older) requests are excluded. |
| Vouch liability | Options 10 / 20 / 30%. Voucher penalty after a final nonperformance finding = liability% × 20 points. Strength multiplier 10% → ×1.0 · 20% → ×1.2 · 30% → ×1.4; backed = min(1, strength × multiplier); decayed edges then × 0.5. |
| Earned trust | New relationship 0.2; then old + 0.10 × (1 − old); cap 0.7; ≤ 2 increases per pair per 30 days; decays ×0.5 after 12 idle months, expires after 18. Only exchanges both confirmed in full. |
| Relationship trust | Strongest path: max Π edge strength (Dijkstra on −log), pair = 1 − (1 − vouch)(1 − earned); ties: fewer hops, then handles. |
| Jury | Existing filters + available (jury opt-in, < 2 open assignments); rank by closeness = max(relationship trust to each party), rounded to 0.01, lowest first; ties by seeded shuffle. |
| Daily job | 00:00 `Asia/Hong_Kong` (`POLICY.schedule`). Order: expiry → activity snapshot + pool distribution → negative-balance reminders. |
| Activity points | Window 7 HK days (`POLICY.activity.windowDays`); 1 point per distinct counterparty per day; ≤ 2 per pair per window. |
| Community pool | Recipients = ceil(active ÷ 2); payment = floor(pool ÷ recipients) in 0.01 units; minimum 0.01; remainder retained. |
| Negative balance | Reminder when negative for **more than** 50 days (`POLICY.negativeBalance`), up to 3 closest friends, once per period. |
| Notifications | After-commit, deduplicated; email opt-in, verified address only, retries 1 m / 5 m / 30 m / 2 h then FAILED. |

## The fairness rule

**Rule:** every hour of service earns one credit by default, whatever the service. Premiums exist only for peer-reviewed skill tiers and measured demand, are capped (at most ×2.00 × 1.50), shown in a breakdown before acceptance, and locked once both accept. The credit floor is −5, and disputes are judged only against terms both members accepted before the work began.

**Who it protects.** People whose skills the market undervalues (cooking, care, translation, gardening) get the same hourly value as tutoring or design. Newcomers with no savings can receive help straight away (down to −5). Providers are protected from moving goalposts, because complaints about things never agreed ("they were late" when punctuality wasn't a condition) are rejected outright.

**Who bears the cost.** Members with scarce, market-priced skills give up most price signals (premiums are capped at ×2.00 for skill and ×1.50 for demand, and need peer review). An hour of electrical repair buys the same as an hour of dog walking, so some may choose not to participate. Generous givers bear the expiry cost: Tomás earns but rarely spends, so his oldest credits expire. Vouchers carry bounded reputational liability for people they vouch for. The community also absorbs up to 5 credits of unpaid debt per member who leaves in deficit.

**Where it can fail.**
- **Collusion:** two members can confirm fake exchanges to farm credits and credibility. The floor and vouch limits bound the damage but do not prevent it.
- **Small or tightly knit communities:** independence can't be staffed, and disputes sit in NEEDS_REVIEW. The demo shows exactly this.
- **Graph distance is not independence.** Friends outside the network look "far". Declared conflicts and recusal rely on honesty.
- **Agreements written vaguely** ("help with garden") leave attestors little to judge, so the rule is only as good as the terms.
- **Credibility rewards activity**, which can disadvantage members who are less able to give time, even though their contributions are equally valuable.
