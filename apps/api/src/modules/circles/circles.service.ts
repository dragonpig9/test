import { TOPIC_TAGS, circleNameFor, universityByCode, type CircleMessageInput, type CircleMessageView, type CircleRoomView, type MyCircleView } from '@commonhours/shared';
import { isDemoMode } from '../../config/demo-mode';
import type { Ctx } from '../../core/context';
import type { Db, Tx } from '../../core/db';
import { AppError } from '../../core/errors';
import { getMember, toSummary } from '../members/member.repo';
import { discoverListings } from '../services/listing.service';
import { universityAccessOf } from '../verification/verification.guards';
import { formerMemberships, roomByCode, roomMemberIds, roomMessages } from './circles.repo';

/**
 * University circles: the member's view, room messages and the circle's requests/offers.
 * Access is enforced here on every call from the live guard (not from stored membership rows),
 * so a stale membership or a stale session cannot keep access.
 */
const MODULE = 'circles';

async function summary(db: Db, code: string) {
  const room = await roomByCode(db, code);
  return {
    code,
    name: circleNameFor(code),
    universityName: universityByCode(code)?.name ?? code,
    memberCount: room ? (await roomMemberIds(db, room.id)).length : 0,
  };
}

export async function myCircle(db: Db, memberId: string): Promise<MyCircleView> {
  const m = await getMember(db, memberId);
  const access = universityAccessOf(m, isDemoMode());
  const former = await formerMemberships(db, memberId);
  return {
    circle: access.university ? await summary(db, access.university) : null,
    allowed: access.allowed,
    via: access.via,
    reason: access.reason,
    formerCircles: former.map((f) => ({ code: f.room.universityCode, name: f.room.name, leftAt: f.leftAt!.toISOString(), leftReason: f.leftReason })),
    tags: [...TOPIC_TAGS],
  };
}

/** Live entitlement check: active member, access granted by the guards, and it is THEIR university's room. */
export async function assertCircleAccess(db: Db, memberId: string, code: string) {
  const m = await getMember(db, memberId);
  const access = universityAccessOf(m, isDemoMode());
  if (!access.allowed || access.university !== code) {
    throw new AppError(
      'CIRCLE_ACCESS_DENIED',
      access.allowed ? `You are a member of the ${circleNameFor(access.university!)}, not the ${circleNameFor(code)}.` : access.reason,
      MODULE,
      { circle: code },
      403,
    );
  }
  const room = await roomByCode(db, code);
  if (!room) throw new AppError('CIRCLE_ACCESS_DENIED', `Open Circles once to join the ${circleNameFor(code)}.`, MODULE, { circle: code }, 403);
  return { member: m, room, via: access.via! };
}

const parseTag = (tag: unknown) => (typeof tag === 'string' && (TOPIC_TAGS as readonly string[]).includes(tag) ? tag : null);

export async function circleRoom(db: Db, memberId: string, code: string, rawTag: unknown): Promise<CircleRoomView> {
  const { room, via } = await assertCircleAccess(db, memberId, code);
  const tag = parseTag(rawTag);
  const rows = await roomMessages(db, room.id, tag);
  return {
    circle: await summary(db, code),
    via,
    tag,
    tags: [...TOPIC_TAGS],
    messages: rows.map((r): CircleMessageView => ({ id: r.id, author: toSummary(r.author), body: r.body, tags: r.tags, createdAt: r.createdAt.toISOString(), mine: r.authorId === memberId })),
    note:
      via === 'DEMO_SELF_DECLARED'
        ? 'Demo mode: university affiliations here are self-declared, not verified. Circle membership never creates friendships, vouches or credibility.'
        : 'Members joined after verifying their university email. Circle membership never creates friendships, vouches or credibility.',
  };
}

/** Requests and offers from current members of the circle, optionally filtered by topic tag. */
export async function circleBoard(db: Db, memberId: string, code: string, rawTag: unknown, now: Date) {
  const { room } = await assertCircleAccess(db, memberId, code);
  const ownerIds = await roomMemberIds(db, room.id);
  return discoverListings(db, memberId, now, { ownerIds, tag: parseTag(rawTag) ?? undefined });
}

export async function postCircleMessage(tx: Tx, ctx: Ctx, memberId: string, code: string, input: CircleMessageInput) {
  const { room, member } = await assertCircleAccess(tx, memberId, code);
  const msg = await tx.circleMessage.create({
    data: { roomId: room.id, authorId: memberId, body: input.body, tags: [...new Set(input.tags)], createdAt: ctx.now },
    include: { author: true },
  });
  return { id: msg.id, author: toSummary(member), body: msg.body, tags: msg.tags, createdAt: msg.createdAt.toISOString(), mine: true } satisfies CircleMessageView;
}
