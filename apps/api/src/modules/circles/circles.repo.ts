import { circleNameFor } from '@commonhours/shared';
import type { Db, Tx } from '../../core/db';

/** Database access for circles (rooms, memberships, messages). */

export async function ensureRoom(tx: Tx, universityCode: string, now: Date) {
  return tx.circleRoom.upsert({
    where: { universityCode },
    create: { universityCode, name: circleNameFor(universityCode), createdAt: now },
    update: {},
  });
}

export async function openMemberships(db: Db, memberId: string) {
  return db.circleMembership.findMany({ where: { memberId, leftAt: null }, include: { room: true } });
}

export async function formerMemberships(db: Db, memberId: string) {
  return db.circleMembership.findMany({ where: { memberId, leftAt: { not: null } }, include: { room: true }, orderBy: { leftAt: 'desc' }, take: 10 });
}

export async function roomByCode(db: Db, universityCode: string) {
  return db.circleRoom.findUnique({ where: { universityCode } });
}

/** Current members of a room (open memberships of ACTIVE members). */
export async function roomMemberIds(db: Db, roomId: string) {
  const rows = await db.circleMembership.findMany({ where: { roomId, leftAt: null, member: { status: 'ACTIVE' } }, select: { memberId: true } });
  return rows.map((r) => r.memberId);
}

export async function roomMessages(db: Db, roomId: string, tag: string | null, take = 100) {
  const rows = await db.circleMessage.findMany({
    where: { roomId, ...(tag ? { tags: { has: tag } } : {}) },
    include: { author: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  });
  return rows.reverse();
}
