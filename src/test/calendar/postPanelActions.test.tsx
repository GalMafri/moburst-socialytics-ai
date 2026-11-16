/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';

// Every control on a post's design says the true state when its press gets no
// answer (rule 7: nothing fails visibly). The press is sent again quietly
// first; the line then says what is not done yet, with no error text, and the
// control keeps its normal button.

const f = vi.hoisted(() => ({
  staff: true,
  invokes: [] as any[],
  answers: {} as Record<string, any>,
  requests: [] as any[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: f.toastSuccess, error: f.toastError, warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    const answer = f.answers[`${name}:${opts.body.action ?? ''}`];
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

const URL_A = 'https://project.supabase.co/storage/v1/object/public/generated-media/c1/a.png';
const URL_B = 'https://project.supabase.co/storage/v1/object/public/generated-media/c1/b.png';
const post = (over: any = {}) => ({ _calendarPostKey: 'post:p1', _calendarPostId: 'p1', platform: 'Instagram', format: 'Single image', copy: 'Join us Friday!', date_label: '2026-11-05', ...over });
const design = (over: any = {}) => ({ id: 'it-1', calendar_post_key: 'post:p1', platform: 'Instagram', post_copy: 'Join us Friday!', variant_angle: 'Design option 1', media_urls: [URL_A], is_selected: true, created_at: '2026-11-03T10:00:00Z', variant_group_id: 'req-0', ...over });
const request = (over: any = {}) => ({ id: 'req-1', client_id: 'c1', calendar_post_key: 'post:p1', status: 'preparing', stage: 'designing', kind: 'single', options_wanted: 1, options_ready: 0, created_at: '2026-11-03T11:00:00Z', updated_at: '2026-11-03T11:00:00Z', note: null, note_learned: null, ...over });
const refused = { data: { error: 'no' }, error: null };

function panel(iterations: any[], props: any = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <PostPanel open onOpenChange={() => {}} post={props.post ?? post()} postIterations={iterations} clientId="c1" clientContext={{ client_name: 'Pay The Pyper' } as any} clientTimezone="UTC" initialTab="design" {...props} />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
}

describe('a press on a design control that gets no answer', () => {
  it('Create design says it is not started yet, and keeps its button', async () => {
    f.answers['design-request:create'] = refused;
    panel([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create design' }));
    expect(await screen.findByText('Not started yet.')).toBeInTheDocument();
    expect(screen.getByText('Not started yet.').closest('[role=status]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create design' })).toBeEnabled();
    expect(f.toastError).not.toHaveBeenCalled();
  });

  it('Use this design says it is not in use yet', async () => {
    f.answers['design-request:use'] = refused;
    panel([design({ is_selected: false })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Use this design' }));
    expect(await screen.findByText('Not in use yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this design' })).toBeEnabled();
  });

  it('Not right says it is not saved yet', async () => {
    f.answers['design-request:feedback'] = refused;
    panel([design()]);
    fireEvent.click(await screen.findByRole('button', { name: /Not right/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByText('Not saved yet.')).toBeInTheDocument();
  });

  it('Delete says it is not deleted yet', async () => {
    f.answers['design-request:feedback'] = refused;
    panel([design()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Not deleted yet.')).toBeInTheDocument();
  });

  it('a press that gets through clears the line', async () => {
    f.answers['design-request:create'] = refused;
    panel([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create design' }));
    expect(await screen.findByText('Not started yet.')).toBeInTheDocument();
    f.answers['design-request:create'] = { data: { request: request() }, error: null };
    fireEvent.click(screen.getByRole('button', { name: 'Create design' }));
    await waitFor(() => expect(screen.queryByText('Not started yet.')).toBeNull());
  });
});

describe('Cancel on a design being prepared', () => {
  const preparing = () => { f.requests = [request()]; };
  const cancel = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Stop preparing this design' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop it' }));
  };

  it('is sent again quietly when it never reached the server', async () => {
    preparing();
    let calls = 0;
    f.answers['design-request:cancel'] = () => (++calls === 1 ? { data: null, error: { message: 'Failed to send a request to the Edge Function' } } : { data: { ok: true }, error: null });
    panel([design()]);
    await cancel();
    await waitFor(() => expect(f.invokes.filter((i) => i.action === 'cancel')).toHaveLength(2), { timeout: 4000 });
    expect(screen.queryByText('Not stopped yet.')).toBeNull();
  });

  it('says it is not stopped yet when the last try still gets no answer, and keeps Cancel', async () => {
    preparing();
    f.answers['design-request:cancel'] = refused;
    panel([design()]);
    await cancel();
    expect(await screen.findByText('Not stopped yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop preparing this design' })).toBeInTheDocument();
    expect(f.toastError).not.toHaveBeenCalled();
  });
});

const toastSuccess = f.toastSuccess;
describe('an older media tile', () => {
  const older = () => design({ id: 'it-old', variant_angle: 'Reference creative 0', media_urls: [URL_B], is_selected: false, variant_group_id: 'old', created_at: '2026-11-04T10:00:00Z' });

  it('uses the same words and reasons as the design: Not right, Delete, Use for this post', async () => {
    const onFeedback = vi.fn(async () => {});
    panel([design(), older()], { onFeedback });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    expect(tile.querySelector('[aria-label="Not right: tell us why"]')).not.toBeNull();
    expect(tile.querySelector('[aria-label="Delete this design"]')).not.toBeNull();
    expect(tile.querySelector('[aria-label="Use for this post"]')).not.toBeNull();
    expect(tile.textContent).not.toMatch(/Reject and learn|Archive|favorite/i);
    expect(tile.innerHTML).not.toMatch(/Reject and learn|Archive|favorite/i);
  });

  it('turns a design down with the one reasons list, and Delete takes it off the post', async () => {
    const onFeedback = vi.fn(async () => {});
    panel([design(), older()], { onFeedback });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    fireEvent.click(tile.querySelector('[aria-label="Not right: tell us why"]')!);
    expect(await screen.findByLabelText('Text is wrong or hard to read')).toBeInTheDocument();
    expect(screen.queryByText(/garbled|Reject and learn/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Off-brand colors'));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith('it-old', 'rejected', 'off_brand_colours', ''));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Thanks. The next designs will take it into account.'));
    fireEvent.click(tile.querySelector('[aria-label="Delete this design"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith('it-old', 'archived'));
  });

  it('shows the design words, and no Archived or Rejected, after Delete or Not right got through', async () => {
    const onFeedback = vi.fn(async () => {});
    panel([design(), older()], { onFeedback });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    fireEvent.click(tile.querySelector('[aria-label="Not right: tell us why"]')!);
    fireEvent.click(await screen.findByLabelText('Off-brand colors'));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await waitFor(() => expect(onFeedback).toHaveBeenCalledWith('it-old', 'rejected', 'off_brand_colours', ''));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Thanks. The next designs will take it into account.'));
    fireEvent.click(tile.querySelector('[aria-label="Delete this design"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Deleted'));
    expect(document.body.textContent).not.toMatch(/Archived|Rejected|Not saved yet|Not deleted yet/);
    expect(f.toastError).not.toHaveBeenCalled();
  });

  it('says Not deleted yet when the tile send gets no answer', async () => {
    const onFeedback = vi.fn(async () => { throw new Error('no answer'); });
    panel([design(), older()], { onFeedback });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    fireEvent.click(tile.querySelector('[aria-label="Delete this design"]')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Not deleted yet.')).toBeInTheDocument();
    expect(f.toastError).not.toHaveBeenCalled();
  });

  it('says Not saved yet and keeps the dialog open when Not right gets no answer', async () => {
    const onFeedback = vi.fn(async () => { throw new Error('no answer'); });
    panel([design(), older()], { onFeedback });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    fireEvent.click(tile.querySelector('[aria-label="Not right: tell us why"]')!);
    fireEvent.click(await screen.findByLabelText('Off-brand colors'));
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await within(screen.getByRole('dialog')).findByText('Not saved yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeInTheDocument();
  });

  it('Use goes through the design Use for that iteration and never writes the row itself', async () => {
    panel([design(), older()], { onFeedback: vi.fn(async () => {}) });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    fireEvent.click(tile.querySelector('[aria-label="Use for this post"]')!);
    await waitFor(() => expect(f.invokes).toContainEqual({ name: 'design-request', action: 'use', iteration_id: 'it-old' }));
  });

  it('a tile in use says In use for this post and has no button to undo it', async () => {
    panel([design({ is_selected: false }), design({ id: 'it-old', variant_angle: 'Reference creative 0', media_urls: [URL_B], is_selected: true, variant_group_id: 'old', created_at: '2026-11-04T10:00:00Z' })], { onFeedback: vi.fn(async () => {}) });
    const tile = (await screen.findByText('Other media for this post')).parentElement as HTMLElement;
    expect(tile.textContent).toContain('In use for this post');
    expect(tile.querySelector('button[aria-pressed]')).toBeNull();
    expect(tile.querySelector('[aria-label="Use for this post"]')).toBeNull();
  });
});

describe('the design Not right when its feedback gets no answer', () => {
  it('keeps the dialog and says Not saved yet inside it', async () => {
    f.answers['design-request:feedback'] = refused;
    panel([design()]);
    fireEvent.click(await screen.findByRole('button', { name: /Not right/ }));
    fireEvent.click(await screen.findByLabelText('Off-brand colors'));
    fireEvent.click(await screen.findByRole('button', { name: 'Send feedback' }));
    expect(await within(screen.getByRole('dialog')).findByText('Not saved yet.')).toBeInTheDocument();
    expect(screen.getByLabelText('Off-brand colors')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
  });
});
