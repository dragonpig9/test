import { env } from './env';

/**
 * THE demo-mode switch. One authoritative, server-side flag: the DEMO_MODE environment variable,
 * read once into `env.demoMode` at startup. Every backend module, background job and the web app
 * (through GET /api/health and GET /api/auth/me) reads it through this module.
 *
 * Nothing a user sends can change it: there is no request parameter, header, cookie or browser
 * storage key that turns it on. (Tests flip `env.demoMode` directly.)
 *
 * What demo mode changes is listed in DEMO_MODE_BYPASSES and implemented only in
 * modules/verification/verification.guards.ts. It bypasses VERIFICATION prerequisites only;
 * invitations, account status, room permissions, trust thresholds and credit rules are unchanged.
 */
export function isDemoMode(): boolean {
  return env.demoMode;
}

export const DEMO_MODE_BYPASSES = [
  'University email codes, email links, student documents and manual checks are skipped.',
  'Accounts waiting for verification can use the whole app.',
  'Verification is not required to join your university circle (recorded as a demo, self-declared affiliation).',
  'High-trust tasks do not require a verified contact method (credibility and owner approval still apply).',
] as const;

export interface DemoModeStatus {
  enabled: boolean;
  bypasses: readonly string[];
}

export function demoModeStatus(): DemoModeStatus {
  const enabled = isDemoMode();
  return { enabled, bypasses: enabled ? DEMO_MODE_BYPASSES : [] };
}
