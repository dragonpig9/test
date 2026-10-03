import type { DemoParticipantView, DemoWalkthroughView } from '@commonhours/shared';
import { StatusChip } from '../../../components/ui';
import { Timeline } from '../../../components/Timeline';
import { credits, fmtDate } from '../../../lib/format';
import { OutboxList } from '../../notifications/NotificationSettings';
import { InviteForm } from '../../vouching/VouchingPanel';
import { ActAsButton, Details, Step, useActAs } from './parts';

const KIND: Record<string, string> = { SETTLEMENT: 'Settlement', POOL_DISTRIBUTION: 'Community Credit Pool reward', EXPIRY: 'Credit expiry', ADJUSTMENT: 'Adjustment' };

/** Chapter 5 (Demo Guide steps 13–15): settlements, credibility, audit trail, invitation and notifications. */
export function Chapter5Results({ w }: { w: DemoWalkthroughView }) {
  const { me } = useActAs();
  const { mei } = w.members;
  const { invitePermission: invite, invitations, notifications, emailPreviews } = w.results;
  const storyIds = new Set([w.story.cooking?.id, w.story.tutoring?.id, w.story.translation?.id].filter(Boolean));
  const since = w.story.cooking?.createdAt ?? null;
  const translationRes = w.story.translation?.reservation ?? null;
  return (
    <div className="space-y-4">
      <Step title="Settlement or release" state={w.story.comparison.settled || translationRes ? 'info' : 'waiting'} note="Every credit movement is a balanced ledger entry. Service transfers and pool rewards are listed separately.">
        {translationRes && (
          <p className="mb-2 text-sm">
            Translation reservation: <StatusChip status={translationRes.status} /> {credits(translationRes.total)} cr — {translationRes.resolutionNote ?? (translationRes.status === 'FROZEN' ? 'still frozen while the dispute is open' : 'reserved')}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {[w.participants.mei, w.participants.sam].map((p) => (
            <LedgerList key={p.member.id} p={p} storyIds={storyIds} />
          ))}
        </div>
      </Step>

      <Step title="Credibility changes" state="info" note="Recomputed from records after each settlement or finding. Disagreeing with a majority never costs a juror points.">
        <div className="grid gap-3 md:grid-cols-2">
          {[w.participants.mei, w.participants.sam].map((p) => {
            const recent = since ? p.credibility.history.filter((h) => h.createdAt >= since) : [];
            return (
              <div key={p.member.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <p className="font-semibold">
                  {p.member.displayName}: <span className="num">{p.credibility.score}</span>
                </p>
                {recent.length ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                    {recent.map((h) => (
                      <li key={h.id}>
                        <span className="num font-medium text-slate-900">
                          {h.delta > 0 ? '+' : ''}
                          {h.delta} → {h.score}
                        </span>{' '}
                        · {h.reason} · {fmtDate(h.createdAt)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No change since the story started.</p>
                )}
              </div>
            );
          })}
        </div>
      </Step>

      <Step title="Audit trail" state="info" note="Each change is written in the same transaction as the change itself, with a rule id.">
        <ul className="space-y-1 text-xs">
          {w.story.auditTrail.slice(-6).map((e) => (
            <li key={e.id}>
              <span className="text-slate-500">{fmtDate(e.at)}</span> · {e.summary}
            </li>
          ))}
          {!w.story.auditTrail.length && <li className="text-slate-500">No story events yet.</li>}
        </ul>
        {w.story.auditTrail.length > 6 && (
          <div className="mt-2">
            <Details title={`Details: all ${w.story.auditTrail.length} events`}>
              <Timeline entries={w.story.auditTrail} />
            </Details>
          </div>
        )}
      </Step>

      <Step title="Can Mei invite someone now?" state={invitations.length ? 'done' : invite?.allowed ? 'ready' : 'blocked'}>
        {invite && (
          <p className="text-sm">
            Inviting needs credibility <strong>{invite.threshold}</strong>; Mei has <strong>{invite.current}</strong>.{' '}
            {invite.allowed ? <span className="text-emerald-800">Unlocked from her records.</span> : <span className="text-slate-700">Not yet: {invite.toUnlock}</span>}
          </p>
        )}
        {invitations.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="rounded-lg border border-slate-200 p-2">
                <StatusChip status={i.status} /> {i.inviteeName} · strength {i.strength} · liability {i.liabilityPct}% (max penalty for Mei: {i.maxPenaltyPoints} points) · {fmtDate(i.createdAt)}
              </li>
            ))}
          </ul>
        )}
        {invite?.allowed && (
          <div className="mt-3">
            {me?.handle === 'mei' ? (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="mb-2 text-sm text-slate-600">Mei chooses the strength and liability, reads the maximum penalty and consents before the invitation exists.</p>
                <InviteForm inviterLabel="Mei" />
              </div>
            ) : (
              <ActAsButton m={mei} why="to create an invitation" />
            )}
          </div>
        )}
      </Step>

      <Step title="Mei’s notifications and email previews" state="info">
        <ul className="divide-y divide-slate-100 text-sm">
          {notifications.slice(0, 8).map((n) => (
            <li key={n.id} className="py-1.5">
              <span className="font-medium">{!n.read && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand-600" aria-label="unread" />}{n.title}</span>
              <span className="block text-xs text-slate-500">
                {n.body} · {fmtDate(n.createdAt)}
              </span>
            </li>
          ))}
          {!notifications.length && <li className="py-1.5 text-slate-500">No notifications yet.</li>}
        </ul>
        <div className="mt-3 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-950">Email previews — not delivered</p>
          <p className="mb-2 text-xs text-amber-900">Demo mode never sends real email. These are the messages that would be sent for the notifications above; dispute emails carry no evidence.</p>
          {emailPreviews.length ? <OutboxList emails={emailPreviews} /> : <p className="text-xs text-slate-600">No previews yet (they appear once notifications with email are created).</p>}
        </div>
      </Step>

      <p className="rounded-2xl bg-brand-700 p-5 text-center text-lg font-semibold leading-snug text-white">
        Find help through connections. Exchange credits through agreed work. Resolve disagreements against agreed terms.
      </p>
    </div>
  );
}

function LedgerList({ p, storyIds }: { p: DemoParticipantView; storyIds: Set<string | undefined> }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 text-sm">
      <p className="font-semibold">{p.member.displayName}</p>
      {p.recentLedger.length ? (
        <ul className="mt-1 space-y-0.5 text-xs">
          {p.recentLedger.map((e) => (
            <li key={e.id} className={storyIds.has(e.exchangeId ?? undefined) ? '' : 'text-sky-800'}>
              <span className="num font-medium">{credits(e.amount, true)}</span> · {storyIds.has(e.exchangeId ?? undefined) ? 'Service transfer' : (KIND[e.kind] ?? e.kind)} · {e.explanation}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No postings since the story started.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Posted {credits(p.credits.posted)} · reserved {credits(p.credits.reservedOutgoing)} · available {credits(p.credits.available)}
      </p>
    </div>
  );
}
