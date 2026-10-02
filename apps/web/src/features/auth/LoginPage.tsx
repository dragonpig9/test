import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorBox, Field } from '../../components/ui';
import { Avatar } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { useAction } from '../../lib/mutations';
import { switchAccount, useDemoState } from '../demo/api';
import { login } from './api';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const demo = useDemoState();
  const doLogin = useAction(() => login({ email, password }), (r) => signIn(r.token));
  const doSwitch = useAction((h: string) => switchAccount(h), (r) => signIn(r.token));
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-teal-50 p-4">
      <div className="w-full max-w-4xl gap-8 lg:grid lg:grid-cols-2">
        <div className="mb-8 lg:mb-0 lg:pt-8">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-xl text-white" aria-hidden>
              ◷
            </span>
            <span className="text-2xl font-semibold tracking-tight">CommonHours</span>
          </div>
          <p className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-slate-900">Recognise value that gets overlooked.</p>
          <p className="mt-3 text-slate-600">
            Turn the skills your community already has into help everyone can access — with clear agreements and shared accountability. One hour of help = one time
            credit, whatever the skill.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-700">
            <li>• Invite-only membership with consented, bounded vouches</li>
            <li>• Terms agreed before work starts; disputes judged only against them</li>
            <li>• Every balance, score and decision is explainable and audited</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl">Sign in</h1>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              doLogin.mutate(undefined);
            }}
          >
            <Field label="Email" htmlFor="email">
              <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" htmlFor="password">
              <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <ErrorBox error={doLogin.error} title="Could not sign in" />
            <Button type="submit" busy={doLogin.isPending} className="w-full">
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Have an invitation code?{' '}
            <Link className="font-medium text-brand-700 hover:underline" to="/join">
              Join with an invitation
            </Link>
          </p>
          {demo.data && (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-sm font-semibold text-slate-900">
                Demo account switcher <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">demo only</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Seeded members (password: commonhours-demo). Start as Mei for the guided story.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {demo.data.members.map((m) => (
                  <button key={m.id} type="button" onClick={() => doSwitch.mutate(m.handle)} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50">
                    <Avatar m={m} size="sm" />
                    <span className="truncate">{m.displayName}</span>
                  </button>
                ))}
              </div>
              <ErrorBox error={doSwitch.error} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
