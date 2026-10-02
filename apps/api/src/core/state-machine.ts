import { AppError } from './errors';

/**
 * The one state-transition service used by exchanges and disputes.
 * Each module declares its allowed transitions; anything else is rejected with a
 * useful INVALID_TRANSITION error naming the current state and what is allowed.
 */
export interface Machine<S extends string> {
  name: string;
  module: string;
  transitions: Record<S, readonly S[]>;
  describe?: Partial<Record<S, string>>;
}

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return (m.transitions[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S, action: string): void {
  if (canTransition(m, from, to)) return;
  const allowed = m.transitions[from] ?? [];
  throw new AppError(
    'INVALID_TRANSITION',
    `Cannot ${action}: this ${m.name} is ${from}${m.describe?.[from] ? ` (${m.describe[from]})` : ''}. ` +
      (allowed.length ? `From ${from} it can only move to ${allowed.join(', ')}.` : `${from} is a final state.`),
    m.module,
    { machine: m.name, from, to, allowed },
  );
}
