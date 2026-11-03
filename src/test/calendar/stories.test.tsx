/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
import { NewPostDialog, formatChoices, platformChoices, platformOnFormat } from '@/components/calendar/NewPostDialog';
import { CalendarKanban } from '@/components/reports/calendar/CalendarKanban';
import { AllClientsWeek } from '@/components/calendar/AllClientsWeek';
import { dayCountLabel, weekBoard } from '@/lib/calendarPosts';
import { MemoryRouter } from 'react-router-dom';
import { STORY_POSTED_BY_HAND, storageDownloadUrl, storyFileName } from '@/lib/story';

// Stories for Facebook and Instagram (Lital, 2 Nov 2026): designed from a
// post or chosen in New post, posted by hand, never scheduled through Sprout.
// Stories you can find (Lital, 3 Nov 2026: "make it much clearer"): "Add a
// Story" in every post's header, a chip for a post's Story, a compact Story
// card under its post, and Story always one of New post's formats.

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
  it('always offers Story when the client has Instagram or Facebook, whatever platform is chosen', () => {
    const values = (ps: string[]) => formatChoices(ps).map((c) => c.value);
    expect(values(['LinkedIn', 'Instagram'])).toContain('Story');
    expect(values(['Facebook'])).toContain('Story');
    expect(values(['LinkedIn', 'TikTok', 'X'])).toEqual(['auto', 'Image', 'Carousel', 'Reel']);
  });

  it('narrows the platforms to Instagram and Facebook for a Story, and picks the only one', () => {
    const all = ['Instagram', 'LinkedIn', 'Facebook', 'X'];
    expect(platformChoices(all, 'Story')).toEqual(['Instagram', 'Facebook']);
    expect(platformChoices(all, 'Carousel')).toEqual(all);
    expect(platformOnFormat('LinkedIn', 'Story', all)).toBe('');
    expect(platformOnFormat('Facebook', 'Story', all)).toBe('Facebook');
    expect(platformOnFormat('', 'Story', ['Instagram', 'LinkedIn'])).toBe('Instagram');
    expect(platformOnFormat('LinkedIn', 'Story', ['Instagram', 'LinkedIn'])).toBe('Instagram');
    expect(platformOnFormat('LinkedIn', 'Carousel', all)).toBe('LinkedIn');
  });

  it('shows the formats as a row of choices, and choosing Story picks the only platform that takes one', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><NewPostDialog clientId="c1" platforms={['Instagram', 'LinkedIn']} defaultDate="2026-11-05" /></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: /New post/ }));
    const formats = await screen.findByRole('radiogroup', { name: 'Format' });
    expect(within(formats).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Best fit for the idea', 'Single image', 'Carousel', 'Reel or short video', 'Story']);
    fireEvent.click(within(formats).getByRole('radio', { name: 'Story' }));
    expect(within(formats).getByRole('radio', { name: 'Story' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Platform' })).toHaveTextContent('Instagram');
  });
});

describe("a Story's panel", () => {
  it('has Message and Design, and no Schedule or Video tab', async () => {
    panel(storyPost(), [design('post:s')]);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Message', 'Design']);
  });

  // Notes on regenerate (3 Nov 2026): a Story's Message tab gets the same Regenerate with a note.
  it('shows the message its frame is written from, with Edit and Regenerate', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><PostPanel open onOpenChange={() => {}} post={storyPost()} postIterations={[]} clientId="c1" clientTimezone="UTC" /></QueryClientProvider>);
    expect(await screen.findByText('The words on the Story are written from this message.')).toBeInTheDocument();
    expect(screen.getByText('Captains pay last.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument();
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

describe('Add a Story, in the post\'s header', () => {
  it('shows on Facebook and Instagram posts only, beside the format', async () => {
    panel(feedPost({ platform: 'Facebook' }), [design('post:f')]);
    const button = await screen.findByRole('button', { name: 'Add a Story' });
    expect(button.closest('h2')).toHaveTextContent('Single image');
    cleanup();
    panel(feedPost({ platform: 'LinkedIn' }), [design('post:f')]);
    await screen.findByText('Made in your brand\'s style, with your logo and the post\'s words.');
    expect(screen.queryByRole('button', { name: 'Add a Story' })).toBeNull();
  });

  it('is there on every tab, for the client\'s own users too', async () => {
    f.staff = false;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}><PostPanel open onOpenChange={() => {}} post={feedPost()} postIterations={[]} clientId="c1" clientTimezone="UTC" /></DesignRequestsProvider></QueryClientProvider>);
    expect(await screen.findByRole('tab', { name: 'Copy', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a Story' })).toBeInTheDocument();
  });

  it('is not offered on a report\'s own board, whose posts are not on the calendar', async () => {
    panel(feedPost({ _calendarPostId: undefined, _calendarPostKey: '["report-1",0,0]' }), [design('["report-1",0,0]')]);
    await screen.findByText('Made in your brand\'s style, with your logo and the post\'s words.');
    expect(screen.queryByRole('button', { name: 'Add a Story' })).toBeNull();
  });

  it('keeps the post\'s own design and Schedule tab, and the block under the design is gone', async () => {
    panel(feedPost(), [design('post:f')]);
    expect(await screen.findByRole('button', { name: 'Add a Story' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Copy', 'Design', 'Video', 'Schedule']);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByText(STORY_POSTED_BY_HAND)).toBeNull();
    expect(screen.queryByText(/A 9:16 Story frame designed from this post/)).toBeNull();
  });

  it('adds the Story through design-request, then opens it', async () => {
    f.storyAnswer = { data: { story: { post_key: 'post:s' }, request: { id: 'r1' } }, error: null };
    const open = panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a Story' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('post:s'));
    expect(f.invokes.find((i) => i.action === 'story')).toEqual({ name: 'design-request', action: 'story', client_id: 'c1', calendar_post_key: 'post:f' });
  });

  it('opens a Story added before the brand\'s designs are set up, with no design yet', async () => {
    f.storyAnswer = { data: { story: { post_key: 'post:s' }, request: null }, error: null };
    const open = panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a Story' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('post:s'));
  });

  it('leaves the button as it was when the press does not finish, saying the Story isn\'t added yet', async () => {
    f.storyAnswer = { data: { error: 'no' }, error: null };
    panel(feedPost(), [design('post:f')]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a Story' }));
    expect(await screen.findByText("The Story isn't added yet.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a Story' })).toBeEnabled();
  });

  it('shows a Story chip that opens the Story a post already has', async () => {
    f.storyOf = 'post:s';
    const open = panel(feedPost(), [design('post:f')]);
    const chip = await screen.findByRole('button', { name: 'Open the Story' });
    expect(chip).toHaveTextContent('Story');
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith('post:s');
    expect(screen.queryByRole('button', { name: 'Add a Story' })).toBeNull();
  });
});

describe('the board', () => {
  const row = (over: any) => ({ id: 'x', client_id: 'c1', report_id: null, post_date: '2026-11-05', posting_time: '09:00', platform: 'Instagram', format: 'Single image', pillar: null, copy: 'Captains pay last.', hashtags: [], cta: null, visual_direction: null, rationale: null, language: null, reasons: [], source: 'plan', plan_id: 'p', post_key: 'post:x', story_of: null, raw: null, created_at: '2026-11-03T00:00:00Z', ...over });
  const rows = [
    row({ id: 'f', post_key: 'post:f', copy: 'Captains pay last.' }),
    row({ id: 'l', post_key: 'post:l', platform: 'LinkedIn', posting_time: '10:00', copy: 'LinkedIn post.' }),
    row({ id: 's', post_key: 'post:s', format: 'Story', story_of: 'post:f', posting_time: '09:00', copy: 'Captains pay last. Story.', created_at: '2026-11-04T00:00:00Z' }),
    row({ id: 'n', post_key: 'post:n', format: 'Story', posting_time: '18:00', copy: 'A Story from New post.' }),
  ];

  it('counts a day\'s Stories apart', () => {
    expect(dayCountLabel([{ format: 'Image', platform: 'Instagram' }, { format: 'Story', platform: 'Instagram' }, { format: 'Reel', platform: 'Instagram' }, { format: 'Carousel', platform: 'Facebook' }])).toBe('3 posts and 1 Story');
    expect(dayCountLabel([{ format: 'Story', platform: 'Facebook' }, { format: 'Story', platform: 'Instagram' }])).toBe('2 Stories');
    expect(dayCountLabel([{ format: 'Image', platform: 'LinkedIn' }])).toBe('1 post');
    expect(dayCountLabel([])).toBe('No posts');
  });

  it('shows a Story as a compact card right after its post, with a rail, and the post with a Story chip', () => {
    const board = weekBoard(rows as any, '2026-11-02');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><CalendarKanban contentCalendar={board} postIterations={[]} scheduledPosts={[]} filters={{ day: 'all', platform: 'all', status: 'all', language: 'all' } as any} onCardClick={vi.fn()} onToggleApproved={vi.fn()} /></QueryClientProvider>);
    const thursday = screen.getByRole('region', { name: 'Thursday' });
    expect(within(thursday).getByText('2 posts and 2 Stories')).toBeInTheDocument();
    const cards = within(thursday).getAllByRole('button', { name: /^Open / }).map((b) => b.getAttribute('aria-label'));
    expect(cards).toEqual([
      'Open post: Captains pay last.',
      'Open Instagram Story: Captains pay last. Story.',
      'Open post: LinkedIn post.',
      'Open Instagram Story: A Story from New post.',
    ]);
    const story = within(thursday).getByRole('button', { name: 'Open Instagram Story: Captains pay last. Story.' }).closest('[data-story-card]')!;
    expect(story.querySelector('[data-story-rail]')).not.toBeNull();
    const loose = within(thursday).getByRole('button', { name: 'Open Instagram Story: A Story from New post.' }).closest('[data-story-card]')!;
    expect(loose.querySelector('[data-story-rail]')).toBeNull();
    const post = within(thursday).getByRole('button', { name: 'Open post: Captains pay last.' });
    expect(within(post).getByText('Story')).toBeInTheDocument();
    expect(within(within(thursday).getByRole('button', { name: 'Open post: LinkedIn post.' })).queryByText('Story')).toBeNull();
  });

  it('shows a Story on the all-clients week with a Story label and a 9:16 frame, right after its post', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const posts = [rows[2], rows[1], rows[0]].map((r) => ({ ...r, client_name: 'Pay The Pyper' }));
    render(<MemoryRouter><QueryClientProvider client={qc}><AllClientsWeek posts={posts as any} week="2026-11-02" /></QueryClientProvider></MemoryRouter>);
    const thursday = screen.getByRole('region', { name: /^Thursday/ });
    const cards = within(thursday).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(cards).toEqual(["Open Pay The Pyper's Instagram post", "Open Pay The Pyper's Instagram Story", "Open Pay The Pyper's LinkedIn post"]);
    expect(within(within(thursday).getByRole('button', { name: "Open Pay The Pyper's Instagram Story" })).getByText('Story')).toBeInTheDocument();
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
