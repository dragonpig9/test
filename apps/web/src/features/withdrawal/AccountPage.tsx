import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorBox, Loading, PageHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { NotificationSettings } from '../notifications/NotificationSettings';

interface Preview {
  willClose: string[];
  willRemain: string[];
}

export function AccountPage() {
  const { me } = useAuth();
  const preview = useQuery({ queryKey: ['withdrawal'], queryFn: () => api<Preview>('/withdrawal/preview') });
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const leave = useAction(() => api('/withdrawal/leave', { body: { confirm: true, reason } }));
  if (!me) return null;
  return (
    <div>
      <PageHeader title="Account & leaving" subtitle="Notification settings, your email outbox, and leaving. Leaving blocks new commitments but keeps everything you already agreed to, your debts and your history." />
      <div className="mb-6">
        <NotificationSettings />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Your account">
          <p className="text-sm">
            {me.member.displayName} (@{me.member.handle}) · joined {fmtDate(me.member.joinedAt, false)} · status <strong>{me.member.status.toLowerCase()}</strong>
            {me.member.leftAt && ` since ${fmtDate(me.member.leftAt, false)}`}
          </p>
        </Card>
        <Card title="Leave the community">
          {me.member.status === 'LEFT' ? (
            <p className="text-sm text-slate-700">You have left. You can still complete accepted exchanges, disputes and attestation duties.</p>
          ) : preview.isLoading ? (
            <Loading />
          ) : (
            preview.data && (
              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="mb-1">Will be closed</h3>
                  <ul className="list-disc space-y-1 pl-5">{preview.data.willClose.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
                <div>
                  <h3 className="mb-1">Will remain</h3>
                  <ul className="list-disc space-y-1 pl-5">{preview.data.willRemain.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
                <label className="block">
                  <span className="label">Reason (optional)</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I understand that my open obligations and history remain.
                </label>
                <ErrorBox error={leave.error} />
                <Button variant="danger" disabled={!confirm} busy={leave.isPending} onClick={() => leave.mutate(undefined)}>
                  Leave CommonHours
                </Button>
              </div>
            )
          )}
        </Card>
      </div>
    </div>
  );
}
