import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { NotificationView } from '@commonhours/shared';
import { useAction } from '../../lib/mutations';
import { fmtDate } from '../../lib/format';
import { markRead } from './api';

const ICON: Record<string, string> = { invitations: '✉', exchanges: '⇄', reminders: '⏰', credits: '◷', trust: '★', disputes: '⚖', jury: '⚖' };

/** Clicking a notification marks it read and opens the linked task, exchange, profile or dispute. */
export function NotificationList({ items, compact }: { items: NotificationView[]; compact?: boolean }) {
  const nav = useNavigate();
  const read = useAction((id: string) => markRead(id));
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((n) => (
        <li key={n.id} className={clsx('flex gap-3 py-2.5', !n.read && 'bg-brand-50/40')}>
          <span aria-hidden className="mt-0.5 w-5 text-center text-slate-500">
            {ICON[n.category] ?? '•'}
          </span>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="text-left text-sm font-medium text-slate-900 hover:text-brand-700"
              onClick={() => {
                if (!n.read) read.mutate(n.id);
                if (n.link) nav(n.link);
              }}
            >
              {!n.read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" aria-label="unread" />}
              {n.title}
            </button>
            {!compact && <p className="text-xs text-slate-600">{n.body}</p>}
            <p className="text-[11px] text-slate-500">
              {fmtDate(n.createdAt)}
              {n.email && ` · email: ${n.email.status.toLowerCase()}`}
              {n.link && !compact && (
                <>
                  {' · '}
                  <Link to={n.link} className="text-brand-700 hover:underline">
                    open
                  </Link>
                </>
              )}
            </p>
          </div>
          {!n.read && !compact && (
            <button type="button" className="self-start text-xs text-slate-500 hover:text-slate-800" onClick={() => read.mutate(n.id)}>
              Mark read
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
