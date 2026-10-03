import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorBox, Field } from '../../components/ui';
import { Avatar } from '../../components/MemberChip';
import { useAuth } from '../../lib/auth';
import { useAction } from '../../lib/mutations';
import { switchAccount, useDemoState } from '../demo/api';
import { login } from './api';
import { TAGLINE } from './JoinChooserPage';

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
          <p className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-slate-900">{TAGLINE}</p>
          <p className="mt-3 text-slate-600">
            CommonHours connects members through useful, niche communities, starting with one circle per Hong Kong university. Share what you are good at, ask for
            what you need, and build trust through meaningful exchanges. One hour of help = one time credit, whatever the skill.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-slate-700">
            <li>• Join with an invitation or as a student of a Hong Kong university</li>
            <li>• Circles for Coding, Tutoring, Language practice, and Moving and practical help</li>
            <li>• Consented, bounded vouches; trust is earned through helping</li>
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
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Link className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-800 hover:border-brand-400 hover:bg-brand-50" to="/join/invitation">
              Join with an invitation
            </Link>
            <Link className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-medium text-slate-800 hover:border-brand-400 hover:bg-brand-50" to="/join/student">
              Join as a student
            </Link>
          </div>
          {demo.data && (
            <Link to="/demo" className="mt-4 block rounded-xl bg-amber-400 px-4 py-3 text-center text-base font-semibold text-amber-950 shadow-sm hover:bg-amber-300">
              Simple demo <span className="block text-xs font-normal">A guided five-chapter tour. No sign-up needed.</span>
            </Link>
          )}
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
