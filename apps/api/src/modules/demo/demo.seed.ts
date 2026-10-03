import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import type { CreateListingInput } from '@commonhours/shared';
import { RULES } from '../../config/policy';
import { makeCtx, type Ctx } from '../../core/context';
import { addDays, addHours } from '../../core/dates';
import { withTx, type Tx } from '../../core/db';
import { recordAudit } from '../audit/audit.service';
import { castVote, declareConflict, openDispute } from '../attestation/attestation.service';
import { refreshCredibility } from '../credibility/credibility.service';
import { acceptExchange, confirmCompletion, proposeExchange } from '../exchanges/exchange.service';
import { runCreditExpiry } from '../expiry/expiry.service';
import { createInvitation, joinWithInvitation } from '../invitations/invitation.service';
import { ensureMemberAccount } from '../ledger/ledger.repo';
import { updatePreferences } from '../notifications/notification.service';
import { createSkillClaim, reviewSkillClaim } from '../pricing/pricing.skills';
import { confirmEmailVerification, requestEmailVerification } from '../profiles/profile.verification';
import { createListing } from '../services/listing.service';
import { expireStaleVouches, proposeVouch, respondToVouch } from '../vouches/vouch.service';

/** The simulated "today" the demo starts at. */
export const DEMO_NOW = new Date('2026-10-01T09:00:00.000Z');
/** Shared password for every seeded demo account (documented in README; demo only). */
export const DEMO_PASSWORD = 'commonhours-demo';

export const DEMO_MEMBERS = [
  { handle: 'alice', name: 'Alice Okafor', bio: 'Bootstrap member. Runs the community allotment.', skills: ['Gardening', 'Tutoring'], affiliation: 'Riverside Community Allotment', neighborhood: 'North side', languages: ['English', 'Igbo'], availability: 'Sunday mornings' },
  { handle: 'ben', name: 'Ben Carter', bio: 'Cook and occasional mover of heavy things.', skills: ['Cooking', 'Lifting'], affiliation: 'Community kitchen volunteers', neighborhood: 'East side', languages: ['English'], availability: 'Weekday evenings' },
  { handle: 'priya', name: 'Priya Shah', bio: 'Graphic designer, teaches spreadsheets.', skills: ['Design', 'Spreadsheets'], affiliation: 'Freelance designer', neighborhood: 'Old Town', languages: ['English', 'Gujarati', 'Hindi'], availability: 'Evenings' },
  { handle: 'kofi', name: 'Kofi Mensah', bio: 'Repair café volunteer — bikes and small appliances.', skills: ['Equipment repair'], affiliation: 'High Street Repair Café', neighborhood: 'High Street', languages: ['English', 'Twi'], availability: 'Saturdays 10–14' },
  { handle: 'lena', name: 'Lena Fischer', bio: 'German teacher, new in town.', skills: ['German', 'Translation'], affiliation: 'Adult education college', neighborhood: 'West end', languages: ['German', 'English'], availability: 'Tue/Thu evenings' },
  { handle: 'mei', name: 'Mei Chen', bio: 'Physics student; translates Mandarin ↔ English.', skills: ['Maths', 'Physics', 'Mandarin'], affiliation: 'City University — Physics', neighborhood: 'University quarter', languages: ['Mandarin', 'English'], availability: 'Weekends, flexible online' },
  { handle: 'sam', name: 'Sam Rivera', bio: 'Home cook. Malaysian and Mexican food.', skills: ['Cooking'], affiliation: 'Home cook', neighborhood: 'North side', languages: ['English', 'Spanish', 'Malay'], availability: 'Weekday evenings, Saturdays' },
  { handle: 'tomas', name: 'Tomás Silva', bio: 'Gardener; happy to help with hedges and beds.', skills: ['Gardening'], affiliation: 'Riverside Community Allotment', neighborhood: 'South bank', languages: ['Portuguese', 'English'], availability: 'Weekday mornings' },
] as const;

/** Self-reported profile fields (seeded directly, like bio and skills). */
const profileOf = (m: (typeof DEMO_MEMBERS)[number]) => ({
  bio: m.bio,
  skills: [...m.skills],
  affiliation: m.affiliation,
  location: m.neighborhood,
  languages: [...m.languages],
  availability: m.availability,
});

type Handle = (typeof DEMO_MEMBERS)[number]['handle'];

/** Truncates every table (used by reset and tests). */
export async function truncateAll(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/**
 * Builds the demo community by calling the REAL service functions with dated contexts,
 * so every balance, vouch and score is derived from records (nothing is hard-coded).
 */
export async function seedDemo(prisma: PrismaClient) {
  await truncateAll(prisma);
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids = {} as Record<Handle, string>;
  let n = 0;
  const step = <T>(when: Date | string, actor: Handle | null, fn: (tx: Tx, ctx: Ctx) => Promise<T>) =>
    withTx((tx) => fn(tx, makeCtx(actor ? ids[actor] : null, new Date(when), `seed-${String(++n).padStart(3, '0')}`)));
  const info = (h: Handle) => DEMO_MEMBERS.find((m) => m.handle === h)!;

  // 1. Bootstrap member. Documented exception: Alice founded the community without a voucher.
  await step('2024-09-01T10:00:00Z', null, async (tx, ctx) => {
    const a = info('alice');
    const m = await tx.member.create({
      data: {
        handle: a.handle,
        displayName: a.name,
        email: `${a.handle}@demo.commonhours.test`,
        passwordHash: hash,
        ...profileOf(a),
        // Private: shown only to the provider of an accepted in-home exchange.
        homeAddress: '14 Allotment Lane, Flat 2 (key safe code given in person)',
        isBootstrap: true,
        joinedAt: ctx.now,
      },
    });
    ids.alice = m.id;
    await ensureMemberAccount(tx, m.id, m.displayName);
    await recordAudit(tx, { ...ctx, actorId: m.id }, {
      module: 'demo',
      action: 'member.bootstrap',
      entityType: 'MEMBER',
      entityId: m.id,
      after: { handle: m.handle, isBootstrap: true },
      reason: 'Bootstrap member: the invite-only community has to start with one member who was not invited.',
      ruleId: RULES.DEMO,
      summary: `${m.displayName} founded the community (bootstrap member)`,
    });
    await refreshCredibility(tx, { ...ctx, actorId: m.id }, [m.id], 'bootstrap member created');
  });

  const join = async (inviter: Handle, h: Handle, strength: number, liabilityPct: number, when: string) => {
    const inv = await step(when, inviter, (tx, ctx) =>
      createInvitation(tx, ctx, ids[inviter], { inviteeName: info(h).name, strength, liabilityPct, acknowledgeLiability: true }, `DEMO-${h.toUpperCase()}`),
    );
    const m = await step(addDays(new Date(when), 1), null, (tx, ctx) =>
      joinWithInvitation(
        tx,
        ctx,
        { code: inv.code, displayName: info(h).name, handle: h, email: `${h}@demo.commonhours.test`, password: DEMO_PASSWORD, acceptCommunityTerms: true, acceptVouchTerms: true },
        { passwordHash: hash },
      ),
    );
    ids[h] = m.id;
    await prisma.member.update({ where: { id: m.id }, data: profileOf(info(h)) });
  };

  /** A historical exchange: proposed by the recipient, accepted, delivered, confirmed by both on time. */
  const history = async (p: Handle, r: Handle, hours: number, category: CreateListingInput['category'], deliverable: string, scheduled: string) => {
    const at = new Date(scheduled);
    const ex = await step(addDays(at, -3), r, (tx, ctx) =>
      proposeExchange(tx, ctx, ids[r], {
        counterpartyId: ids[p],
        myRole: 'recipient',
        category,
        deliverable,
        durationMinutes: hours * 60,
        scheduledAt: at.toISOString(),
        location: '',
        punctualityRequired: false,
        giftBonus: 0,
        cancellationNoticeHours: 24,
        cancellationTerms: 'Free cancellation up to 24 hours before.',
        confirmationDays: 3,
      }),
    );
    await step(addDays(at, -2), p, (tx, ctx) => acceptExchange(tx, ctx, ex.id, ids[p], ex.termsVersion));
    await step(addHours(at, hours + 1), p, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids[p]));
    await step(addHours(at, hours + 3), r, (tx, ctx) => confirmCompletion(tx, ctx, ex.id, ids[r]));
    return ex;
  };

  // 2. Invitations (the bootstrap waiver applies while there are fewer than 6 members).
  await join('alice', 'ben', 1.0, 25, '2024-10-01T10:00:00Z');
  await history('ben', 'alice', 1, 'Cooking', 'Batch-cooked soup for the allotment open day', '2024-10-20T12:00:00Z');
  await join('alice', 'priya', 0.7, 10, '2024-11-01T10:00:00Z');
  await history('ben', 'priya', 1, 'Other', 'Help moving a bookcase', '2024-12-05T15:00:00Z');
  await join('priya', 'kofi', 1.0, 25, '2025-01-10T10:00:00Z');
  await history('priya', 'alice', 2, 'Design', 'Poster for the seed swap', '2025-01-20T10:00:00Z');
  await join('kofi', 'lena', 0.7, 10, '2025-02-01T10:00:00Z');
  await history('priya', 'kofi', 1, 'Tutoring', 'Spreadsheet basics for the repair café inventory', '2025-02-15T18:00:00Z');
  // An extra DIRECT vouch Ben → Lena that later expires (no interaction for 18 months).
  const bl = await step('2025-03-01T10:00:00Z', 'ben', (tx, ctx) => proposeVouch(tx, ctx, ids.ben, { voucheeId: ids.lena, strength: 0.4, liabilityPct: 10, acknowledgeLiability: true }));
  await step('2025-03-02T10:00:00Z', 'lena', (tx, ctx) => respondToVouch(tx, ctx, bl.id, ids.lena, true));
  await join('alice', 'mei', 0.7, 25, '2025-03-15T10:00:00Z');
  await history('priya', 'ben', 1, 'Design', 'CV layout', '2025-03-20T17:00:00Z');
  await history('ben', 'kofi', 1, 'Other', 'Carrying workbenches to the repair café', '2025-04-10T09:00:00Z');
  await join('ben', 'sam', 0.7, 25, '2025-04-25T10:00:00Z');
  await join('priya', 'tomas', 0.4, 10, '2025-05-25T10:00:00Z');
  await history('kofi', 'lena', 2, 'Equipment repair', 'Fix bicycle gears and brakes', '2025-06-15T10:00:00Z');
  await history('tomas', 'alice', 1, 'Gardening', 'Weeding the herb beds', '2025-07-10T08:00:00Z');
  await history('alice', 'lena', 2, 'Tutoring', 'Allotment growing calendar walkthrough', '2025-08-05T17:00:00Z');
  await history('tomas', 'ben', 1, 'Gardening', 'Hedge trimming', '2025-08-20T09:00:00Z');
  await history('tomas', 'kofi', 1, 'Gardening', 'Planting the café window boxes', '2025-09-10T09:00:00Z');
  await history('tomas', 'mei', 1, 'Gardening', 'Balcony planter set-up', '2025-10-05T09:00:00Z');
  await history('tomas', 'lena', 1, 'Gardening', 'Autumn leaf clearing', '2025-11-12T09:00:00Z');
  await history('lena', 'kofi', 1, 'Translation', 'Translate repair-café safety sheet into German', '2025-12-03T18:00:00Z');
  await history('alice', 'ben', 2, 'Tutoring', 'Bread-baking theory for the community kitchen', '2026-01-15T10:00:00Z');
  await history('kofi', 'priya', 1, 'Equipment repair', 'Repair a desk lamp', '2026-03-10T17:00:00Z');
  await history('mei', 'alice', 1, 'Translation', 'Translate a letter from the allotment association', '2026-04-12T10:00:00Z');
  await history('priya', 'alice', 1, 'Design', 'Logo refresh for the allotment', '2026-05-08T10:00:00Z');
  await history('sam', 'ben', 2, 'Cooking', 'Cook for Ben’s family dinner', '2026-06-20T17:00:00Z');

  // 3. A declared conflict (excludes Alice from attesting disputes that involve Kofi).
  await step('2026-02-01T10:00:00Z', 'alice', (tx, ctx) => declareConflict(tx, ctx, ids.alice, ids.kofi, 'Kofi and I co-run the repair café budget.'));

  // 4. Listings (offers and requests).
  const listings: [Handle, CreateListingInput][] = [
    ['sam', { type: 'OFFER', title: 'Home-cooked Malaysian dinner', description: 'I cook a two-course Malaysian dinner (nasi lemak + kuih) in your kitchen or mine. Vegetarian on request.', category: 'Cooking', durationMinutes: 120, locationType: 'IN_PERSON', location: 'North side', availability: 'Weekday evenings, Saturdays', requiredSkills: [], trustTier: 'RESTRICTED' }],
    ['mei', { type: 'OFFER', title: 'Maths & physics tutoring', description: 'Secondary-school maths and physics, exam practice and homework help.', category: 'Tutoring', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Weekends', requiredSkills: [] }],
    ['mei', { type: 'OFFER', title: 'Mandarin ↔ English translation', description: 'Letters, forms and short documents. Up to 2 pages per hour.', category: 'Translation', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Flexible', requiredSkills: [] }],
    ['kofi', { type: 'OFFER', title: 'Bike & small appliance repair', description: 'Bring it to the repair café; we fix it together.', category: 'Equipment repair', durationMinutes: 60, locationType: 'IN_PERSON', location: 'Repair café, High St', availability: 'Saturdays 10–14', requiredSkills: [] }],
    ['priya', { type: 'OFFER', title: 'Posters, flyers and logos', description: 'Simple, accessible print design for community events.', category: 'Design', durationMinutes: 90, locationType: 'ONLINE', location: '', availability: 'Evenings', requiredSkills: [] }],
    ['alice', { type: 'OFFER', title: 'Allotment planning session', description: 'Plan a year of planting for a small plot or balcony.', category: 'Gardening', durationMinutes: 60, locationType: 'IN_PERSON', location: 'Community allotment', availability: 'Sunday mornings', requiredSkills: [] }],
    ['tomas', { type: 'OFFER', title: 'Hedge trimming & weeding', description: 'Tools provided. Green waste taken to the compost.', category: 'Gardening', durationMinutes: 120, locationType: 'IN_PERSON', location: 'Anywhere in town', availability: 'Weekday mornings', requiredSkills: [], trustTier: 'RESTRICTED' }],
    ['lena', { type: 'OFFER', title: 'German conversation practice', description: 'Relaxed conversation for beginners and intermediate learners.', category: 'Tutoring', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Tue/Thu evenings', requiredSkills: [] }],
    ['ben', { type: 'REQUEST', title: 'Washing machine door seal', description: 'The door seal leaks. I have the replacement part; need someone who knows how to fit it.', category: 'Equipment repair', durationMinutes: 180, locationType: 'IN_PERSON', location: 'East side', availability: 'Any weekday after 16:00', requiredSkills: ['Equipment repair'], trustTier: 'RESTRICTED' }],
    ['lena', { type: 'REQUEST', title: 'Rental contract translation (German → English)', description: 'Help me understand a 4-page rental contract.', category: 'Translation', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'This month', requiredSkills: ['German'] }],
  ];
  const listingIds: Record<string, string> = {};
  for (const [owner, l] of listings) {
    const row = await step('2026-09-01T10:00:00Z', owner, (tx, ctx) => createListing(tx, ctx, ids[owner], l));
    listingIds[`${owner}:${l.title}`] = row.id;
  }
  // More translation requests from different people → real demand for the only translation provider (Mei).
  const laterRequests: [Handle, string, CreateListingInput][] = [
    ['ben', '2026-09-24T10:00:00Z', { type: 'REQUEST', title: 'Mandarin recipe cards into English', description: 'Six handwritten recipe cards from a friend’s grandmother.', category: 'Translation', durationMinutes: 60, locationType: 'ONLINE', location: '', availability: 'Any evening', requiredSkills: ['Mandarin'] }],
    ['priya', '2026-09-26T10:00:00Z', { type: 'REQUEST', title: 'Exhibition captions English → Mandarin', description: '12 short captions for the community photo exhibition.', category: 'Translation', durationMinutes: 120, locationType: 'ONLINE', location: '', availability: 'Before mid-October', requiredSkills: ['Mandarin'] }],
    // A high-trust task: entering Alice's home while she is away. Alice also asks for relationship trust ≥ 0.5.
    ['alice', '2026-09-27T10:00:00Z', { type: 'REQUEST', title: 'Feed my cat and water plants while I’m away', description: 'Let yourself in with the key safe, feed Juniper and water the balcony plants, twice during my week away.', category: 'Other', durationMinutes: 60, locationType: 'IN_PERSON', location: 'North side', availability: 'One week in October', requiredSkills: [], trustTier: 'HIGH_TRUST', minRelationshipTrust: 0.5 }],
  ];
  for (const [owner, when, l] of laterRequests) {
    const row = await step(when, owner, (tx, ctx) => createListing(tx, ctx, ids[owner], l));
    listingIds[`${owner}:${l.title}`] = row.id;
  }

  // Skill tier by peer review (a self-claim alone never raises a price): Mei claims Advanced in
  // Translation with evidence; Priya (credibility ≥ 40, no conflict) reviews and approves.
  const claim = await step('2026-09-20T10:00:00Z', 'mei', (tx, ctx) =>
    createSkillClaim(tx, ctx, ids.mei, { category: 'Translation', tier: 'ADVANCED', evidence: 'HSK 6 certificate; three years translating letters and forms for the university international office.' }),
  );
  await step('2026-09-21T10:00:00Z', 'priya', (tx, ctx) => reviewSkillClaim(tx, ctx, claim.id, ids.priya, true, 'Saw her HSK 6 certificate and two of her translations; accurate and clear.'));

  // Contact verification through the real flow. In demo mode the code only appears in the on-screen
  // email preview, so Mei's address is labelled "demo-verified", never plain "verified".
  for (const h of ['mei', 'alice'] as const) {
    const r = await step('2026-09-28T09:00:00Z', h, (tx, ctx) => requestEmailVerification(tx, ctx, ids[h]));
    await step('2026-09-28T09:05:00Z', h, (tx, ctx) => confirmEmailVerification(tx, ctx, ids[h], r.code));
  }
  await updatePreferences(ids.mei, true, []);

  // 5. The seeded dispute: Kofi repairs Lena's kettle; Lena disputes the deliverable.
  //    With Alice conflicted, Ben (past voucher of Lena) and Priya (Kofi's inviter) excluded,
  //    only three members are eligible, so escalation to a panel of three cannot be staffed.
  const kettleAt = new Date('2026-09-20T10:00:00Z');
  const kettle = await step(addDays(kettleAt, -4), 'lena', (tx, ctx) =>
    proposeExchange(tx, ctx, ids.lena, {
      counterpartyId: ids.kofi,
      myRole: 'recipient',
      listingId: listingIds['kofi:Bike & small appliance repair'],
      category: 'Equipment repair',
      deliverable: 'Repair the kettle so that it heats water again',
      durationMinutes: 60,
      scheduledAt: kettleAt.toISOString(),
      location: 'Repair café, High St',
      punctualityRequired: false,
      giftBonus: 0,
      cancellationNoticeHours: 24,
      cancellationTerms: 'Free cancellation up to 24 hours before.',
      confirmationDays: 3,
    }),
  );
  await step(addDays(kettleAt, -3), 'kofi', (tx, ctx) => acceptExchange(tx, ctx, kettle.id, ids.kofi, kettle.termsVersion));
  await step(addHours(kettleAt, 2), 'kofi', (tx, ctx) => confirmCompletion(tx, ctx, kettle.id, ids.kofi));
  const dispute = await step(addDays(kettleAt, 1), 'lena', (tx, ctx) =>
    openDispute(tx, ctx, ids.lena, {
      exchangeId: kettle.id,
      condition: 'DELIVERABLE',
      claim: 'The kettle still does not heat. The agreed deliverable was a kettle that heats water again.',
    }),
  );
  const firstAttestor = await prisma.attestorAssignment.findFirst({ where: { disputeId: dispute.id, status: 'ASSIGNED' } });
  if (firstAttestor) {
    await step(addDays(kettleAt, 2), null, (tx, ctx) =>
      castVote(
        tx,
        { ...ctx, actorId: firstAttestor.attestorId },
        dispute.id,
        firstAttestor.attestorId,
        'UNCLEAR',
        'Both accounts are plausible: Kofi says it heated at the café, Lena says it failed at home. I cannot tell whether the agreed repair was done.',
      ),
    );
  }

  // 6. A pending proposal that Ben cannot accept without breaching the −5 floor.
  await step('2026-09-29T10:00:00Z', 'kofi', (tx, ctx) =>
    proposeExchange(tx, ctx, ids.kofi, {
      counterpartyId: ids.ben,
      myRole: 'provider',
      listingId: listingIds['ben:Washing machine door seal'],
      category: 'Equipment repair',
      deliverable: 'Fit the new washing machine door seal and test for leaks',
      durationMinutes: 180,
      scheduledAt: '2026-10-06T16:00:00Z',
      location: 'Ben’s flat',
      punctualityRequired: false,
      giftBonus: 0,
      cancellationNoticeHours: 24,
      cancellationTerms: 'Free cancellation up to 24 hours before.',
      confirmationDays: 3,
    }),
  );

  // 7. Housekeeping at "today": expire stale vouches and old credits, refresh all scores.
  await step(DEMO_NOW, null, async (tx, ctx) => {
    await expireStaleVouches(tx, ctx);
    await runCreditExpiry(tx, ctx);
    await refreshCredibility(tx, ctx, Object.values(ids), 'demo clock set to today');
  });
  // Notifications generated while building the history are marked read, so the bell starts with
  // only the last few days' events.
  await prisma.notification.updateMany({ where: { createdAt: { lt: new Date('2026-09-25T00:00:00Z') } }, data: { readAt: DEMO_NOW } });
  await prisma.systemState.upsert({
    where: { id: 1 },
    create: { id: 1, simulatedNow: DEMO_NOW, seededAt: new Date() },
    update: { simulatedNow: DEMO_NOW, seededAt: new Date() },
  });
  return ids;
}
