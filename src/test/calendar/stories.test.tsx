/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
import { formatChoices, formatOnPlatform } from '@/components/calendar/NewPostDialog';
import { STORY_POSTED_BY_HAND, storageDownloadUrl, storyFileName } from '@/lib/story';

// Stories for Facebook and Instagram (Lital, 2 Nov 2026): designed from a
// post or chosen in New post, posted by hand, never scheduled through Sprout.

const f = vi.hoisted(() => ({
  staff: true,
  storyOf: null as string | null,
  storyAnswer: null as any,
  invokes: [] as any[],
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    if (name === 'design-request' && opts.body.action === 'story') return f.storyAnswer ?? { data: null, error: new Error('not reached') };
    return { data: {}, error: null };
  } },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : table === 'calendar_posts' && f.storyOf ? { post_key: f.storyOf } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.staff = true; f.storyOf = null; f.storyAnswer = null; f.invokes = []; });

const DESIGN_URL = 'https://project.supabase.co/storage/v1/object/public/generated-media/c1/canva-finish/j1/final-abc.png';
const feedPost = (over: any = {}) => ({ _calendarPostKey: 'post:f', _calendarPostId: 'f', platform: 'Instagram', format: 'Single image', copy: 'Captains pay last.', date_label: '2026-11-05', posting_time: '9:00 AM', ...over });
const storyPost = (over: any = {}) => ({ _calendarPostKey: 'post:s', _calendarPostId: 's', _storyOf: 'post:f', platform: 'Instagram', format: 'Story', copy: 'Captains pay last.', date_label: '2026-11-05', posting_time: '9:00 AM', ...over });
const design = (key: string) => ({ id: `it-${key}`, calendar_post_key: key, platform: 'Instagram', post_copy: 'Captains pay last.', variant_angle: 'Design option 1', media_urls: [DESIGN_URL], is_selected: true, created_at: '2026-11-03T10:00:00Z' });

function panel(post: any, iterations: any[] = [], onOpenPost = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <DesignRequestsProvider clientId="c1" onOpenPost={onOpenPost}>
        <PostPanel open onOpenChange={() => {}} post={post} postIterations={iterations} clientId="c1" clientContext={{ client_name: 'Pay The Pyper' } as any} clientTimezone="UTC" initialTab="design" />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
  return onOpenPost;
}

describe('New post', () => {
  it('offers Story only once Instagram or Facebook is chosen', () => {
    const values = (p: string | null) => formatChoices(p).map((c) => c.value);
    expect(values('Instagram')).toContain('Story');
    expect(values('Facebook')).toContain('Story');
    for (const p of ['LinkedIn', 'TikTok', 'X', '', null]) expect(values(p), String(p)).not.toContain('Story');
    expect(values('LinkedIn')).toEqual(['auto', 'Image', 'Carousel', 'Reel']);
  });

  it('puts the format back to Best fit when another platform does not offer it', () => {
    expect(formatOnPlatform('Story', 'LinkedIn')).toBe('auto');
    expect(formatOnPlatform('Story', 'Facebook')).toBe('Story');
    expect(formatOnPlatform('Carousel', 'LinkedIn')).toBe('Carousel');
  });
});

describe("a Story's panel", () => {
  it('has Message and Design, and no Schedule or Video tab', async () => {
    panel(storyPost(), [design('post:s')]);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Message', 'Design']);
  });

  it('shows the message its frame is written from, with no caption to regenerate', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><PostPanel open onOpenChange={() => {}} post={storyPost()} postIterations={[]} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);
    expect(await screen.findByText('The words on the Story are written from this message.')).toBeInTheDocument();
    expect(screen.getByText('Captains pay last.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
  });

  it('says the Story is posted by hand, and downloads its PNG under the Story\'s name', async () => {
    panel(storyPost(), [design('post:s')]);
    expect(await screen.findByText(STORY_POSTED_BY_HAND)).toBeInTheDocument();
    const download = screen.getByRole('link', { name: /Download/ });
    expect(download).toHaveAttribute('href', `${DESIGN_URL}?download=pay-the-pyper-story-2026-11-05.png`);
    expect(screen.queryByRole('button', { name: 'Design as a Story' })).toBeNull();
  });

  it('says so before its design is made too', async () => {
    panel(storyPost());
    expect(await screen.findByText(STORY_POSTED_BY_HAND)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create design' })).toBeInTheDocument();
  });

  it('links back to the post it was made from', async () => {
    const open = panel(storyPost(), [design('post:s')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the post' }));
    expect(open).toHaveBeenCalledWith('post:f');
  });
});

describe('Design as a Story', () => {
  it('shows on Facebook and Instagram posts only', async () => {
    panel(feedPost({ platform: 'Facebook' }), [design('post:f')]);
    expect(await screen.findByRole('button', { name: 'Design as a Story' })).toBeInTheDocument();
    cleanup();
    panel(feedPost({ platform: 'LinkedIn' }), [design('post:f')]);
    await screen.findByText('Made in your brand\'s style, with your logo and the post\'s words.');
    expect(screen.queryByRole('button', { name: 'Design as a Story' })).toBeNull();
  });

  it('is not offered on a report\'s own board, whose posts are not on the calendar', async () => {
    panel(feedPost({ _calendarPostId: undefined, _calendarPostKey: '["report-1",0,0]' }), [design('["report-1",0,0]')]);
    await screen.findByText('Made in your brand\'s style, with your logo and the post\'s words.');
    expect(screen.queryByRole('button', { name: 'Design as a Story' })).toBeNull();
  });

  it('keeps the post\'s own design and Schedule tab', async () => {
    panel(feedPost(), [design('post:f')]);
    expect(await screen.findByRole('button', { name: 'Design as a Story' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Copy', 'Design', 'Video', 'Schedule']);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByText(STORY_POSTED_BY_HAND)).toBeNull();
  });

  it('makes the Story through design-request, then opens it', async () => {
    f.storyAnswer = { data: { story: { post_key: 'post:s' }, request: { id: 'r1' } }, error: null };
    const open = panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Design as a Story' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('post:s'));
    expect(f.invokes.find((i) => i.action === 'story')).toEqual({ name: 'design-request', action: 'story', client_id: 'c1', calendar_post_key: 'post:f' });
  });

  it('leaves the button as it was when the press does not finish, saying the Story isn\'t made yet', async () => {
    f.storyAnswer = { data: { error: 'no' }, error: null };
    panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Design as a Story' }));
    expect(await screen.findByText("The Story isn't made yet.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Design as a Story' })).toBeEnabled();
  });

  it('opens the Story a post already has', async () => {
    f.storyOf = 'post:s';
    const open = panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the Story' }));
    expect(open).toHaveBeenCalledWith('post:s');
    expect(screen.queryByRole('button', { name: 'Design as a Story' })).toBeNull();
  });
});

describe('the Story file', () => {
  it('is named for the brand and the date, and saved through the storage download option', () => {
    expect(storyFileName('Pay The Pyper', '2026-11-05')).toBe('pay-the-pyper-story-2026-11-05.png');
    expect(storyFileName('Café Ñandú', 'Nov 5')).toBe('cafe-nandu-story.png');
    expect(storyFileName(null, null)).toBe('brand-story.png');
    expect(storageDownloadUrl(DESIGN_URL, 'a b.png')).toBe(`${DESIGN_URL}?download=a+b.png`);
    expect(storageDownloadUrl('https://cdn.example.com/x.png', 'a.png')).toBe('https://cdn.example.com/x.png');
    expect(storageDownloadUrl('not a url', 'a.png')).toBe('not a url');
  });
});
