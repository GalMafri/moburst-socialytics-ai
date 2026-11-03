/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CopyEditor } from '@/components/reports/calendar/CopyEditor';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
import { copyLearnedLine, designLearnedLine } from '@/lib/postNotes';

// A note when regenerating (Lital, 3 Nov 2026: "the goal was to allow users to
// leave a note for regenerating a design/post copy"): the note is used for
// that regeneration, the app decides whether it lasts, and the post shows
// what was learned with Undo. Nothing ever reports a failure.

const f = vi.hoisted(() => ({
  staff: true,
  invokes: [] as any[],
  answers: {} as Record<string, any>,
  requests: [] as any[],
  toastError: vi.fn(),
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: f.toastError, warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    const key = `${name}:${opts.body.action ?? ''}`;
    const answer = f.answers[key];
    if (typeof answer === 'function') return answer(opts.body);
    return answer ?? { data: {}, error: null };
  } },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: table === 'design_requests' ? f.requests : [], error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.staff = true; f.invokes = []; f.answers = {}; f.requests = []; f.toastError.mockClear(); });

const post = (over: any = {}) => ({ _calendarPostKey: 'post:p1', _calendarPostId: 'p1', platform: 'Instagram', format: 'Single image', copy: 'Join us Friday!', date_label: '2026-11-05', ...over });
const ADDED = [{ op: 'add', id: 'pref-1', description: 'Never use exclamation marks.', platform: null }];

function editor(p: any = post()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><CopyEditor post={p} clientId="c1" brand="Pay The Pyper" /></QueryClientProvider>);
}
const rewrite = (copy = 'Join us Friday.') => ({ data: { post: { caption_angle: copy, CTA: 'Join', hashtags: '' } }, error: null });
async function regenerateWith(note: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
  fireEvent.change(screen.getByLabelText('What should change? (optional)'), { target: { value: note } });
  fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
}

describe('the lines', () => {
  it('say what a rewrite note taught, or that it was used for this post only', () => {
    expect(copyLearnedLine({ changes: ADDED as any }, 'Pay The Pyper')).toEqual({ text: 'Rewritten with your note. Learned for Pay The Pyper: "Never use exclamation marks".', undo: true });
    expect(copyLearnedLine({ changes: [] }, 'Pay The Pyper')).toEqual({ text: 'Rewritten with your note. Used for this post only.', undo: false });
    expect(copyLearnedLine({ changes: [{ op: 'confirm', id: 'p', description: 'Short.', platform: null }] }, 'Pay The Pyper')).toEqual({ text: 'Rewritten with your note. Matches what Pay The Pyper already prefers.', undo: false });
    expect(copyLearnedLine(null, 'Pay The Pyper')).toEqual({ text: 'Rewritten with your note.', undo: false });
    expect(copyLearnedLine({ changes: ADDED as any }, 'Pay The Pyper', { undone: true }).text).toBe("Rewritten with your note. Pay The Pyper's preferences are as they were.");
  });

  it('say what a design note taught, and nothing while it is still being learned', () => {
    expect(designLearnedLine({ rules: [{ id: 'd', type: 'avoid', text: 'Never show people.' }] }, 'Pay The Pyper')).toEqual({ text: 'Learned for Pay The Pyper: "Never show people".', undo: true });
    expect(designLearnedLine({ rules: [] }, 'Pay The Pyper')).toEqual({ text: 'Used for this design only.', undo: false });
    expect(designLearnedLine(null, 'Pay The Pyper')).toBeNull();
    expect(designLearnedLine({ rules: [{ id: 'd', type: 'avoid', text: 'x' }], undone_at: '2026-11-03' }, 'Pay The Pyper')?.undo).toBe(false);
  });
});

describe("the Copy tab's Regenerate", () => {
  it('opens a box in place; an empty box regenerates as before, with no line', async () => {
    f.answers['regenerate-post-copy:'] = rewrite();
    editor();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(screen.getByLabelText('What should change? (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(await screen.findByText('Join us Friday.')).toBeInTheDocument();
    expect(f.invokes.find((i) => i.name === 'regenerate-post-copy').note).toBeUndefined();
    expect(f.invokes.find((i) => i.action === 'save_copy')).toMatchObject({ source: 'regeneration' });
    expect(f.invokes.find((i) => i.action === 'save_copy').note).toBeUndefined();
    expect(screen.queryByText(/Rewritten with your note/)).toBeNull();
    expect(screen.queryByLabelText('What should change? (optional)')).toBeNull();
  });

  it('sends the note with the rewrite and its save, shows what it taught, and Undo takes it back', async () => {
    f.answers['regenerate-post-copy:'] = rewrite();
    f.answers['calendar-posts:save_copy'] = { data: { ok: true, learned: { changes: ADDED } }, error: null };
    f.answers['calendar-posts:undo_note'] = { data: { ok: true, undone: 1 }, error: null };
    editor();
    await regenerateWith('Never use exclamation marks');
    expect(await screen.findByText('Join us Friday.')).toBeInTheDocument();
    expect(f.invokes.find((i) => i.name === 'regenerate-post-copy')).toMatchObject({ note: 'Never use exclamation marks', format: 'Single image', current_copy: 'Join us Friday!' });
    expect(f.invokes.find((i) => i.action === 'save_copy')).toMatchObject({ source: 'regeneration', note: 'Never use exclamation marks', previous_copy: 'Join us Friday!', post_copy: 'Join us Friday.' });
    expect(screen.getByText(/Rewritten with your note\. Learned for Pay The Pyper: "Never use exclamation marks"\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("Rewritten with your note. Pay The Pyper's preferences are as they were.")).toBeInTheDocument();
    expect(f.invokes.find((i) => i.action === 'undo_note')).toEqual({ name: 'calendar-posts', action: 'undo_note', client_id: 'c1', changes: ADDED });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('says a note about this post alone was used for it only, with no Undo', async () => {
    f.answers['regenerate-post-copy:'] = rewrite();
    f.answers['calendar-posts:save_copy'] = { data: { ok: true, learned: { changes: [] } }, error: null };
    editor();
    await regenerateWith('Mention the Friday sale');
    expect(await screen.findByText('Rewritten with your note. Used for this post only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('keeps the note in its box when the rewrite does not start, and reports no failure', async () => {
    f.answers['regenerate-post-copy:'] = { data: { error: 'busy' }, error: null };
    editor();
    await regenerateWith('Shorter');
    expect(await screen.findByText('Not rewritten yet. Your note is kept here.')).toBeInTheDocument();
    expect(screen.getByLabelText('What should change? (optional)')).toHaveValue('Shorter');
    expect(screen.getByText('Join us Friday!')).toBeInTheDocument();
    expect(f.toastError).not.toHaveBeenCalled();
  });

  it("is offered to the client's own users too", () => {
    f.staff = false;
    editor();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
  });

  it("rewrites a Story's message too, telling the server it is a Story", async () => {
    f.answers['regenerate-post-copy:'] = rewrite('Friday. Be there.');
    editor(post({ format: 'Story' }));
    await regenerateWith('More playful');
    expect(await screen.findByText('Friday. Be there.')).toBeInTheDocument();
    expect(f.invokes.find((i) => i.name === 'regenerate-post-copy')).toMatchObject({ format: 'Story', note: 'More playful' });
  });
});

describe("the Design tab's Regenerate", () => {
  const DESIGN_URL = 'https://project.supabase.co/storage/v1/object/public/generated-media/c1/d.png';
  const design = (over: any = {}) => ({ id: 'it-1', calendar_post_key: 'post:p1', platform: 'Instagram', post_copy: 'Join us Friday!', variant_angle: 'Design option 1', media_urls: [DESIGN_URL], is_selected: true, created_at: '2026-11-03T10:00:00Z', variant_group_id: 'req-0', ...over });
  const request = (over: any = {}) => ({ id: 'req-1', client_id: 'c1', calendar_post_key: 'post:p1', status: 'preparing', stage: 'designing', kind: 'single', options_wanted: 1, options_ready: 0, created_at: '2026-11-03T11:00:00Z', updated_at: '2026-11-03T11:00:00Z', note: 'Never show people', note_learned: null, ...over });

  /** The Design tab (every tab is mounted), once the brand's design settings have loaded. */
  const designTab = async () => within((await screen.findByText(/Made in your brand's style/)).closest('[role=tabpanel]') as HTMLElement);

  function panel(iterations: any[] = [design()]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
          <PostPanel open onOpenChange={() => {}} post={post()} postIterations={iterations} clientId="c1" clientContext={{ client_name: 'Pay The Pyper' } as any} clientTimezone="UTC" initialTab="design" />
        </DesignRequestsProvider>
      </QueryClientProvider>,
    );
  }

  it('opens the box in place and starts the new design with the note', async () => {
    f.answers['design-request:create'] = { data: { request: request() }, error: null };
    panel();
    const tab = await designTab();
    fireEvent.click(tab.getByRole('button', { name: 'Regenerate' }));
    fireEvent.change(tab.getByLabelText('What should change? (optional)'), { target: { value: 'Never show people' } });
    fireEvent.click(tab.getAllByRole('button', { name: 'Regenerate' }).at(-1)!);
    await waitFor(() => expect(f.invokes.find((i) => i.action === 'create')).toMatchObject({ name: 'design-request', client_id: 'c1', calendar_post_key: 'post:p1', note: 'Never show people' }));
    await waitFor(() => expect(tab.queryByLabelText('What should change? (optional)')).toBeNull());
  });

  it("keeps the first design one press: Create design opens no box", async () => {
    f.answers['design-request:create'] = { data: { request: request({ note: null }) }, error: null };
    panel([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create design' }));
    await waitFor(() => expect(f.invokes.find((i) => i.action === 'create')).toBeTruthy());
    expect(f.invokes.find((i) => i.action === 'create').note).toBeUndefined();
    expect(screen.queryByLabelText('What should change? (optional)')).toBeNull();
  });

  it('keeps the note in its box when the design does not start', async () => {
    f.answers['design-request:create'] = { data: { error: 'no' }, error: null };
    panel();
    const tab = await designTab();
    fireEvent.click(tab.getByRole('button', { name: 'Regenerate' }));
    fireEvent.change(tab.getByLabelText('What should change? (optional)'), { target: { value: 'Darker' } });
    fireEvent.click(tab.getAllByRole('button', { name: 'Regenerate' }).at(-1)!);
    expect(await tab.findByText('Not started yet. Your note is kept here.')).toBeInTheDocument();
    expect(tab.getByLabelText('What should change? (optional)')).toHaveValue('Darker');
    expect(f.toastError).not.toHaveBeenCalled();
  });

  it('shows the note on the design being made, then what it taught with Undo', async () => {
    f.requests = [request({ note_learned: { rules: [{ id: 'dl-1', type: 'avoid', text: 'Never show people.' }] } })];
    f.answers['design-request:undo_note'] = { data: { ok: true, request: request({ note_learned: { rules: [{ id: 'dl-1', type: 'avoid', text: 'Never show people.' }], undone_at: '2026-11-03T12:00:00Z' } }) }, error: null };
    panel();
    expect(await screen.findByText('Your note: "Never show people"')).toBeInTheDocument();
    expect(screen.getByText(/Learned for Pay The Pyper: "Never show people"\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText("Pay The Pyper's design preferences are as they were.")).toBeInTheDocument();
    expect(f.invokes.find((i) => i.action === 'undo_note')).toEqual({ name: 'design-request', action: 'undo_note', request_id: 'req-1' });
  });

  it('says a note about this design alone was used for it only, and shows no learned line while it is learned', async () => {
    f.requests = [request({ note_learned: { rules: [] } })];
    panel();
    expect(await screen.findByText('Used for this design only.')).toBeInTheDocument();
    cleanup();
    f.requests = [request()];
    panel();
    expect(await screen.findByText('Your note: "Never show people"')).toBeInTheDocument();
    expect(screen.queryByText(/Learned for|Used for this design only/)).toBeNull();
  });

  it('keeps "Made with your note" on the finished design', async () => {
    f.requests = [request({ id: 'req-0', status: 'ready', stage: 'ready', note_learned: { rules: [] } })];
    panel([design({ variant_group_id: 'req-0' })]);
    expect(await screen.findByText('Made with your note: "Never show people"')).toBeInTheDocument();
  });
});
