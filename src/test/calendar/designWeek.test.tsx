/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buttonLabel, doneLine, filmingLine, previewLine, progressLine, waitingLine, weekMinutes } from '@/lib/designWeek';
import { DesignWeekBand } from '@/components/calendar/DesignWeekButton';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
import { DesignRequestsDockItems } from '@/components/reports/calendar/DesignRequestsDock';
import { PostCard } from '@/components/reports/calendar/PostCard';

// The week's design button (Lital, 2 Nov 2026: "one button to design a whole
// week's posts, on request only, never automatic"). Staff see what a press
// would design and roughly what it costs, and press it; everyone sees the
// week's progress; each post says where it stands.

const f = vi.hoisted(() => ({
  staff: true,
  runs: [] as any[],
  requests: [] as any[],
  preview: null as any,
  invokes: [] as any[],
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    if (opts.body.action === 'week_preview') return { data: f.preview, error: null };
    if (opts.body.action === 'week_start') return { data: { run: { id: 'run-new' }, added: ['a'] }, error: null };
    if (opts.body.action === 'week_stop') return { data: { run: { id: 'run-1', status: 'stopped' } }, error: null };
    return { data: null, error: null };
  } },
  from: (table: string) => {
    const rows = () => (table === 'design_week_runs' ? f.runs : table === 'design_requests' ? f.requests : []);
    const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, then: (resolve: any) => Promise.resolve({ data: rows(), error: null }).then(resolve) };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.staff = true; f.runs = []; f.requests = []; f.preview = null; f.invokes = []; });

const WEEK = '2026-11-02';
const counts = (over: any = {}) => ({ single: 0, carousel: 0, video: 0, copy_waits: 0, filming: 0, ...over });
const request = (id: string, over: any = {}) => ({
  id, client_id: 'c1', calendar_post_key: `key-${id}`, platform: 'Instagram', post_copy: `Copy ${id}`, status: 'preparing', stage: 'designing', kind: 'single',
  options_wanted: 1, options_ready: 0, requested_by: 'me', error: null, created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:05:00Z', batch_id: null, ...over,
});
const run = (over: any = {}) => ({ id: 'run-1', client_id: 'c1', week_start: WEEK, status: 'running', posts: [], requested_by: 'me', created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:00:00Z', finished_at: null, ...over });
const runPost = (key: string, over: any = {}) => ({ post_key: key, kind: 'single', post_at: '2026-11-05T09:00:00Z', state: 'queued', added_by: 'me', added_at: '2026-11-03T10:00:00Z', ...over });

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
const band = () => mount(<DesignWeekBand clientId="c1" clientName="Pay The Pyper" week={WEEK} />);

describe('the words', () => {
  it('says what a press designs and roughly what it costs', () => {
    expect(previewLine(counts({ single: 6, carousel: 2, video: 1 }), 100, 45)).toBe('9 posts this week have no design yet: 6 designs, 2 carousels, 1 video. About 100 Higgsfield credits and 45 minutes.');
    expect(previewLine(counts({ single: 1 }), 0, 10)).toBe('1 post this week has no design yet: 1 design. About 10 minutes.');
    expect(previewLine(counts({ carousel: 3 }), 0, 75)).toBe('3 posts this week have no design yet: 3 carousels. About 1 hour and 15 minutes.');
    expect(buttonLabel(9)).toBe('Design 9 posts');
    expect(buttonLabel(1)).toBe('Design 1 post');
  });

  it('names filmed posts, and what the setup still waits for', () => {
    expect(filmingLine(1)).toBe("1 video is filmed, so it isn't included.");
    expect(filmingLine(2)).toBe("2 videos are filmed, so they aren't included.");
    expect(filmingLine(0)).toBeNull();
    expect(waitingLine('look', 'Pay The Pyper')).toBe("Designs start once Pay The Pyper's look is learned from its own posts.");
    expect(waitingLine('logo_file', 'Pay The Pyper')).toBe("Designs start once Pay The Pyper's logo file is found on its website.");
    expect(waitingLine('designed_posts', null)).toBe('Designs start once this client has published enough designed posts to learn its look from.');
  });

  it('counts the week as it goes, and when it is done', () => {
    expect(progressLine({ total: 9, ready: 3 })).toBe("Designing this week's posts: 3 of 9 ready.");
    expect(doneLine(9, null)).toBe('9 posts designed.');
    expect(doneLine(1, 145)).toBe('1 post designed. 145 Higgsfield credits used.');
    expect(doneLine(2, 0)).toBe('2 posts designed.');
  });

  it('takes the usual minutes of each post, two at a time, rounded up to five', () => {
    // 6 designs at 7, 2 carousels at 12 and a video at 18: 84 minutes, 42 at two at a time.
    expect(weekMinutes(counts({ single: 6, carousel: 2, video: 1 }), [])).toBe(45);
    // One long post is never shorter than itself.
    expect(weekMinutes(counts({ video: 1 }), [])).toBe(20);
  });
});

describe('the band', () => {
  it('shows staff what a press designs, and presses with the estimate shown', async () => {
    f.preview = { client_name: 'Pay The Pyper', week_start: WEEK, counts: counts({ single: 6, carousel: 2, video: 1, filming: 1 }), credits: 100, credits_per_clip: 100, run_id: null, credits_used: null };
    band();
    expect(await screen.findByText('9 posts this week have no design yet: 6 designs, 2 carousels, 1 video. About 100 Higgsfield credits and 45 minutes.')).toBeInTheDocument();
    expect(screen.getByText("1 video is filmed, so it isn't included.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Design 9 posts' }));
    await waitFor(() => expect(f.invokes.find((i) => i.action === 'week_start')).toBeTruthy());
    expect(f.invokes.find((i) => i.action === 'week_start')).toEqual({ name: 'design-request', action: 'week_start', client_id: 'c1', week_start: WEEK, estimate: { posts: 9, single: 6, carousel: 2, video: 1, credits: 100, minutes: 45 } });
  });

  it('offers nothing when the week has nothing to design', async () => {
    f.preview = { client_name: 'Pay The Pyper', week_start: WEEK, counts: counts(), credits: 0, credits_per_clip: 100, run_id: null, credits_used: null };
    band();
    await waitFor(() => expect(f.invokes.some((i) => i.action === 'week_preview')).toBe(true));
    expect(screen.queryByRole('button', { name: /^Design / })).toBeNull();
  });

  it("says what the client's setup waits for", async () => {
    f.preview = { code: 'not_set_up', waiting_for: 'look', client_name: 'Pay The Pyper' };
    band();
    expect(await screen.findByText("Designs start once Pay The Pyper's look is learned from its own posts.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Design / })).toBeNull();
  });

  it("shows a client's own users the week's progress, with no button and no estimate", async () => {
    f.staff = false;
    f.runs = [run({ posts: [runPost('a', { state: 'started', request_id: 'r1' }), runPost('b')] })];
    f.requests = [request('r1', { status: 'ready', stage: 'ready', batch_id: 'run-1', calendar_post_key: 'a' })];
    band();
    expect(await screen.findByText("Designing this week's posts: 1 of 2 ready.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(f.invokes.some((i) => i.action === 'week_preview')).toBe(false);
  });

  it('lets staff stop the rest of a running week', async () => {
    f.preview = { client_name: 'Pay The Pyper', week_start: WEEK, counts: counts(), credits: 0, credits_per_clip: 100, run_id: 'run-1', credits_used: 0 };
    f.runs = [run({ posts: [runPost('a', { state: 'started', request_id: 'r1' }), runPost('b')] })];
    f.requests = [request('r1', { batch_id: 'run-1', calendar_post_key: 'a' })];
    band();
    expect(await screen.findByText("Designing this week's posts: 0 of 2 ready.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop designing the rest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the rest' }));
    await waitFor(() => expect(f.invokes.find((i) => i.action === 'week_stop')).toEqual({ name: 'design-request', action: 'week_stop', run_id: 'run-1' }));
  });

  it('says how many posts were designed, and gives staff the credits used', async () => {
    f.preview = { client_name: 'Pay The Pyper', week_start: WEEK, counts: counts(), credits: 0, credits_per_clip: 100, run_id: 'run-1', credits_used: 145 };
    f.runs = [run({ status: 'done', finished_at: '2026-11-03T12:00:00Z', posts: [runPost('a', { state: 'started', request_id: 'r1' }), runPost('b', { state: 'started', request_id: 'r2' })] })];
    f.requests = [request('r1', { status: 'ready', batch_id: 'run-1' }), request('r2', { status: 'ready', batch_id: 'run-1' })];
    band();
    expect(await screen.findByText('2 posts designed. 145 Higgsfield credits used.')).toBeInTheDocument();
  });
});

describe('each post and the dock', () => {
  const post = (key: string) => ({ _calendarPostKey: key, platform: 'Instagram', format: 'Static', copy: 'Hello' });
  const card = (key: string) => mount(
    <DesignRequestsProvider clientId="c1" onOpenPost={() => {}}>
      <PostCard post={post(key) as any} iteration={null} status={'draft' as any} onOpen={() => {}} />
    </DesignRequestsProvider>,
  );

  it('says a post is queued for design, or waits for its copy', async () => {
    f.runs = [run({ posts: [runPost('k1'), runPost('k2', { waits_for: 'copy' })] })];
    card('k1');
    expect(await screen.findByText('Queued for design')).toBeInTheDocument();
    cleanup();
    card('k2');
    expect(await screen.findByText('Designed once its copy is written')).toBeInTheDocument();
  });

  it("shows the week as one card in the dock, not one per post", async () => {
    f.runs = [run({ posts: [runPost('a', { state: 'started', request_id: 'r1' }), runPost('b', { state: 'started', request_id: 'r2' }), runPost('c')] })];
    f.requests = [
      request('r1', { batch_id: 'run-1', calendar_post_key: 'a', status: 'ready', stage: 'ready' }),
      request('r2', { batch_id: 'run-1', calendar_post_key: 'b' }),
    ];
    mount(<DesignRequestsProvider clientId="c1" onOpenPost={() => {}}><DesignRequestsDockItems /></DesignRequestsProvider>);
    expect(await screen.findByText("Designing this week's posts")).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('1 of 3 ready')).toBeInTheDocument();
    expect(screen.queryByText(/Preparing your/)).toBeNull();
  });
});
