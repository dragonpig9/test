import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorBox, Field } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useAction } from '../../lib/mutations';
import { StudentDetailsFields, studentInput, useStudentDraft } from '../student/StudentDetailsFields';
import { joinAsStudent, studentTerms, usePublicConfig } from './api';
import { JoinHeader } from './JoinChooserPage';

/**
 * Route 2, "Join as a student": no invitation code. University buttons → the email suffix is chosen
 * automatically → [username] @suffix with a full preview. Demo mode: create the account and go straight
 * into the university circle. Normal mode: the account must verify its university email first.
 */
export function StudentJoinPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const demoMode = usePublicConfig().data?.demoMode ?? false;
  const terms = useQuery({ queryKey: ['student-terms'], queryFn: studentTerms });
  const [draft, setDraft] = useStudentDraft();
  const [form, setForm] = useState({ displayName: '', handle: '', password: '', acceptCommunityTerms: false });
  const student = studentInput(draft);
  const doJoin = useAction(
    () => joinAsStudent({ ...form, acceptCommunityTerms: form.acceptCommunityTerms as true, student: student! }),
    (r) => {
      signIn(r.token);
      navigate('/circles', { replace: true });
    },
  );
  return (
    <div className="mx-auto max-w-2xl p-4 py-10">
      <JoinHeader title="Join as a student" />
      <p className="mt-1 text-sm text-slate-600">
        {demoMode
          ? 'Demo mode: choose your university, enter your details and you are in. No university mailbox is needed.'
          : 'Choose your university and enter your university email. After joining, verify the address with a one-time code to unlock your circle.'}
      </p>
      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          doJoin.mutate(undefined);
        }}
      >
        <Card title="Your university">
          <StudentDetailsFields draft={draft} onChange={setDraft} />
        </Card>
        <Card title="Your account">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor="s-dn">
              <input id="s-dn" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
            </Field>
            <Field label="Handle" htmlFor="s-handle" hint="lowercase, e.g. hana">
              <input id="s-handle" className="input" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value.toLowerCase() })} required />
            </Field>
            <Field label="Password" htmlFor="s-pw" hint="At least 8 characters. You sign in with your university email.">
              <input id="s-pw" className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
          </div>
          {terms.data && (
            <>
              <h3 className="mb-2 mt-5">Community terms</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
                {terms.data.terms.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={form.acceptCommunityTerms} onChange={(e) => setForm({ ...form, acceptCommunityTerms: e.target.checked })} />I accept the community terms.
          </label>
        </Card>
        <ErrorBox error={doJoin.error} title="Could not join" />
        <Button type="submit" busy={doJoin.isPending} disabled={!student || !form.acceptCommunityTerms}>
          {demoMode ? 'Create account and enter' : 'Create account'}
        </Button>
      </form>
    </div>
  );
}
