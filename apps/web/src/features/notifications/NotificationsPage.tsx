import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, Tabs } from '../../components/ui';
import { useAction } from '../../lib/mutations';
import { markAllRead, useNotifications, useUnreadCount } from './api';
import { NotificationList } from './NotificationList';

export function NotificationsPage() {
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const q = useNotifications({ unread: tab === 'unread', limit: 100 });
  const unread = useUnreadCount();
  const all = useAction(() => markAllRead());
  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Invitations, task changes, reminders, settlements, trust changes, disputes and jury duty. Stored on the server, so they survive a refresh."
        actions={
          <Button variant="secondary" busy={all.isPending} disabled={!unread.data?.unread} onClick={() => all.mutate(undefined)}>
            Mark all as read
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs label="Filter notifications" value={tab} onChange={setTab} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: unread.data?.unread }]} />
        <Link to="/account#notifications" className="text-sm text-brand-700 hover:underline">
          Email settings & preview
        </Link>
      </div>
      <Card>
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : q.data?.notifications.length ? <NotificationList items={q.data.notifications} /> : <Empty title={tab === 'unread' ? 'All caught up' : 'No notifications yet'} />}
        <ErrorBox error={all.error} />
      </Card>
    </div>
  );
}

/** Bell with unread count, for the sidebar and the mobile header. */
export function NotificationBell({ onNavigate }: { onNavigate?: () => void }) {
  const unread = useUnreadCount();
  const n = unread.data?.unread ?? 0;
  return (
    <Link to="/notifications" onClick={onNavigate} className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100" aria-label={`Notifications${n ? `, ${n} unread` : ''}`}>
      <span aria-hidden className="text-lg">
        🔔
      </span>
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}
