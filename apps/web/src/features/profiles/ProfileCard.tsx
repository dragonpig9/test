import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { ProfileView, VerificationStatus } from '@commonhours/shared';
import { Avatar } from '../../components/MemberChip';
import { fmtDate } from '../../lib/format';

const VERIFY_STYLE: Record<VerificationStatus['status'], string> = {
  VERIFIED: 'bg-emerald-100 text-emerald-900',
  DEMO_VERIFIED: 'bg-amber-100 text-amber-900',
  UNVERIFIED: 'bg-slate-100 text-slate-700',
  NOT_PROVIDED: 'bg-slate-100 text-slate-500',
  UNAVAILABLE: 'bg-slate-100 text-slate-500',
};
const VERIFY_LABEL: Record<VerificationStatus['status'], string> = {
  VERIFIED: '✓ Verified',
  DEMO_VERIFIED: 'Demo-verified (not delivered)',
  UNVERIFIED: 'Not verified',
  NOT_PROVIDED: 'Not provided',
  UNAVAILABLE: 'Not verified',
};

export function VerificationPill({ label, v }: { label: string; v: VerificationStatus }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', VERIFY_STYLE[v.status])} title={v.note}>
      {label}: {VERIFY_LABEL[v.status]}
    </span>
  );
}

/**
 * A member's profile with three clearly separated groups: what they wrote (self-reported),
 * what was actually verified, and what comes from community records.
 */
export function ProfileCard({ p, compact }: { p: ProfileView; compact?: boolean }) {
  const s = p.selfReported;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3">
        <Avatar m={{ ...p.member, photoUrl: s.photoUrl }} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold">{s.displayName}</p>
          <p className="text-xs text-slate-500">
            @{p.member.handle}
            {p.member.isBootstrap && ' · bootstrap member'}
            {p.member.status === 'LEFT' && ' · has left'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <VerificationPill label="Email" v={p.verification.email} />
            <VerificationPill label="Phone" v={p.verification.phone} />
            {p.member.university && (
              <span
                className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', p.member.universityEmailVerified ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700')}
                title="Current enrolment is self-declared; university email ownership is verified separately."
              >
                {p.member.university} student{p.member.universityEmailVerified ? ' · ✓ University email verified' : ' · email not verified'}
              </span>
            )}
          </div>
        </div>
      </div>
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Self-reported (not checked)</h3>
        {s.intro && <p className="text-slate-700">{s.intro}</p>}
        <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
          {s.affiliation && (
            <>
              <dt className="text-slate-500">Affiliation</dt>
              <dd>{s.affiliation}</dd>
            </>
          )}
          {s.neighborhood && (
            <>
              <dt className="text-slate-500">Neighbourhood</dt>
              <dd>{s.neighborhood} (general area only)</dd>
            </>
          )}
          {s.languages.length > 0 && (
            <>
              <dt className="text-slate-500">Languages</dt>
              <dd>{s.languages.join(', ')}</dd>
            </>
          )}
          {s.availability && (
            <>
              <dt className="text-slate-500">Availability</dt>
              <dd>{s.availability}</dd>
            </>
          )}
          {s.skills.length > 0 && (
            <>
              <dt className="text-slate-500">Skills</dt>
              <dd>{s.skills.join(', ')}</dd>
            </>
          )}
        </dl>
      </section>
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">From community records</h3>
        <p>
          <strong className="num">{p.fromRecords.completedServiceCount}</strong> completed service(s) · member since {fmtDate(p.fromRecords.joinedAt, false)} · credibility{' '}
          <strong className="num">{p.fromRecords.credibility.score}</strong>{' '}
          <Link className="text-xs font-medium text-brand-700 hover:underline" to={`/credibility?member=${p.member.id}`}>
            see calculation
          </Link>
        </p>
        {!compact && (
          <ul className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-slate-600">
            {p.fromRecords.credibility.factors.map((f) => (
              <li key={f.key}>
                {f.label}: <span className="num">{f.points}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs">
          Skill tiers (peer-reviewed):{' '}
          {p.fromRecords.skillTiers.length ? p.fromRecords.skillTiers.map((t) => `${t.category} — ${t.tier.toLowerCase()} ×${(t.multiplierPct / 100).toFixed(2)}`).join('; ') : 'standard in all categories'}
        </p>
      </section>
      {p.contact && (
        <section className="rounded-lg bg-slate-50 p-2 text-xs">
          <p>
            <strong>Contact:</strong> {p.contact.email ?? '—'}
            {p.contact.phone ? ` · ${p.contact.phone}` : ''}
          </p>
          <p className="text-slate-500">{p.contact.visibility}</p>
        </section>
      )}
      {!compact && <p className="text-xs text-slate-500">{p.privacyNote}</p>}
    </div>
  );
}
