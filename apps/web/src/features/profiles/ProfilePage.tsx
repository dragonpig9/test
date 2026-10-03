import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SERVICE_CATEGORIES, type ProfileView, type SkillClaimInput, type SkillClaimView } from '@commonhours/shared';
import { Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, StatusChip, Success } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { claimSkill, confirmEmailCode, requestEmailCode, requestPhoneCode, reviewSkill, updateProfile, useOutbox, useProfile, useReviewableClaims, useSkills } from './api';
import { StudentStatusCard } from '../student/StudentStatusCard';
import { ProfileCard, VerificationPill } from './ProfileCard';

export function ProfilePage() {
  const { id } = useParams();
  const { me } = useAuth();
  const memberId = id ?? me?.member.id;
  const own = memberId === me?.member.id;
  const q = useProfile(memberId);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} title="Could not load the profile" />;
  if (!q.data) return null;
  const p = q.data.profile;
  if (!own) {
    return (
      <div>
        <PageHeader title={p.selfReported.displayName} subtitle="Public profile. Self-reported details are shown separately from verified information and community records." />
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <ProfileCard p={p} />
          </Card>
          <SkillsCard memberId={p.member.id} own={false} />
        </div>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="My Profile" subtitle="Edit what others see. Email, phone and home address stay private unless you choose to share them; “verified” appears only after a real verification." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <EditForm p={p} />
          <SkillsCard memberId={p.member.id} own />
          <ReviewCard />
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="How others see you">
            <ProfileCard p={p} />
          </Card>
          <VerificationCard p={p} />
          <StudentStatusCard />
        </div>
      </div>
    </div>
  );
}

function EditForm({ p }: { p: ProfileView }) {
  const s = p.selfReported;
  const init = () => ({
    displayName: s.displayName,
    photoUrl: s.photoUrl ?? '',
    intro: s.intro,
    affiliation: s.affiliation,
    neighborhood: s.neighborhood,
    languages: s.languages.join(', '),
    skills: s.skills.join(', '),
    availability: s.availability,
    contactEmail: p.contact?.email ?? '',
    phone: p.contact?.phone ?? '',
    homeAddress: p.private?.homeAddress ?? '',
    shareContactWithPartners: p.private?.shareContactWithPartners ?? false,
    juryAvailable: p.private?.juryAvailable ?? true,
  });
  const [f, setF] = useState(init);
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(init()), [p]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const save = useAction(
    () => updateProfile({ ...f, languages: list(f.languages), skills: list(f.skills) }),
    () => setSaved(true),
  );
  const set = <K extends keyof ReturnType<typeof init>>(k: K, v: ReturnType<typeof init>[K]) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };
  return (
    <Card title="Edit profile">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <p className="text-xs text-slate-500">Everything in this section is self-reported: other members see it labelled as such.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Display name" htmlFor="pf-name">
            <input id="pf-name" className="input" value={f.displayName} onChange={(e) => set('displayName', e.target.value)} required minLength={2} />
          </Field>
          <Field label="Profile photo URL (https)" htmlFor="pf-photo" hint="Optional. Initials are shown otherwise.">
            <input id="pf-photo" className="input" value={f.photoUrl} onChange={(e) => set('photoUrl', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="University / community affiliation" htmlFor="pf-aff">
            <input id="pf-aff" className="input" value={f.affiliation} onChange={(e) => set('affiliation', e.target.value)} />
          </Field>
          <Field label="General neighbourhood" htmlFor="pf-hood" hint="An area, never your address.">
            <input id="pf-hood" className="input" value={f.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />
          </Field>
          <Field label="Languages (comma separated)" htmlFor="pf-lang">
            <input id="pf-lang" className="input" value={f.languages} onChange={(e) => set('languages', e.target.value)} />
          </Field>
          <Field label="Skills (comma separated)" htmlFor="pf-skills" hint="Self-described. Prices only change through a peer-reviewed skill tier.">
            <input id="pf-skills" className="input" value={f.skills} onChange={(e) => set('skills', e.target.value)} />
          </Field>
          <Field label="Availability" htmlFor="pf-av">
            <input id="pf-av" className="input" value={f.availability} onChange={(e) => set('availability', e.target.value)} />
          </Field>
        </div>
        <Field label="Short introduction" htmlFor="pf-intro">
          <textarea id="pf-intro" className="input" rows={2} value={f.intro} onChange={(e) => set('intro', e.target.value)} maxLength={500} />
        </Field>
        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold">Private details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact email" htmlFor="pf-email" hint="Changing it clears its verification and pauses email notifications.">
              <input id="pf-email" className="input" type="email" value={f.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="e.g. you@gmail.com" />
            </Field>
            <Field label="Phone" htmlFor="pf-phone">
              <input id="pf-phone" className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
          </div>
          <Field label="Exact home address" htmlFor="pf-addr" hint="Shown only to the provider of an accepted in-home exchange with you. Never emailed.">
            <input id="pf-addr" className="input" value={f.homeAddress} onChange={(e) => set('homeAddress', e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={f.shareContactWithPartners} onChange={(e) => set('shareContactWithPartners', e.target.checked)} />
            Share my contact email and phone with members I have an active (accepted) exchange with. Off by default.
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={f.juryAvailable} onChange={(e) => set('juryAvailable', e.target.checked)} />
            Available for jury duty (attesting disputes).
          </label>
        </fieldset>
        <ErrorBox error={save.error} />
        {saved && <Success>Profile saved.</Success>}
        <Button type="submit" busy={save.isPending}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

function VerificationCard({ p }: { p: ProfileView }) {
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ sentTo: string; delivery: string } | null>(null);
  const send = useAction(() => requestEmailCode(), (r) => setSent(r));
  const confirm = useAction(() => confirmEmailCode(code), () => setCode(''));
  const phone = useAction(() => requestPhoneCode());
  const outbox = useOutbox();
  const latest = outbox.data?.emails.find((e) => e.subject.includes('verify your contact email'));
  return (
    <Card title="Contact verification">
      <div className="mb-3 flex flex-wrap gap-2">
        <VerificationPill label="Email" v={p.verification.email} />
        <VerificationPill label="Phone" v={p.verification.phone} />
      </div>
      <p className="text-xs text-slate-600">{p.verification.email.note}</p>
      <div className="mt-3 space-y-3">
        <Button variant="secondary" busy={send.isPending} onClick={() => send.mutate(undefined)}>
          Send a code to {p.contact?.email ?? 'my email'}
        </Button>
        {sent && (
          <p className="rounded-lg bg-slate-50 p-2 text-xs">
            Code sent to {sent.sentTo}.{' '}
            {sent.delivery === 'preview' && 'Demo mode: nothing is emailed — the code is in the email preview below, so this verification will be labelled “demo-verified”.'}
          </p>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); confirm.mutate(undefined); }}>
          <Field label="6-digit code" htmlFor="code">
            <input id="code" className="input w-36" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} pattern="\d{6}" required />
          </Field>
          <Button type="submit" busy={confirm.isPending}>
            Verify
          </Button>
        </form>
        {latest && latest.status === 'PREVIEW' && (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-xs">
            <p className="font-semibold">Email preview (not sent) · {fmtDate(latest.createdAt)}</p>
            <p className="whitespace-pre-wrap">{latest.body}</p>
          </div>
        )}
        <Button variant="ghost" busy={phone.isPending} onClick={() => phone.mutate(undefined)}>
          Verify phone
        </Button>
        <ErrorBox error={send.error ?? confirm.error ?? phone.error} title="Verification" />
      </div>
    </Card>
  );
}

function SkillsCard({ memberId, own }: { memberId: string; own: boolean }) {
  const q = useSkills(memberId);
  const [f, setF] = useState<SkillClaimInput>({ category: 'Translation', tier: 'SKILLED', evidence: '' });
  const claim = useAction(() => claimSkill(f), () => setF({ ...f, evidence: '' }));
  const raised = q.data?.tiers.filter((t) => t.tier !== 'STANDARD') ?? [];
  return (
    <Card title="Skills and skill tiers">
      <p className="text-xs text-slate-600">
        A skill tier changes the price multiplier for one category: Skilled ×1.25, Advanced ×1.50, Specialist ×2.00. A claim with evidence needs approval by qualified peers (1 review; Specialist needs 2) — self-selecting “expert” never raises a price on its own.
      </p>
      {q.isLoading ? (
        <Loading />
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-sm">
            {raised.length ? (
              raised.map((t) => (
                <li key={t.category}>
                  <strong>{t.category}</strong>: {t.tier.toLowerCase()} ×{(t.multiplierPct / 100).toFixed(2)} <span className="text-xs text-slate-500">— {t.reason}</span>
                </li>
              ))
            ) : (
              <li className="text-slate-600">Standard rate (×1.00) in every category.</li>
            )}
          </ul>
          {!!q.data?.claims.length && (
            <ul className="mt-3 space-y-2">
              {q.data.claims.map((c) => (
                <ClaimRow key={c.id} c={c} />
              ))}
            </ul>
          )}
        </>
      )}
      {own && (
        <form className="mt-4 space-y-2 border-t border-slate-100 pt-3" onSubmit={(e) => { e.preventDefault(); claim.mutate(undefined); }}>
          <p className="text-sm font-semibold">Ask for a higher tier</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className="input" aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as SkillClaimInput['category'] })}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select className="input" aria-label="Tier" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value as SkillClaimInput['tier'] })}>
              <option value="SKILLED">Skilled ×1.25 (1 review)</option>
              <option value="ADVANCED">Advanced ×1.50 (1 review)</option>
              <option value="SPECIALIST">Specialist ×2.00 (2 reviews)</option>
            </select>
          </div>
          <textarea className="input" rows={2} aria-label="Evidence" placeholder="Evidence: certificates, experience, examples reviewers can check" value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} required minLength={10} />
          <ErrorBox error={claim.error} />
          <Button type="submit" variant="secondary" busy={claim.isPending}>
            Submit for peer review
          </Button>
        </form>
      )}
    </Card>
  );
}

function ClaimRow({ c, review }: { c: SkillClaimView; review?: boolean }) {
  const [note, setNote] = useState('');
  const act = useAction((approve: boolean) => reviewSkill(c.id, approve, note));
  return (
    <li className="rounded-lg border border-slate-200 p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {review && <MemberChip m={c.member} />}
        <strong>
          {c.category} — {c.tier.toLowerCase()}
        </strong>
        <StatusChip status={c.status === 'APPROVED' ? 'CONFIRMED' : c.status === 'DECLINED' ? 'REFUTED' : 'PENDING'} label={c.status.toLowerCase()} />
        <span className="text-xs text-slate-500">
          {c.approvals}/{c.requiredApprovals} approval(s) · {fmtDate(c.createdAt, false)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-700">Evidence: {c.evidence}</p>
      <p className="text-xs text-slate-500">
        Record in {c.category}: {c.record.settledServices} settled service(s), {c.record.nonperformanceFindings} nonperformance finding(s).
      </p>
      {c.reviews.map((r) => (
        <p key={r.reviewer.id} className="text-xs text-slate-600">
          {r.approve ? '✓' : '✗'} {r.reviewer.displayName}: “{r.note}”
        </p>
      ))}
      {review &&
        (c.canReview ? (
          <div className="mt-2 space-y-2">
            <input className="input" placeholder="Note for the record (what you checked)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2">
              <Button busy={act.isPending && act.variables === true} disabled={note.length < 5} onClick={() => act.mutate(true)}>
                Approve
              </Button>
              <Button variant="secondary" busy={act.isPending && act.variables === false} disabled={note.length < 5} onClick={() => act.mutate(false)}>
                Decline
              </Button>
            </div>
            <ErrorBox error={act.error} />
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-500">You can’t review this: {c.cannotReviewReason}</p>
        ))}
    </li>
  );
}

function ReviewCard() {
  const q = useReviewableClaims();
  return (
    <Card title="Skill claims waiting for review">
      {q.isLoading ? (
        <Loading />
      ) : q.data?.claims.length ? (
        <ul className="space-y-2">
          {q.data.claims.map((c) => (
            <ClaimRow key={c.id} c={c} review />
          ))}
        </ul>
      ) : (
        <Empty title="No pending claims">
          Reviewers need credibility ≥ 40 and no conflict with the claimant. <Link to="/credibility" className="text-brand-700 underline">My credibility</Link>
        </Empty>
      )}
    </Card>
  );
}
