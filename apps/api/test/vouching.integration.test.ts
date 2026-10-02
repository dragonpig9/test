import { beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../src/core/dates';
import { prisma } from '../src/core/db';
import { createInvitation } from '../src/modules/invitations/invitation.service';
import { proposeAmendment, proposeVouch, respondToAmendment, respondToVouch } from '../src/modules/vouches/vouch.service';
import { findPath, loadTrust } from '../src/modules/trust/trust.service';
import { T0, agreed, community, reset, run, settleBoth } from './fixtures';

let ids: Record<string, string>;
beforeEach(async () => {
  await reset();
  ids = await community(['alice', 'mei', 'ben', 'sam', 'kai', 'zoe']);
});

describe('vouching', () => {
  it('requires consent: a proposed vouch is PENDING and does not create reachability until accepted', async () => {
    // Make zoe/alice eligible to vouch: alice is bootstrap with history below; waive by count? 6 members → thresholds apply.
    const ex = await agreed(ids.mei, ids.alice, 60, addDays(T0, 1));
    await settleBoth(ex.id, ids.mei, ids.alice, addDays(T0, 2));
    const ex2 = await agreed(ids.alice, ids.mei, 60, addDays(T0, 3));
    await settleBoth(ex2.id, ids.alice, ids.mei, addDays(T0, 4));
    const ex3 = await agreed(ids.alice, ids.ben, 60, addDays(T0, 5));
    await settleBoth(ex3.id, ids.alice, ids.ben, addDays(T0, 6));
    const now = addDays(T0, 10);
    const v = await run(ids.alice, now, (tx, ctx) => proposeVouch(tx, ctx, ids.alice, { voucheeId: ids.zoe, strength: 0.4, liabilityPct: 10, acknowledgeLiability: true }));
    expect(v.status).toBe('PENDING');
    let p = findPath(await loadTrust(prisma, now), ids.alice, ids.zoe);
    expect(p.hops).toBe(5);
    await run(ids.zoe, now, (tx, ctx) => respondToVouch(tx, ctx, v.id, ids.zoe, true));
    p = findPath(await loadTrust(prisma, now), ids.alice, ids.zoe);
    expect(p.hops).toBe(1);
  });

  it('enforces the credibility threshold for members without history', async () => {
    await expect(run(ids.zoe, T0, (tx, ctx) => createInvitation(tx, ctx, ids.zoe, { inviteeName: 'New', strength: 0.4, liabilityPct: 10, acknowledgeLiability: true }))).rejects.toMatchObject({
      code: 'CREDIBILITY_TOO_LOW',
    });
  });

  it('strengthening needs a settled exchange and the counterparty’s fresh consent', async () => {
    const v = await prisma.vouch.findFirstOrThrow({ where: { voucherId: ids.alice, voucheeId: ids.mei } });
    await expect(run(ids.mei, T0, (tx, ctx) => proposeAmendment(tx, ctx, v.id, ids.mei, { strength: 1.0, liabilityPct: 25 }))).rejects.toMatchObject({ code: 'STRENGTHEN_NOT_ALLOWED' });
    const ex = await agreed(ids.mei, ids.alice, 60, addDays(T0, 1));
    await settleBoth(ex.id, ids.mei, ids.alice, addDays(T0, 2));
    expect((await prisma.vouch.findUniqueOrThrow({ where: { id: v.id } })).strength).toBe(0.7); // no silent strengthening
    const a = await run(ids.mei, addDays(T0, 3), (tx, ctx) => proposeAmendment(tx, ctx, v.id, ids.mei, { strength: 1.0, liabilityPct: 50 }));
    await expect(run(ids.mei, addDays(T0, 3), (tx, ctx) => respondToAmendment(tx, ctx, a.id, ids.mei, true))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await run(ids.alice, addDays(T0, 3), (tx, ctx) => respondToAmendment(tx, ctx, a.id, ids.alice, true));
    expect(await prisma.vouch.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ strength: 1.0, liabilityPct: 50 });
  });

  it('expired edges stop establishing reachability', async () => {
    const far = addDays(T0, 365 * 2);
    const p = findPath(await loadTrust(prisma, far), ids.alice, ids.mei);
    expect(p.found).toBe(false);
    expect(p.explanation).toMatch(/Expired, revoked/);
  });
});
