import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { usePublicConfig } from './api';

export const TAGLINE = 'Find your circle. Share your skills. Build trust through helping.';

export function JoinHeader({ title }: { title: string }) {
  return (
    <>
      <Link to="/join" className="text-sm text-brand-700 hover:underline">
        ← Ways to join
      </Link>
      <h1 className="mt-4">{title}</h1>
    </>
  );
}

/** Two clear ways to join. Invitation links (/join?code=…) go straight to the invitation route. */
export function JoinChooserPage() {
  const [params] = useSearchParams();
  const demoMode = usePublicConfig().data?.demoMode ?? false;
  const code = params.get('code');
  if (code) return <Navigate to={`/join/invitation?code=${encodeURIComponent(code)}`} replace />;
  return (
    <div className="mx-auto max-w-2xl p-4 py-10">
      <Link to="/" className="text-sm text-brand-700 hover:underline">
        ← Back to sign in
      </Link>
      <h1 className="mt-4">Join CommonHours</h1>
      <p className="mt-1 text-slate-700">{TAGLINE}</p>
      <p className="mt-1 text-sm text-slate-600">CommonHours connects members through useful, niche communities, starting with one circle per Hong Kong university.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/join/invitation" className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm hover:border-brand-500 hover:bg-brand-50">
          <span className="block text-lg font-semibold text-slate-900">Join with an invitation</span>
          <span className="mt-1 block text-sm text-slate-600">A member invited you and vouches for you. Enter your invitation code.</span>
        </Link>
        <Link to="/join/student" className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm hover:border-brand-500 hover:bg-brand-50">
          <span className="block text-lg font-semibold text-slate-900">Join as a student</span>
          <span className="mt-1 block text-sm text-slate-600">
            No invitation needed. Pick your university and join its circle{demoMode ? ' straight away' : ' after verifying your university email'}.
          </span>
        </Link>
      </div>
      {demoMode && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <span className="font-semibold">Demo mode.</span> University email verification is skipped for this demo, and nothing is emailed. Accounts are labelled “Demo student”, never “verified”.
        </p>
      )}
    </div>
  );
}
