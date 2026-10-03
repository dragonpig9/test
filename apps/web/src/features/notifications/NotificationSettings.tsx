import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { NotificationCategory } from '@commonhours/shared';
import { Button, Card, Empty, ErrorBox, Loading, StatusChip, Success } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { useOutbox } from '../profiles/api';
import { savePreferences, usePreferences } from './api';

const EMAIL_CHIP: Record<string, string> = { SENT: 'CONFIRMED', PREVIEW: 'PENDING', PENDING: 'PENDING', SENDING: 'PENDING', FAILED: 'REFUTED', SKIPPED: 'EXPIRED' };

/** Per-member email opt-in, categories, and the member's own outbox (previews in demo mode). */
export function NotificationSettings() {
  const prefs = usePreferences();
  const outbox = useOutbox();
  const [enabled, setEnabled] = useState(false);
  const [cats, setCats] = useState<NotificationCategory[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (prefs.data) {
      setEnabled(prefs.data.emailEnabled);
      setCats(prefs.data.categories);
    }
  }, [prefs.data]);
  const save = useAction(() => savePreferences(enabled, cats), () => setSaved(true));
  if (prefs.isLoading) return <Loading />;
  if (!prefs.data) return <ErrorBox error={prefs.error} />;
  const p = prefs.data;
  return (
    <div className="space-y-6" id="notifications">
      <Card title="Email notifications">
        <p className={clsx('mb-3 rounded-lg p-2 text-xs', p.delivery.mode === 'smtp' ? 'bg-brand-50 text-brand-900' : 'bg-amber-50 text-amber-900')}>{p.delivery.note}</p>
        <p className="text-sm">
          Address: <strong>{p.address ?? '—'}</strong> ({p.addressVerified ? 'verified' : 'not verified'}).{' '}
          <Link to="/profile" className="text-brand-700 hover:underline">
            Change or verify it in My Profile
          </Link>
          . Emails go only to a verified address and never include dispute evidence or home addresses.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} disabled={!p.addressVerified && !enabled} onChange={(e) => { setSaved(false); setEnabled(e.target.checked); }} />
          Send me emails (opt-in; off by default)
        </label>
        <fieldset className="mt-3 grid gap-1 sm:grid-cols-2" disabled={!enabled}>
          <legend className="label">Categories</legend>
          {p.allCategories.map((c) => (
            <label key={c.key} className={clsx('flex items-center gap-2 text-sm', !enabled && 'opacity-50')}>
              <input
                type="checkbox"
                checked={cats.includes(c.key)}
                onChange={(e) => {
                  setSaved(false);
                  setCats((x) => (e.target.checked ? [...x, c.key] : x.filter((k) => k !== c.key)));
                }}
              />
              {c.label}
            </label>
          ))}
        </fieldset>
        <div className="mt-3 space-y-2">
          <ErrorBox error={save.error} />
          {saved && <Success>Notification settings saved.</Success>}
          <Button busy={save.isPending} onClick={() => save.mutate(undefined)}>
            Save settings
          </Button>
        </div>
      </Card>
      <Card title="My email outbox">
        <p className="mb-3 text-xs text-slate-600">Every email CommonHours prepared for you, with its delivery status. In demo mode they are previews only.</p>
        {outbox.isLoading ? (
          <Loading />
        ) : outbox.data?.emails.length ? (
          <ul className="space-y-2">
            {outbox.data.emails.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip status={EMAIL_CHIP[e.status] ?? 'PENDING'} label={e.status === 'PREVIEW' ? 'preview (not sent)' : e.status.toLowerCase()} />
                  <span className="font-semibold text-slate-900">{e.subject}</span>
                </div>
                <p className="text-slate-500">
                  to {e.toAddress} · {fmtDate(e.createdAt)}
                  {e.attempts ? ` · ${e.attempts} attempt(s)` : ''}
                  {e.lastError ? ` · ${e.lastError}` : ''}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-brand-700">Show email</summary>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{e.body}</pre>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No emails yet">Turn on email notifications and verify your address to receive them.</Empty>
        )}
      </Card>
    </div>
  );
}
