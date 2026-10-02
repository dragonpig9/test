import type { Vouch } from '@prisma/client';
import type { EdgeView } from '@commonhours/shared';
import { daysBetween } from '../../core/dates';
import { effectiveEdge, maxPenaltyPoints } from './vouch.rules';

export function toEdgeView(v: Vouch, now: Date): EdgeView {
  const e = effectiveEdge(v, now);
  return {
    id: v.id,
    voucherId: v.voucherId,
    voucheeId: v.voucheeId,
    strength: v.strength,
    effectiveStrength: e.effectiveStrength,
    status: e.status,
    storedStatus: v.status,
    liabilityPct: v.liabilityPct,
    maxPenaltyPoints: maxPenaltyPoints(v.liabilityPct),
    createdAt: v.createdAt.toISOString(),
    activatedAt: v.activatedAt?.toISOString() ?? null,
    lastInteractionAt: v.lastInteractionAt?.toISOString() ?? null,
    expiresAt: v.expiresAt?.toISOString() ?? null,
    ageDays: daysBetween(v.activatedAt ?? v.createdAt, now),
    decayed: e.decayed,
    explanation: e.explanation,
  };
}
