import { Link } from 'react-router-dom';
import type { MemberSummary } from '@commonhours/shared';
import { Card, ErrorBox, Loading } from '../../components/ui';
import { ProfileCard } from '../profiles/ProfileCard';
import { useProfile } from '../profiles/api';

/** Member card in the trust graph: the shared profile card (self-reported vs verified vs records). */
export function MemberProfilePanel({ member }: { member: MemberSummary }) {
  const q = useProfile(member.id);
  return (
    <Card title="Member profile">
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : q.data && <ProfileCard p={q.data.profile} compact />}
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-medium">
        <Link to={`/profile/${member.id}`} className="text-brand-700 hover:underline">
          Full profile →
        </Link>
        <Link to={`/services?owner=${member.id}`} className="text-brand-700 hover:underline">
          Their listings →
        </Link>
      </div>
    </Card>
  );
}
