import type { UniversityAccessVia } from '../verification/verification.guards';

/**
 * Pure membership planning for university circles. Given a member's open memberships and their
 * current access (from the verification guards), decide what to close and what to open.
 *  - One university circle at a time: the circle of the member's current university.
 *  - Switching university closes the old membership (history and messages are kept) and opens the new one.
 *  - Losing access (e.g. demo mode switched off without genuine verification) closes it.
 *  - A change of basis (demo → genuinely verified) is recorded on the open row.
 */
export interface OpenMembership {
  id: string;
  university: string;
  via: string;
}

export interface Access {
  university: string | null;
  allowed: boolean;
  via: UniversityAccessVia | null;
  reason: string;
}

export interface MembershipPlan {
  close: { id: string; reason: string }[];
  open: { university: string; via: UniversityAccessVia } | null;
  updateVia: { id: string; via: UniversityAccessVia } | null;
}

export function planCircleMembership(open: OpenMembership[], access: Access): MembershipPlan {
  const plan: MembershipPlan = { close: [], open: null, updateVia: null };
  let kept: OpenMembership | null = null;
  for (const o of open) {
    if (access.allowed && o.university === access.university && !kept) kept = o;
    else plan.close.push({ id: o.id, reason: !access.allowed ? access.reason : o.university !== access.university ? `University changed to ${access.university ?? 'none'}.` : 'Duplicate membership.' });
  }
  if (access.allowed && access.university && access.via) {
    if (!kept) plan.open = { university: access.university, via: access.via };
    else if (kept.via !== access.via) plan.updateVia = { id: kept.id, via: access.via };
  }
  return plan;
}
