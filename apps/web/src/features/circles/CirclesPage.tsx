import { useState } from 'react';
import type { CircleMessageInput } from '@commonhours/shared';
import { Link } from 'react-router-dom';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, StatusChip } from '../../components/ui';
import { MemberChip } from '../../components/MemberChip';
import { fmtDate } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { StudentStatusCard } from '../student/StudentStatusCard';
import { postCircleMessage, useCircleBoard, useCircleRoom, useMyCircle } from './api';
import { TagFilter, TagPicker, Tags } from './TagPicker';

/**
 * Find your circle: one shared room per university (the initial circles), with topic tags to find
 * relevant conversations, requests and offers. Access is decided by the server on every request.
 */
export function CirclesPage() {
  const mine = useMyCircle();
  const [tag, setTag] = useState<string | null>(null);
  const c = mine.data;
  const code = c?.allowed ? c.circle?.code : undefined;
  return (
    <div>
      <PageHeader title="Circles" subtitle="Find your circle. Share your skills. Build trust through helping." />
      {mine.isLoading ? (
        <Loading />
      ) : mine.error ? (
        <ErrorBox error={mine.error} title="Could not load your circle" />
      ) : !c?.circle ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Join your university circle">
            <p className="text-sm text-slate-600">Add your university below to join its circle. Each Hong Kong university has one shared circle.</p>
          </Card>
          <StudentStatusCard />
        </div>
      ) : !c.allowed ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={c.circle.name}>
            <p className="text-sm text-slate-700">{c.reason}</p>
          </Card>
          <StudentStatusCard />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-lg">{c.circle.name}</h2>
            <span className="text-sm text-slate-500">
              {c.circle.universityName} · {c.circle.memberCount} member{c.circle.memberCount === 1 ? '' : 's'}
            </span>
            {c.via === 'DEMO_SELF_DECLARED' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Demo: self-declared affiliation</span>}
            {c.via === 'VERIFIED_EMAIL' && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">✓ University email verified</span>}
          </div>
          <div className="mb-4">
            <TagFilter value={tag} onChange={setTag} />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="min-w-0 lg:col-span-3">
              <Conversation code={code!} tag={tag} />
            </div>
            <div className="min-w-0 lg:col-span-2">
              <Board code={code!} tag={tag} />
            </div>
          </div>
        </>
      )}
      {!!c?.formerCircles.length && (
        <p className="mt-6 text-xs text-slate-500">
          Former circles: {c.formerCircles.map((f) => `${f.name} (left ${fmtDate(f.leftAt, false)}${f.leftReason ? `: ${f.leftReason}` : ''})`).join('; ')}. Your earlier messages stay there.
        </p>
      )}
    </div>
  );
}

function Conversation({ code, tag }: { code: string; tag: string | null }) {
  const room = useCircleRoom(code, tag);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState<string[]>(tag ? [tag] : []);
  const send = useAction(() => postCircleMessage(code, { body, tags: tags as CircleMessageInput['tags'] }), () => setBody(''));
  return (
    <Card title="Conversation">
      {room.isLoading ? (
        <Loading />
      ) : room.error ? (
        <ErrorBox error={room.error} title="Could not open this circle" />
      ) : room.data && room.data.messages.length ? (
        <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1" aria-live="polite">
          {room.data.messages.map((m) => (
            <li key={m.id} className={m.mine ? 'rounded-xl bg-brand-50 p-3' : 'rounded-xl bg-slate-50 p-3'}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <MemberChip m={m.author} detail />
                <span>{fmtDate(m.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{m.body}</p>
              <div className="mt-1">
                <Tags tags={m.tags} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title={tag ? `No #${tag} messages yet` : 'No messages yet'}>Say hello, or post what you can help with.</Empty>
      )}
      <form
        className="mt-4 space-y-2 border-t border-slate-100 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate(undefined);
        }}
      >
        <label className="label" htmlFor="circle-msg">
          Message
        </label>
        <textarea id="circle-msg" className="input min-h-[4rem]" maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What can you help with, or what do you need?" />
        <TagPicker value={tags} onChange={setTags} label="Message topics" />
        <ErrorBox error={send.error} title="Message not sent" />
        <Button type="submit" busy={send.isPending} disabled={!body.trim()}>
          Send
        </Button>
      </form>
      {room.data && <p className="mt-3 text-xs text-slate-500">{room.data.note}</p>}
    </Card>
  );
}

function Board({ code, tag }: { code: string; tag: string | null }) {
  const board = useCircleBoard(code, tag);
  return (
    <Card title="Requests and offers in this circle" actions={<Link to="/services" className="text-sm font-medium text-brand-700 hover:underline">Service Board</Link>}>
      {board.isLoading ? (
        <Loading />
      ) : board.error ? (
        <ErrorBox error={board.error} />
      ) : board.data?.listings.length ? (
        <ul className="divide-y divide-slate-100">
          {board.data.listings.map((l) => (
            <li key={l.id} className="py-2.5">
              <div className="flex items-center gap-2">
                <StatusChip status={l.type === 'OFFER' ? 'ACCEPTED' : 'PROPOSED'} label={l.type === 'OFFER' ? 'Offer' : 'Request'} />
                <Link to={`/services?owner=${l.owner.id}`} className="truncate text-sm font-medium text-slate-900 hover:text-brand-700">
                  {l.title}
                </Link>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <MemberChip m={l.owner} />
                <Tags tags={l.tags} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={tag ? `No #${tag} requests or offers` : 'No requests or offers yet'}>Post one on the Service Board and tag it so circle members can find it.</Empty>
      )}
    </Card>
  );
}
