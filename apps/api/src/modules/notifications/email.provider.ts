import { isDemoMode } from '../../config/demo-mode';
import { env } from '../../config/env';

/**
 * Email provider adapter. The rest of the app only sees `EmailProvider.send`; which transport is
 * used (Gmail, generic SMTP, or none) is decided here from backend-only configuration.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<{ messageId: string }>;
}

export type DeliveryMode = 'smtp' | 'preview' | 'disabled';

let override: EmailProvider | null = null;

/** Tests inject a fake (or failing) provider. Pass null to restore the configured one. */
export function setEmailProviderForTests(p: EmailProvider | null) {
  override = p;
  cached = undefined;
}

function gmailConfigured() {
  const g = env.email.gmail;
  return !!g.user && (!!g.appPassword || (!!g.clientId && !!g.clientSecret && !!g.refreshToken));
}

function smtpConfigured() {
  const s = env.email.smtp;
  return !!s.host && !!s.user && !!s.pass;
}

/**
 * smtp     — a provider is configured: emails are queued and really sent (with retries);
 * preview  — demo mode without credentials: emails are rendered and stored as PREVIEW, never sent;
 * disabled — not demo and not configured: emails are stored as SKIPPED with the reason.
 */
export function deliveryMode(): DeliveryMode {
  if (override) return 'smtp';
  if ((env.email.provider === 'gmail' && gmailConfigured()) || (env.email.provider === 'smtp' && smtpConfigured())) return 'smtp';
  return isDemoMode() ? 'preview' : 'disabled';
}

export function deliveryNote(mode = deliveryMode()): string {
  if (mode === 'smtp') return `Email delivery is configured (${override ? override.name : env.email.provider}). Opted-in members receive real emails.`;
  if (mode === 'preview') return 'Demo mode: no email credentials are configured, so emails are shown as previews and never sent.';
  return 'Email delivery is not configured on this server; in-app notifications still work.';
}

let cached: EmailProvider | undefined;

async function build(): Promise<EmailProvider> {
  if (override) return override;
  const { createTransport } = await import('nodemailer');
  if (env.email.provider === 'gmail') {
    const g = env.email.gmail;
    // Supported Gmail auth: an App Password (needs 2-Step Verification) or OAuth2 with a refresh token.
    const auth = g.appPassword
      ? { user: g.user, pass: g.appPassword }
      : { type: 'OAuth2' as const, user: g.user, clientId: g.clientId, clientSecret: g.clientSecret, refreshToken: g.refreshToken };
    const transport = createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth });
    return { name: 'gmail', send: async (m) => ({ messageId: (await transport.sendMail({ from: env.email.from || g.user, to: m.to, subject: m.subject, text: m.text })).messageId }) };
  }
  const s = env.email.smtp;
  const transport = createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass } });
  return { name: 'smtp', send: async (m) => ({ messageId: (await transport.sendMail({ from: env.email.from || s.user, to: m.to, subject: m.subject, text: m.text })).messageId }) };
}

export async function emailProvider(): Promise<EmailProvider> {
  if (deliveryMode() !== 'smtp') throw new Error('No email provider is configured.');
  cached ??= await build();
  return cached;
}

/** Safe description of the configuration for the debug panel (never includes secrets). */
export function deliveryConfigSummary() {
  return {
    mode: deliveryMode(),
    provider: override ? override.name : env.email.provider,
    from: env.email.from || null,
    gmailConfigured: gmailConfigured(),
    smtpConfigured: smtpConfigured(),
    note: deliveryNote(),
  };
}
