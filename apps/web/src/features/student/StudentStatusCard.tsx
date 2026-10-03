import clsx from 'clsx';
import { useState } from 'react';
import { emailSuffixFor, type StudentStatusView, type UniversityCode } from '@commonhours/shared';
import { Button, Card, ErrorBox, Field, Loading, Success } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { useAuth } from '../../lib/auth';
import { useOutbox } from '../profiles/api';
import { confirmStudentCode, requestStudentCode, saveStudentDetails, useStudentStatus } from './api';
import { StudentDetailsFields, studentInput, useStudentDraft } from './StudentDetailsFields';

const PILL: Record<StudentStatusView['emailVerification'], [string, string]> = {
  VERIFIED: ['✓ University email verified', 'bg-emerald-100 text-emerald-900'],
  DEMO_VERIFIED: ['Development preview only — not verified', 'bg-amber-100 text-amber-900'],
  PENDING: ['University email not verified', 'bg-slate-100 text-slate-700'],
  NOT_PROVIDED: ['No university email', 'bg-slate-100 text-slate-500'],
};

/** Profile card: existing members add or change student details and verify their university email. */
export function StudentStatusCard() {
  const q = useStudentStatus();
  const s = q.data?.student;
  return (
    <Card title="Student details">
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : s && <StudentStatusBody s={s} />}
    </Card>
  );
}

function StudentStatusBody({ s }: { s: StudentStatusView }) {
  const { me } = useAuth();
  // Demo mode (server flag): no verification prompts. The verification flow itself is kept for normal mode.
  const prompts = me?.admission.showVerificationPrompts ?? true;
  const demoBadge = me?.admission.demoMode ? me.admission.demoBadge : null;
  const [editing, setEditing] = useState(!s.university);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ sentTo: string; delivery: string } | null>(null);
  const [reset, setReset] = useState(false);
  const [draft, setDraft] = useStudentDraft({
    university: (s.university?.code as UniversityCode | undefined) ?? null,
    localPart: s.studentEmail && s.university ? s.studentEmail.slice(0, -emailSuffixFor(s.university.code as UniversityCode).length) : '',
  });
  const input = studentInput(draft);
  const save = useAction(() => saveStudentDetails(input!), (r) => {
    setReset(r.verificationReset);
    setEditing(false);
    setSent(null);
  });
  const send = useAction(() => requestStudentCode(), (r) => setSent(r));
  const confirm = useAction(() => confirmStudentCode(code), () => setCode(''));
  const outbox = useOutbox();
  const preview = outbox.data?.emails.find((e) => e.subject.includes('university email') && e.status === 'PREVIEW');
  const [label, style] = demoBadge && s.emailVerification !== 'VERIFIED' ? [demoBadge, 'bg-amber-100 text-amber-900'] : PILL[s.emailVerification];
  const canVerify = prompts && !!s.studentEmail && s.emailVerification !== 'VERIFIED';

  return (
    <div className="space-y-4 text-sm">
      {s.university && (
        <div className="space-y-2">
          <p>
            <span className="font-semibold">{s.university.code}</span> · {s.university.name}
          </p>
          <p className="num text-slate-700">{s.studentEmail}</p>
          <div className="flex flex-wrap gap-2">
            <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', style)}>{label}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {s.declaredCurrentStudentAt ? `Current student: self-declared ${fmtDate(s.declaredCurrentStudentAt, false)}` : 'No current-student declaration'}
            </span>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
            {me?.admission.demoMode && s.emailVerification !== 'VERIFIED' && (
              <li>Demo mode: university email verification is skipped for the hackathon. Your affiliation is self-declared and is not shown as verified.</li>
            )}
            {s.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {reset && <Success>Student details saved. Because the university or email changed, please verify the new address.</Success>}

      {canVerify && !editing && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <Button variant="secondary" busy={send.isPending} onClick={() => send.mutate(undefined)}>
            Send a code to {s.studentEmail}
          </Button>
          {sent && (
            <p className="rounded-lg bg-slate-50 p-2 text-xs">
              Code sent to {sent.sentTo}. It expires in 30 minutes and works once.
              {sent.delivery === 'preview' && ' Development mode: nothing is emailed — the code is in the preview below, and the result is never labelled “verified”.'}
            </p>
          )}
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); confirm.mutate(undefined); }}>
            <Field label="6-digit code" htmlFor="student-code">
              <input id="student-code" className="input w-36" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} pattern="\d{6}" required />
            </Field>
            <Button type="submit" busy={confirm.isPending}>
              Verify university email
            </Button>
          </form>
          {preview && s.devPreviewDelivery && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-xs">
              <p className="font-semibold">Development email preview (not sent) · {fmtDate(preview.createdAt)}</p>
              <p className="whitespace-pre-wrap">{preview.body}</p>
            </div>
          )}
          <ErrorBox error={send.error ?? confirm.error} title="University email verification" />
        </div>
      )}

      {editing ? (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          {s.university && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Changing your university or university email removes the current verification; you will need to verify the new address.</p>}
          <StudentDetailsFields draft={draft} onChange={setDraft} />
          <ErrorBox error={save.error} title="Could not save student details" />
          <div className="flex gap-2">
            <Button type="submit" busy={save.isPending} disabled={!input}>
              {s.university ? 'Save student details' : 'Add student details'}
            </Button>
            {s.university && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button variant="ghost" onClick={() => setEditing(true)}>
          Change university or email
        </Button>
      )}
    </div>
  );
}
