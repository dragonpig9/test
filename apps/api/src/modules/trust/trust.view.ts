import type { EarnedRelationship } from '@prisma/client';
import type { EarnedEdgeView } from '@commonhours/shared';
import { effectiveEarned } from './trust.earned.rules';

export function toEarnedEdgeView(r: EarnedRelationship, now: Date): EarnedEdgeView {
  const e = effectiveEarned(r, now);
  return {
    id: r.id,
    memberAId: r.memberAId,
    memberBId: r.memberBId,
    strength: r.strength,
    effectiveStrength: e.effectiveStrength,
    status: e.status,
    decayed: e.decayed,
    countedExchanges: r.countedExchanges,
    createdAt: r.createdAt.toISOString(),
    lastExchangeAt: r.lastExchangeAt.toISOString(),
    explanation: e.explanation,
  };
}
