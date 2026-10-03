import type { DemoWalkthroughView } from '@commonhours/shared';
import { MemberChip } from '../../../components/MemberChip';
import { Loading } from '../../../components/ui';
import { credits } from '../../../lib/format';
import { PriceBreakdown } from '../../pricing/PriceBreakdown';
import { EligibilityPanel, TierBadge } from '../../task-eligibility/EligibilityPanel';
import { EdgeDetails } from '../../trust-graph/EdgeDetails';
import { PathPanel } from '../../trust-graph/PathPanel';
import { TrustGraph } from '../../trust-graph/TrustGraph';
import { useGraph } from '../../trust-graph/api';
import { Concept, Details, Step } from './parts';

/** Chapter 1 (Demo Guide steps 1–4): Mei's need, Sam's offer, the trust path, Alice's vouch and the locked task. */
export function Chapter1Trust({ w }: { w: DemoWalkthroughView }) {
  const { cookingOffer, path, aliceVouch, catTask } = w.trust;
  const mei = w.members.mei;
  const cred = w.participants.mei.credibility;
  const elig = catTask?.eligibility ?? null;
  const highTrust = cred.permissions.find((p) => p.key === 'highTrustTasks');
  const earnedSteps = path?.steps.filter((s) => s.earned) ?? [];
  return (
    <div className="space-y-4">
      <Step title="Mei needs a home-cooked dinner. Sam offers one." state="info">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3 text-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Need</p>
            <p className="mt-1 font-medium">{mei.displayName}: “I’d love a proper home-cooked dinner this week.”</p>
            <p className="mt-1 text-xs text-slate-600">
              {mei.affiliation}. Her balance now: {credits(w.participants.mei.credits.posted)} credits posted, {credits(w.participants.mei.credits.available)} available. Members may commit down to {credits(w.participants.mei.credits.floor)}.
            </p>
          </div>
          {cookingOffer ? (
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Offer on the Service Board</p>
              <p className="mt-1 font-medium">
                {cookingOffer.title} <TierBadge tier={cookingOffer.trustTier} />
              </p>
              <p className="mt-1 text-xs text-slate-600">
                <MemberChip m={cookingOffer.owner} /> · {cookingOffer.durationMinutes / 60}h · {cookingOffer.location}
              </p>
              {cookingOffer.reachability && (
                <p className="mt-1 text-xs text-teal-800">
                  {cookingOffer.reachability.reachable ? `Reachable from Mei: ${cookingOffer.reachability.hops} hops, strength ${cookingOffer.reachability.strength}` : 'Not reachable from Mei'}
                </p>
              )}
              {cookingOffer.priceEstimate && (
                <p className="mt-1 text-xs">
                  <PriceBreakdown price={cookingOffer.priceEstimate} compact />
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">Sam’s cooking offer is no longer open on the Service Board.</p>
          )}
        </div>
      </Step>

      <Step title={`How Mei is connected to Sam`} state="info" note="CommonHours shows how two members are connected before they agree anything. The number is calculated now from active records.">
        {path?.found ? (
          <div>
            <ol className="flex flex-wrap items-center gap-1 text-sm" aria-label="Trust path">
              {path.steps.map((s, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i === 0 && <MemberChip m={s.from} />}
                  <span className={s.kind === 'earned' ? 'text-violet-700' : s.kind === 'both' ? 'text-teal-700' : 'text-slate-500'} title={`${s.kind}: × ${s.strength}`}>
                    —{s.strength}→
                  </span>
                  <MemberChip m={s.to} />
                </li>
              ))}
            </ol>
            <p className="mt-2 text-3xl font-semibold num text-teal-700">{path.strength}</p>
            <p className="text-xs text-slate-600">
              Path strength = the product of each pair’s strength: <span className="font-mono">{path.calculation}</span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-amber-800">{path?.explanation ?? 'No path found.'}</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Concept label="1 · Backing through vouches" tone="teal" title={aliceVouch ? `Alice vouched for Mei: ${aliceVouch.edge.effectiveStrength}` : 'No vouch from Alice'}>
            {aliceVouch && (
              <>
                Base strength {aliceVouch.edge.strength}, liability {aliceVouch.edge.liabilityPct}% (×{aliceVouch.liabilityMultiplier.toFixed(1)} backing) → backed{' '}
                {aliceVouch.backedStrength}
                {aliceVouch.edge.decayed ? `, decayed to ${aliceVouch.edge.effectiveStrength}` : ''}. If Mei were found not to have performed agreed work, Alice could lose at most{' '}
                <strong>{aliceVouch.edge.maxPenaltyPoints} credibility points</strong>. Liability never moves credits.
              </>
            )}
          </Concept>
          <Concept label="2 · Earned relationships" tone="violet" title={earnedSteps.length ? `${earnedSteps.length} pair(s) on this path also earned trust` : 'None on this path yet'}>
            Earned through exchanges both members confirmed: {earnedSteps.map((s) => `${s.from.displayName.split(' ')[0]}–${s.to.displayName.split(' ')[0]} ${s.earned!.effectiveStrength}`).join(', ') || '—'}. A pair with a vouch and an earned relationship counts as 1 − (1 − vouch)(1 − earned). Nobody carries liability for earned trust.
          </Concept>
          <Concept label="3 · Credibility" tone="amber" title={`Mei’s credibility: ${cred.score} / 100`}>
            A member score from her own record (completed services, confirmation rate, incoming vouches, dispute outcomes, attestation). It is not the path strength.
          </Concept>
          <Concept label="4 · Task eligibility" tone="sky" title={elig ? (elig.locked ? `🔒 Locked: needs ${elig.requiredCredibility}, has ${elig.currentCredibility}` : `✓ Credibility requirement met (${elig.currentCredibility} ≥ ${elig.requiredCredibility})`) : 'Task not open'}>
            Each task sets what a helper needs. Meeting the credibility threshold makes Mei <em>eligible to offer</em>; it never grants access to anyone’s home.
          </Concept>
        </div>
        <div className="mt-3">
          <Details title="Details: full trust graph, decay, age and calculations">
            <PathPanel path={path ?? undefined} loading={false} error={null} ready />
            {aliceVouch && <EdgeDetails edge={aliceVouch.edge} members={new Map(Object.values(w.members).map((m) => [m.id, m]))} />}
            <FullGraph pathFrom={mei.id} pathTo={w.members.sam.id} w={w} />
          </Details>
        </div>
      </Step>

      <Step title="A high-trust task Mei cannot take yet" state="info" note="Alice needs someone to let themselves into her home while she is away. That is the highest trust tier.">
        {catTask ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {catTask.title} <TierBadge tier={catTask.trustTier} /> <span className="text-xs font-normal text-slate-500">by {catTask.owner.displayName}</span>
            </p>
            <div className="grid gap-2 text-xs sm:grid-cols-3">
              <p className="rounded-lg bg-slate-50 p-2">
                Credibility needed: <strong>{elig?.requiredCredibility ?? highTrust?.threshold}</strong>
                <br />
                Mei has: <strong>{elig?.currentCredibility ?? cred.score}</strong>
              </p>
              <p className="rounded-lg bg-slate-50 p-2">
                Relationship trust Alice asks for: <strong>{catTask.minRelationshipTrust ?? '—'}</strong>
                <br />
                Mei ↔ Alice now: <strong>{elig?.currentRelationshipTrust ?? '—'}</strong>
              </p>
              <p className="rounded-lg border border-violet-200 bg-violet-50 p-2 text-violet-950">
                <strong>Alice’s home-access approval</strong> is still required for any exchange, even once Mei meets every threshold.
              </p>
            </div>
            {elig && (
              <Details title="Details: every eligibility check">
                <EligibilityPanel e={elig} />
              </Details>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600">Alice’s request is no longer open (it may already have been taken in this shared demo).</p>
        )}
      </Step>
    </div>
  );
}

function FullGraph({ w, pathFrom, pathTo }: { w: DemoWalkthroughView; pathFrom: string; pathTo: string }) {
  const g = useGraph();
  if (g.isLoading) return <Loading label="Loading the trust graph…" />;
  if (!g.data) return null;
  return (
    <div className="h-80 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <TrustGraph graph={g.data} path={w.trust.path ?? undefined} from={pathFrom} to={pathTo} onNode={() => undefined} onEdge={() => undefined} />
    </div>
  );
}
