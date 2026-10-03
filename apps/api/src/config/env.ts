import 'dotenv/config';
import { fileURLToPath } from 'node:url';

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-insecure-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  // Hosts like Render inject PORT; API_PORT is the local-dev name.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  demoMode: bool(process.env.DEMO_MODE, true),
  debugEndpoints: process.env.NODE_ENV !== 'production' && bool(process.env.DEBUG_ENDPOINTS, true),
  // Built web app to serve from the API process. Set SERVE_WEB=true (the Render blueprint does); off in dev, where Vite serves it.
  webDist: bool(process.env.SERVE_WEB, false) ? fileURLToPath(new URL('../../../web/dist', import.meta.url)) : null,
  isTest: process.env.VITEST === 'true' || process.env.NODE_ENV === 'test',
  /**
   * Development-only shortcuts: student email codes shown in the on-screen preview (labelled
   * "dev-preview", never "verified"), and the demo bar's "Run daily job" / "Next 00:00" controls.
   * Never on when NODE_ENV=production, even with DEMO_MODE=true.
   */
  devShortcuts: process.env.NODE_ENV !== 'production' && bool(process.env.DEMO_MODE, true),
  /** In-process daily job scheduler (00:00 Asia/Hong_Kong). Turn off when an external cron runs scripts/run-daily-job.ts. */
  dailyJobScheduler: bool(process.env.DAILY_JOB_SCHEDULER, true),
  /** Public URL used for links in emails. */
  appBaseUrl: (process.env.APP_BASE_URL ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
  /**
   * Optional email delivery. Credentials stay on the backend and are never returned by any endpoint.
   *   EMAIL_PROVIDER=gmail  → Gmail SMTP with GMAIL_USER + GMAIL_APP_PASSWORD (account with 2-Step Verification),
   *                           or OAuth2: GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN
   *   EMAIL_PROVIDER=smtp   → SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
   * Unset/incomplete → no email is sent: demo mode shows previews, otherwise emails are marked skipped.
   */
  email: {
    provider: (process.env.EMAIL_PROVIDER ?? 'none').toLowerCase(),
    from: process.env.EMAIL_FROM ?? '',
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
    gmail: {
      user: process.env.GMAIL_USER ?? '',
      appPassword: process.env.GMAIL_APP_PASSWORD ?? '',
      clientId: process.env.GMAIL_CLIENT_ID ?? '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
      refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? '',
    },
  },
};

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
