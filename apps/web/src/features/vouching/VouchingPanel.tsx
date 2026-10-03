import { useState } from 'react';
import type { GraphView } from '@commonhours/shared';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, StatusChip, Success } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { ProfileCard } from '../profiles/ProfileCard';
import { useProfile } from '../profiles/api';
import { TermsChooser } from './TermsChooser';
import { amendVouch, createInvitation, proposeVouch, respondAmendment, respondVouch, revokeInvitation, revokeVouch, useInvitations, useMyVouches, type MyVouch } from './api';

export function VouchingPanel({ graph }: { graph?: GraphView }) {
  const { me } = useAuth();
  const vouches = useMyVouches();
  const invites = useInvitations();
  const [modal, setModal] = useState<'invite' | 'vouch' | null>(null);
  const [amend, setAmend] = useState<MyVouch | null>(null);
  const respond = useAction((v: { id: string; accept: boolean }) => respondVouch(v.id, v.accept));
  const respondAm = useAction((v: { id: string; accept: boolean }) => respondAmendment(v.id, v.accept));
  const revoke = useAction((v: { id: string; reason: string }) => revokeVouch(v.id, v.reason));
  const revokeInv = useAction((id: string) => revokeInvitation(id));
  if (!me) return null;
  const invitePerm = me.permissions.find((p) => p.key === 'invite')!;
  const vouchPerm = me.permissions.find((p) => p.key === 'vouch')!;
  const err = respond.error ?? respondAm.error ?? revoke.error ?? revokeInv.error;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Invite someone new">
          <p className="text-sm text-slate-600">{invitePerm.explanation}</p>
          {!invitePerm.allowed && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">Locked: {invitePerm.toUnlock}</p>}
          <Button className="mt-3" disabled={!invitePerm.allowed} onClick={() => setModal('invite')}>
            Create invitation
          </Button>
        </Card>
        <Card title="Vouch for an existing member">
          <p className="text-sm text-slate-600">{vouchPerm.explanation}</p>
          {!vouchPerm.allowed && <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">Locked: {vouchPerm.toUnlock}</p>}
          <Button className="mt-3" variant="secondary" disabled={!vouchPerm.allowed} onClick={() => setModal('vouch')}>
            Propose a vouch
          </Button>
          {vouches.data && (
            <p className="mt-2 text-xs text-slate-500">
              Using {vouches.data.used} of {vouches.data.limit} vouch slots (active + pending vouches + open invitations).
            </p>
          )}
        </Card>
      </div>
      <ErrorBox error={err} />
      <Card title="My vouches">
        {vouches.isLoading ? (
          <Loading />
        ) : !vouches.data?.vouches.length ? (
          <Empty title="No vouches yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {vouches.data.vouches.map((v) => {
              const pendingAm = v.amendments.find((a) => a.status === 'PENDING');
              return (
                <li key={v.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <MemberChip m={v.voucher} detail />
                    <span className="text-slate-400">→</span>
                    <MemberChip m={v.vouchee} detail />
                    <StatusChip status={v.status} />
                    <span className="text-xs text-slate-500">
                      {v.direction} · strength {v.decayed ? `${v.strength}→${v.effectiveStrength}` : v.effectiveStrength} · liability {v.liabilityPct}% (max −{v.maxPenaltyPoints}) · {v.origin.toLowerCase()} · expires {fmtDate(v.expiresAt, false)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{v.explanation}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {v.status === 'PENDING' && v.direction === 'incoming' && (
                      <>
                        <Button onClick={() => respond.mutate({ id: v.id, accept: true })} busy={respond.isPending}>
                          Accept vouch
                        </Button>
                        <Button variant="secondary" onClick={() => respond.mutate({ id: v.id, accept: false })}>
                          Decline
                        </Button>
                      </>
                    )}
                    {v.status === 'ACTIVE' && !pendingAm && (
                      <Button variant="secondary" onClick={() => setAmend(v)}>
                        Propose change
                      </Button>
                    )}
                    {(v.status === 'ACTIVE' || v.status === 'PENDING') && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          const reason = window.prompt('Why are you revoking this vouch? (Liability for exchanges already accepted remains.)');
                          if (reason && reason.length >= 3) revoke.mutate({ id: v.id, reason });
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                  {pendingAm && (
                    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-sm">
                      Pending change: strength {pendingAm.fromStrength}→{pendingAm.toStrength}, liability {pendingAm.fromLiabilityPct}%→{pendingAm.toLiabilityPct}%
                      {pendingAm.increasesLiability && <strong> (raises the voucher’s liability — needs their fresh consent)</strong>}
                      {pendingAm.proposedById !== me.member.id ? (
                        <span className="ml-2 inline-flex gap-2">
                          <Button onClick={() => respondAm.mutate({ id: pendingAm.id, accept: true })}>Consent</Button>
                          <Button variant="secondary" onClick={() => respondAm.mutate({ id: pendingAm.id, accept: false })}>
                            Decline
                          </Button>
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-slate-600">waiting for the other member</span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="My invitations">
        {invites.isLoading ? (
          <Loading />
        ) : !invites.data?.invitations.length ? (
          <Empty title="No invitations yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {invites.data.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="font-medium">{i.inviteeName}</span>
                <StatusChip status={i.status} />
                <span className="font-mono text-xs">{i.code}</span>
                <span className="text-xs text-slate-500">
                  strength {i.strength} · liability {i.liabilityPct}% (max −{i.maxPenaltyPoints}) · expires {fmtDate(i.expiresAt, false)}
                </span>
                {i.status === 'OPEN' && (
                  <span className="ml-auto flex gap-2">
                    <a className="text-xs font-medium text-brand-700 hover:underline" href={`/join?code=${i.code}`}>
                      Join link
                    </a>
                    <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => revokeInv.mutate(i.id)}>
                      Revoke
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <InviteModal open={modal === 'invite'} onClose={() => setModal(null)} />
      <ProposeVouchModal open={modal === 'vouch'} onClose={() => setModal(null)} graph={graph} />
      {amend && <AmendModal vouch={amend} onClose={() => setAmend(null)} />}
    </div>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [key, setKey] = useState(0);
  return (
    <Modal open={open} onClose={() => { setKey((k) => k + 1); onClose(); }} title="Create an invitation">
      <InviteForm key={key} />
    </Modal>
  );
}

/** Invitation form: liability terms and the maximum penalty are shown, and consent is required, before creating it. */
export function InviteForm({ inviterLabel }: { inviterLabel?: string }) {
  const [name, setName] = useState('');
  const [s, setS] = useState(0.7);
  const [l, setL] = useState(10);
  const [ack, setAck] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const create = useAction(() => createInvitation({ inviteeName: name, strength: s, liabilityPct: l }), (r) => setCode(r.invitation.code));
  return code ? (
    <Success>
      Invitation created. Share the code <span className="font-mono font-semibold">{code}</span> or the link{' '}
      <a className="underline" href={`/join?code=${code}`}>/join?code={code}</a>. The vouch activates only after they accept the terms.
    </Success>
  ) : (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
      <Field label="Invitee name" htmlFor="iname">
        <input id="iname" className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </Field>
      <TermsChooser strength={s} liability={l} onChange={(a, b) => { setS(a); setL(b); }} ack={ack} onAck={setAck} voucherLabel={inviterLabel} />
      <ErrorBox error={create.error} />
      <Button type="submit" disabled={!ack} busy={create.isPending}>
        Create invitation
      </Button>
    </form>
  );
}

function ProposeVouchModal({ open, onClose, graph }: { open: boolean; onClose: () => void; graph?: GraphView }) {
  const { me } = useAuth();
  const [who, setWho] = useState('');
  const [s, setS] = useState(0.4);
  const [l, setL] = useState(10);
  const [ack, setAck] = useState(false);
  const create = useAction(() => proposeVouch({ voucheeId: who, strength: s, liabilityPct: l }), onClose);
  return (
    <Modal open={open} onClose={onClose} title="Propose a vouch">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
        <Field label="Member" htmlFor="who" hint="They must consent before the vouch becomes active.">
          <select id="who" className="input" value={who} onChange={(e) => setWho(e.target.value)} required>
            <option value="">Choose a member…</option>
            {graph?.nodes
              .filter((n) => n.id !== me?.member.id && n.status === 'ACTIVE')
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.displayName}
                </option>
              ))}
          </select>
        </Field>
        {who && <WhoCard id={who} />}
        <TermsChooser strength={s} liability={l} onChange={(a, b) => { setS(a); setL(b); }} ack={ack} onAck={setAck} />
        <ErrorBox error={create.error} />
        <Button type="submit" disabled={!ack || !who} busy={create.isPending}>
          Propose vouch
        </Button>
      </form>
    </Modal>
  );
}

function AmendModal({ vouch, onClose }: { vouch: MyVouch; onClose: () => void }) {
  const [s, setS] = useState(vouch.strength);
  const [l, setL] = useState(vouch.liabilityPct);
  const [ack, setAck] = useState(false);
  const save = useAction(() => amendVouch(vouch.id, { strength: s, liabilityPct: l }), onClose);
  return (
    <Modal open onClose={onClose} title="Propose a change to this vouch">
      <p className="mb-3 text-sm text-slate-600">
        Strength can rise one level at a time and only after at least one settled exchange between you. The other member must consent; raising liability always needs the voucher’s fresh consent.
      </p>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <TermsChooser strength={s} liability={l} onChange={(a, b) => { setS(a); setL(b); }} ack={ack} onAck={setAck} voucherLabel={vouch.voucher.displayName} />
        <ErrorBox error={save.error} />
        <Button type="submit" disabled={!ack} busy={save.isPending}>
          Send proposal
        </Button>
      </form>
    </Modal>
  );
}

/** Who you are about to vouch for: their profile (self-reported vs verified vs records). */
function WhoCard({ id }: { id: string }) {
  const q = useProfile(id);
  if (!q.data) return <Loading />;
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <ProfileCard p={q.data.profile} compact />
    </div>
  );
}
