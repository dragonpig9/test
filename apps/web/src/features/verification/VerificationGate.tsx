import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { StudentStatusCard } from '../student/StudentStatusCard';

/**
 * Normal mode only: members who joined as students without an invitation verify their university
 * email before using the app. The server enforces the same rule on every request; this screen just
 * explains it. Never shown in demo mode (the server reports verificationRequired = false there).
 */
export function VerificationGate() {
  const { me, signOut } = useAuth();
  return (
    <div className="mx-auto max-w-2xl p-4 py-10">
      <h1>Verify your university email</h1>
      <p className="mt-2 text-sm text-slate-600">
        Hi {me?.member.displayName}. You joined as a student, so CommonHours needs to confirm that you own your university email before you can use circles,
        exchanges and the rest of the app. Send yourself a code below and enter it.
      </p>
      <div className="mt-6">
        <StudentStatusCard />
      </div>
      <Button variant="ghost" className="mt-4" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
