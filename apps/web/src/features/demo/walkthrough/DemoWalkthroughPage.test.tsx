// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoReadinessView, DemoWalkthroughView } from '@commonhours/shared';
import { DemoWalkthroughPage } from './DemoWalkthroughPage';

// Only the page shell is under test: data hooks and chapter bodies are stubbed.
const mei = { id: 'm1', handle: 'mei', displayName: 'Mei Chen' };
const w = {
  now: '2026-10-01T00:00:00.000Z',
  members: { mei },
  chapters: [1, 2, 3, 4, 5].map((n) => ({ n, done: false, steps: [{ n, title: `Step ${n}`, done: false }] })),
} as unknown as DemoWalkthroughView;

vi.mock('../../auth/api', () => ({ usePublicConfig: () => ({ data: { demoMode: true }, isLoading: false }) }));
vi.mock('../../../lib/auth', () => ({ useAuth: () => ({ signedIn: true, loading: false, signIn: vi.fn(), me: { member: mei } }) }));
vi.mock('../../../lib/mutations', () => ({ useAction: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }) }));
// What the server currently answers; tests change it and re-render.
const server: { readiness: DemoReadinessView; updatedAt: number } = { readiness: { status: 'READY', seedVersion: 'v1', detail: null, since: null }, updatedAt: 1 };
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useDemoReadiness: () => ({ data: server.readiness, dataUpdatedAt: server.updatedAt, error: null, refetch: vi.fn() }),
  useWalkthrough: (enabled: boolean) => ({ data: enabled ? { ...w, seedVersion: server.readiness.seedVersion } : undefined, error: null, errorUpdatedAt: 0, refetch: vi.fn() }),
}));
vi.mock('./parts', () => ({
  useActAs: () => ({ me: mei, switchTo: vi.fn(), pending: null, error: null }),
  ActAsButton: () => null,
  ClockNote: () => null,
}));
vi.mock('./Chapter1Trust', () => ({ Chapter1Trust: () => <p data-testid="chapter-body">Chapter1Trust</p> }));
vi.mock('./Chapter2Exchanges', () => ({ Chapter2Exchanges: () => <p data-testid="chapter-body">Chapter2Exchanges</p> }));
vi.mock('./Chapter3Pricing', () => ({ Chapter3Pricing: () => <p data-testid="chapter-body">Chapter3Pricing</p> }));
vi.mock('./Chapter4Dispute', () => ({ Chapter4Dispute: () => <p data-testid="chapter-body">Chapter4Dispute</p> }));
vi.mock('./Chapter5Results', () => ({ Chapter5Results: () => <p data-testid="chapter-body">Chapter5Results</p> }));
vi.mock('./EdgeCases', () => ({ EdgeCases: () => <p data-testid="chapter-body">EdgeCases</p> }));

let nav: ReturnType<typeof useNavigate>;
let loc: ReturnType<typeof useLocation>;
function Probe() {
  nav = useNavigate();
  loc = useLocation();
  return null;
}

let root: Root;
let host: HTMLDivElement;
let errors: unknown[];
const onError = (e: ErrorEvent) => errors.push(e.error);

beforeEach(() => {
  server.readiness = { status: 'READY', seedVersion: 'v1', detail: null, since: null };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  errors = [];
  window.addEventListener('error', onError);
  vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a));
  // Current Chrome returns a Promise from scrollTo; a mock returning undefined would hide the bug.
  window.scrollTo = vi.fn(() => Promise.resolve({ interrupted: false })) as unknown as typeof window.scrollTo;
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  window.removeEventListener('error', onError);
  vi.restoreAllMocks();
  host.remove();
});

const heading = () => host.querySelector('h1')?.textContent;
const body = () => host.querySelector('[data-testid="chapter-body"]')?.textContent;
const button = (name: RegExp) => [...host.querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''))!;
const click = (name: RegExp) => act(() => button(name).click());

let qc: QueryClient;
const tree = (path: string) => (
  <QueryClientProvider client={qc}>
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <DemoWalkthroughPage />
    </MemoryRouter>
  </QueryClientProvider>
);
async function mount(path: string) {
  qc = new QueryClient();
  root = createRoot(host);
  await act(() => root.render(tree(path)));
}
async function serverSays(r: Partial<DemoReadinessView>, path = '/demo?chapter=edge') {
  server.readiness = { ...server.readiness, ...r };
  server.updatedAt += 1;
  await act(() => root.render(tree(path)));
}

describe('Simple demo navigation', () => {
  it('moves between chapters without an effect cleanup crash when scrollTo returns a Promise', async () => {
    await mount('/demo');
    expect(body()).toBe('Chapter1Trust');

    await click(/Next: Exchange/);
    expect(loc.search).toBe('?chapter=2');
    expect(heading()).toBe('Agree, reserve and complete');
    expect(body()).toBe('Chapter2Exchanges');

    await click(/Back/);
    expect(body()).toBe('Chapter1Trust');

    // Every chapter button in the progress bar, then the edge cases.
    for (const [label, expected] of [
      [/Pricing$/, 'Chapter3Pricing'],
      [/Dispute$/, 'Chapter4Dispute'],
      [/Results$/, 'Chapter5Results'],
      [/^Explore edge cases$/, 'EdgeCases'],
      [/Exchange$/, 'Chapter2Exchanges'],
      [/Trust$/, 'Chapter1Trust'],
    ] as const) {
      await click(label);
      expect(body()).toBe(expected);
    }

    // Browser Back/Forward.
    await act(() => nav(-1));
    expect(body()).toBe('Chapter2Exchanges');
    await act(() => nav(1));
    expect(body()).toBe('Chapter1Trust');

    // Leaving /demo runs the last cleanup.
    await act(() => root.unmount());
    expect(window.scrollTo).toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('opens a direct chapter link', async () => {
    await mount('/demo?chapter=4');
    expect(body()).toBe('Chapter4Dispute');
    await act(() => root.unmount());
    expect(errors).toEqual([]);
  });
});

describe('Simple demo readiness', () => {
  it('shows "Preparing demo examples…" instead of partial data, then refreshes when ready', async () => {
    await mount('/demo?chapter=edge');
    expect(body()).toBe('EdgeCases');
    const reset = vi.spyOn(qc, 'resetQueries');

    await serverSays({ status: 'INITIALIZING', seedVersion: null });
    expect(host.textContent).toContain('Preparing demo examples…');
    expect(body()).toBeUndefined();

    // A different seed completed: cached data from the old community is dropped, then the page shows again.
    await serverSays({ status: 'READY', seedVersion: 'v2' });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(body()).toBe('EdgeCases');
    await act(() => root.unmount());
    expect(errors).toEqual([]);
  });

  it('explains a failed preparation with a retry, and never shows the examples', async () => {
    await mount('/demo?chapter=edge');
    await serverSays({ status: 'FAILED', seedVersion: null, detail: 'Demo fixture check failed: kettle missing.' });
    expect(host.textContent).toContain('The demo examples could not be prepared');
    expect(host.textContent).toContain('kettle missing');
    expect(button(/Try again/)).toBeTruthy();
    expect(body()).toBeUndefined();
    await act(() => root.unmount());
  });
});
