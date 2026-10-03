import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorBox, Field, Loading } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { StudentDetailsFields, studentInput, useStudentDraft } from '../student/StudentDetailsFields';
import { join, previewInvitation, usePublicConfig } from './api';
import { JoinHeader } from './JoinChooserPage';

/** Route 1, "Join with an invitation": the community terms AND the vouch terms. The code is always validated. */
export function InvitationJoinPage() {
  const demoMode = usePublicConfig().data?.demoMode ?? false;
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [submittedCode, setSubmittedCode] = useState(params.get('code') ?? '');
  const inv = useQuery({ queryKey: ['invite', submittedCode], queryFn: () => previewInvitation(submittedCode), enabled: !!submittedCode, retry: false });
  const { signIn } = useAuth();
  const [form, setForm] = useState({ displayName: '', handle: '', email: '', password: '', acceptCommunityTerms: false, acceptVouchTerms: false });
  const [asStudent, setAsStudent] = useState(false);
  const [student, setStudent] = useStudentDraft();
  const studentDetails = asStudent ? studentInput(student) : undefined;
  const doJoin = useAction(
    () =>
      join({
        code: submittedCode,
        ...form,
        // Student registration: the university email is the login email (the API checks the domain again).
        ...(studentDetails ? { email: studentDetails.studentEmail, student: studentDetails } : {}),
        acceptCommunityTerms: form.acceptCommunityTerms as true,
        acceptVouchTerms: form.acceptVouchTerms as true,
      }),
    (r) => signIn(r.token),
  );
  const i = inv.data?.invitation;
  return (
    <div className="mx-auto max-w-2xl p-4 py-10">
      <JoinHeader title="Join with an invitation" />
      <p className="mt-1 text-sm text-slate-600">Enter your invitation code to read the terms before you join. No invitation? <Link to="/join/student" className="font-medium text-brand-700 hover:underline">Join as a student</Link>.</p>
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedCode(code.trim());
        }}
      >
        <label className="sr-only" htmlFor="code">
          Invitation code
        </label>
        <input id="code" className="input" placeholder="Invitation code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" variant="secondary">
          Check
        </Button>
      </form>
      {inv.isLoading && <Loading />}
      <div className="mt-4">
        <ErrorBox error={inv.error} title="Invitation not usable" />
      </div>
      {i && (
        <div className="mt-6 space-y-6">
          <Card title="Your invitation">
            <p className="text-sm">
              <MemberChip m={i.inviter} /> invites <strong>{i.inviteeName}</strong>. Expires {fmtDate(i.expiresAt)}.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="text-slate-500">Vouch strength</div>
                <div className="text-xl font-semibold">{i.strength}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="text-slate-500">Inviter liability</div>
                <div className="text-xl font-semibold">{i.liabilityPct}%</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                <div className="text-slate-500">Max penalty to inviter</div>
                <div className="text-xl font-semibold">{i.maxPenaltyPoints} pts</div>
              </div>
            </div>
            <h3 className="mb-2 mt-5">Terms you are accepting</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
              {i.terms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
          <Card title="Create your account">
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                doJoin.mutate(undefined);
              }}
            >
              <Field label="Display name" htmlFor="dn">
                <input id="dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </Field>
              <Field label="Handle" htmlFor="handle" hint="lowercase, e.g. noor">
                <input id="handle" className="input" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase() })} required />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="label">Account type</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { v: false, t: 'Register as a community member', d: 'Use any email address.' },
                    { v: true, t: 'Register as a student', d: demoMode ? 'Use your university email (demo mode: no verification needed).' : 'Use your university email; verify it with a code.' },
                  ].map((o) => (
                    <label key={String(o.v)} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${asStudent === o.v ? 'border-brand-700 bg-brand-50 ring-2 ring-brand-600' : 'border-slate-300'}`}>
                      <input type="radio" name="account-type" className="mt-1" checked={asStudent === o.v} onChange={() => setAsStudent(o.v)} />
                      <span>
                        <span className="font-medium">{o.t}</span>
                        <span className="block text-xs text-slate-500">{o.d}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {asStudent ? (
                <div className="sm:col-span-2">
                  <StudentDetailsFields draft={student} onChange={setStudent} />
                  <p className="mt-2 text-xs text-slate-500">
                    {demoMode
                      ? 'Demo mode: no code is sent and nothing is verified. Your affiliation is shown as “Demo student”, and you join your university circle straight away.'
                      : 'After joining, a one-time code is sent to this address. “University email verified” appears only after you enter it.'}
                  </p>
                </div>
              ) : (
                <Field label="Email" htmlFor="jemail">
                  <input id="jemail" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
                </Field>
              )}
              <Field label="Password" htmlFor="jpw" hint="At least 8 characters">
                <input id="jpw" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-1" checked={form.acceptCommunityTerms} onChange={(e) => setForm({ ...form, acceptCommunityTerms: e.target.checked })} />I accept the community terms.
              </label>
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="mt-1" checked={form.acceptVouchTerms} onChange={(e) => setForm({ ...form, acceptVouchTerms: e.target.checked })} />I accept the vouch terms (strength {i.strength}, liability {i.liabilityPct}% for my inviter).
              </label>
              <div className="sm:col-span-2">
                <ErrorBox error={doJoin.error} title="Could not join" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" busy={doJoin.isPending} disabled={!form.acceptCommunityTerms || !form.acceptVouchTerms || (asStudent && !studentDetails)}>
                  Join and activate the vouch
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
