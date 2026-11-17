import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AutomaticBrandReferences } from '../components/onboarding/AutomaticBrandReferences';
import { checkedLine, chosenLine, copyLines, lookLine, OCCASION_WORDS, ownerLine, platformLines, type RefsStep } from '../lib/designReferences';

// The references refresh themselves (design: docs/superpowers/specs/
// 2026-11-02-design-refs-refresh-design.md): the card shows plain status and
// each post with Keep and Leave out, and has no button to refresh.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const f = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), signed: vi.fn(), toast: vi.fn(), client: null as Any, step: null as Any, choices: [] as Any[], reviews: [] as Any[] }));
vi.mock('sonner', () => ({ toast: { success: f.toast, error: f.toast } }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const rows = () => (table === 'design_reference_choices' ? f.choices : table === 'design_reference_reviews' ? f.reviews : []);
    const q: Any = {
      select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => ({ data: table === 'clients' ? f.client : f.step, error: null }),
      then: (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok, fail),
    };
    return q;
  };
  return { supabase: { functions: { invoke: f.invoke }, rpc: f.rpc, from: query, storage: { from: () => ({ createSignedUrls: f.signed }) } } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); f.choices = []; f.reviews = []; });

const library = [
  { path: 'c/upload.png', upload: true, kept: true },
  { path: 'c/ig-1.jpg', platform: 'Instagram', posted_at: '2026-10-27T15:00:00Z', source_url: 'https://x/1', quality_checked: true },
  { path: 'c/li-1.jpg', platform: 'LinkedIn', posted_at: '2026-10-21T15:00:00Z', source_url: 'https://x/2', quality_checked: true },
];
const synthesis = { synthesized_at: '2026-10-28T09:00:00Z', source_count: 11, reference_pipeline_version: 2, look_change: { since: '2026-10-20', what: 'A coral and navy palette with a serif headline.' } };
const platforms = {
  Instagram: { posts: 6, newest: '2026-10-27T15:00:00Z', own_rules: true },
  LinkedIn: { posts: 2, newest: '2026-10-21T15:00:00Z', own_rules: false },
  TikTok: { posts: 0, newest: null, own_rules: false },
};
const voice = { overall: { summary: 'Plain.' }, thin: { TikTok: 3 } };

function mount(ready = vi.fn(), over: { result?: Record<string, unknown>; client?: Record<string, unknown> } = {}) {
  f.client = { harvested_design_references: library, design_style_synthesis: synthesis, social_voice: voice, design_references: ['c/upload.png'], ...over.client };
  f.step = { status: 'done', done_at: '2026-11-02T08:00:00Z', attempted_at: '2026-11-02T08:00:00Z', result: { platforms, ...over.result } };
  f.signed.mockImplementation(async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })) }));
  return render(<AutomaticBrandReferences clientId="client-1" savedVersion={0} onReady={ready} />);
}

describe('what the card says', () => {
  it('says when the posts were checked, when the look was learned, and how each platform stands, for designs and for copy', async () => {
    const ready = vi.fn();
    mount(ready);
    expect(await screen.findByText('Checked for new posts Nov 2, 2026. Look learned Oct 28, 2026 from 11 posts.')).toBeInTheDocument();
    for (const line of [
      'Instagram: 6 posts, newest Oct 27.',
      'LinkedIn: 2 posts. LinkedIn designs follow the Instagram look until there are 4.',
      'TikTok: no designed posts yet. TikTok designs follow the Instagram look until there are 4.',
      "TikTok: 3 posts. TikTok copy follows the brand's overall voice until there are 5.",
      'New look in posts since Oct 20, 2026: A coral and navy palette with a serif headline.',
    ]) expect(screen.getByText(line)).toBeInTheDocument();
    expect(ready).toHaveBeenCalledWith(synthesis, 3);
  });

  it('has no button to refresh, starts nothing when the page opens, and uses no developer words or British spellings', async () => {
    const view = mount();
    await screen.findByText(/Checked for new posts/);
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
    expect(f.invoke).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    const text = view.container.textContent ?? '';
    expect(text).not.toMatch(/lifecycle|synthes|pipeline|sprout|step|error|try again|failed|\bnull\b|undefined|colour|organis|recognis|favour|centre/i);
  });

  it('shows each post with its platform and date', async () => {
    mount();
    const ig = await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
    expect(within(ig).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(ig).getByRole('button', { name: 'Leave out' })).toBeInTheDocument();
    const upload = screen.getByRole('group', { name: 'Uploaded by the team' });
    expect(within(upload).queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it('words each status line plainly', () => {
    expect(checkedLine({ status: 'waiting', done_at: null, attempted_at: '2026-11-02T08:00:00Z', result: { waiting_for: 'designed_posts' } }, null, 0))
      .toBe('Checked for new posts Nov 2, 2026. The client has fewer than 3 designed posts so far. Its posts are checked again every week.');
    expect(checkedLine({ status: 'waiting', done_at: null, attempted_at: null, result: { waiting_for: 'in_progress' } }, null, 0)).toBe("Checking the client's posts for new designs.");
    expect(platformLines({ LinkedIn: { posts: 1, newest: null, own_rules: false } })).toEqual(["LinkedIn: 1 post. LinkedIn designs follow the brand's overall look until there are 4."]);
    expect(copyLines({ thin: { X: 2 } })).toEqual([]);
    expect(lookLine({ look_change: null })).toBe('');
  });
});

describe('a person keeping or leaving out a post', () => {
  it('saves at once and quietly', async () => {
    f.rpc.mockResolvedValue({ data: { path: 'c/ig-1.jpg', choice: 'kept' }, error: null });
    mount();
    const ig = await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
    fireEvent.click(within(ig).getByRole('button', { name: 'Keep' }));
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/ig-1.jpg', p_choice: 'kept' }));
    expect(within(ig).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('moves a post left out into a closed list, where Use again takes the choice back', async () => {
    f.rpc.mockResolvedValue({ data: {}, error: null });
    mount();
    const li = await screen.findByRole('group', { name: 'LinkedIn post, Oct 21' });
    fireEvent.click(within(li).getByRole('button', { name: 'Leave out' }));
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/li-1.jpg', p_choice: 'left_out' }));
    const list = screen.getByText('Left out (1)').closest('details')!;
    expect(list).not.toHaveAttribute('open');
    fireEvent.click(within(list).getByRole('button', { name: 'Use again' }));
    await waitFor(() => expect(f.rpc).toHaveBeenLastCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/li-1.jpg', p_choice: 'none' }));
    expect(screen.queryByText(/Left out \(/)).toBeNull();
  });

  it('lists posts left out before, with their platform and date', async () => {
    f.choices = [{ path: 'c/old.jpg', choice: 'left_out' }];
    f.reviews = [{ path: 'c/old.jpg', network: 'INSTAGRAM', posted_at: '2026-09-01T15:00:00Z', source_url: 'https://x/9' }];
    mount();
    expect(await screen.findByText('Left out (1)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Instagram post, Sep 1' })).toBeInTheDocument();
  });

  it('shows the true state when a choice is not saved, with no error message', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only Moburst staff can change this.' } });
    mount();
    const ig = await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
    fireEvent.click(within(ig).getByRole('button', { name: 'Keep' }));
    expect(await screen.findByText('That choice is not saved yet.')).toBeInTheDocument();
    expect(within(ig).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/Only Moburst staff/)).toBeNull();
    expect(f.toast).not.toHaveBeenCalled();
  });
});

// The library's rules (docs/superpowers/plans/2026-11-17-reference-library.md):
// a library the team chose is theirs alone and new everyday posts are offered
// with Add; an automatic one leaves out posts made for an occasion and lists
// them with Use anyway.
describe('whose library it is', () => {
  const done = (result: Record<string, unknown>): RefsStep => ({ status: 'done', done_at: '2026-11-17T08:00:00Z', attempted_at: '2026-11-17T08:00:00Z', result });
  const DEVELOPER_WORDS = /lifecycle|synthes|pipeline|sprout|step|error|try again|failed|\bnull\b|undefined|colour|organis|recognis|favour|centre/i;

  it('says who picks the references, in one plain sentence', () => {
    const lines = [
      ownerLine(done({ owner: 'person', references: 5 })),
      ownerLine(done({ owner: 'app', references: 4, no_everyday: true, occasion_only: true })),
      ownerLine(done({ owner: 'app', references: 4, no_everyday: true, occasion_only: false })),
      ownerLine(done({ owner: 'app', references: 1, thin: true })),
      ownerLine(done({ owner: 'app', references: 2, thin: true })),
      ownerLine(done({ owner: 'app', references: 9 })),
    ];
    expect(lines).toEqual([
      'Designs use the 5 references your team chose. New posts are not added on their own.',
      'No everyday designed post was found in the last year, so designs still build on the references below, which were made for occasions. Upload 3 or more references to replace them.',
      'No everyday designed post was found in the last year, so the references below stay as they are. Upload 3 or more references to replace them.',
      'Only 1 everyday designed post was found in the last year, so designs build on that one.',
      'Only 2 everyday designed posts were found in the last year, so designs build on those.',
      "Designs use this client's everyday posts, picked from its accounts every week.",
    ]);
    for (const line of lines) expect(line).not.toMatch(DEVELOPER_WORDS);
    // A result from before the rule, and no result at all, say nothing.
    expect(ownerLine(done({ platforms }))).toBe('');
    expect(ownerLine(null)).toBe('');
    expect(ownerLine({ status: 'waiting', done_at: null, result: { waiting_for: 'in_progress', reviewed: 24, left: 6 } })).toBe('');
  });

  it('is true of the library in every state: what the team chose and what was found are counted apart', () => {
    // A thin library (fewer than 3 different references), by what it holds.
    const thin = (chosen: number, everyday: number, references: number) => ownerLine(done({ owner: 'app', thin: true, chosen, thin_everyday: everyday, references }));
    expect(thin(0, 1, 1)).toBe('Only 1 everyday designed post was found in the last year, so designs build on that one.');
    expect(thin(0, 2, 2)).toBe('Only 2 everyday designed posts were found in the last year, so designs build on those.');
    // One everyday post published on three platforms is one post, whatever the number of references.
    expect(thin(0, 1, 3)).toBe('Only 1 everyday designed post was found in the last year, so designs build on that one.');
    // Only what the team chose (uploads, or kept posts, which may have been made for an occasion): nothing is said to be an everyday post.
    expect(thin(1, 0, 1)).toBe('Designs build on the 1 reference your team chose. No everyday designed post was found in the last year to add to it.');
    expect(thin(2, 0, 2)).toBe('Designs build on the 2 references your team chose. No everyday designed post was found in the last year to add to them.');
    // What the team chose and what was found beside it.
    expect(thin(1, 1, 2)).toBe('Designs build on the 1 reference your team chose and the 1 everyday designed post found in the last year.');
    expect(thin(1, 2, 3)).toBe('Designs build on the 1 reference your team chose and the 2 everyday designed posts found in the last year.');
    expect(thin(2, 1, 3)).toBe('Designs build on the 2 references your team chose and the 1 everyday designed post found in the last year.');
    // A state the rules cannot produce says nothing rather than something that may be untrue.
    expect(thin(0, 0, 0)).toBe('');
    expect(thin(0, 3, 3)).toBe('');

    // An automatic library with the team's picks pinned in it.
    expect(ownerLine(done({ owner: 'app', references: 7, chosen: 0 }))).toBe("Designs use this client's everyday posts, picked from its accounts every week.");
    expect(ownerLine(done({ owner: 'app', references: 7, chosen: 1 }))).toBe("Designs use the 1 reference your team chose and this client's everyday posts, picked from its accounts every week.");
    expect(ownerLine(done({ owner: 'app', references: 8, chosen: 2 }))).toBe("Designs use the 2 references your team chose and this client's everyday posts, picked from its accounts every week.");
    // The team's own library, also while its look waits to be learned.
    expect(ownerLine(done({ owner: 'person', references: 3, chosen: 3, look_waits: true }))).toBe('Designs use the 3 references your team chose. New posts are not added on their own.');
    // A client that waits for posts has no owner sentence; its status line says what it waits for.
    expect(ownerLine({ status: 'waiting', done_at: null, result: { waiting_for: 'designed_posts', window_days: 365, occasions: [], chosen: 0 } })).toBe('');
    for (const line of [thin(1, 0, 1), thin(2, 0, 2), thin(1, 1, 2), thin(1, 2, 3), ownerLine(done({ owner: 'app', references: 7, chosen: 1 }))]) expect(line).not.toMatch(DEVELOPER_WORDS);
  });

  it('says a waiting client waits for everyday posts, since posts made for an occasion do not count', () => {
    const waiting = (result: Record<string, unknown>): RefsStep => ({ status: 'waiting', done_at: null, attempted_at: '2026-11-17T08:00:00Z', result: { waiting_for: 'designed_posts', ...result } });
    expect(checkedLine(waiting({ window_days: 365 }), null, 0)).toBe('Checked for new posts Nov 17, 2026. The client has fewer than 3 everyday designed posts so far. Its posts are checked again every week.');
    expect(checkedLine(waiting({ window_days: 365 }), null, 2)).toBe('Checked for new posts Nov 17, 2026. There are fewer than 3 everyday designed posts, so these references stay until there are more.');
    // A result from before the rule keeps its words.
    expect(checkedLine(waiting({}), null, 2)).toBe('Checked for new posts Nov 17, 2026. There are fewer than 3 new designed posts, so these references stay until there are more.');
  });

  it('says how close the team is to its own library, only at 1 or 2 chosen', () => {
    expect(chosenLine('app', 1)).toBe('Your team has chosen 1 reference. With 3 or more, designs use only the references your team chose.');
    expect(chosenLine('app', 2)).toBe('Your team has chosen 2 references. With 3 or more, designs use only the references your team chose.');
    for (const [owner, n] of [['app', 0], ['app', 3], ['person', 2], [undefined, 1], [null, 2]] as Array<[unknown, number]>) expect(chosenLine(owner, n)).toBe('');
  });

  const uploads = ['c/upload-1.png', 'c/upload-2.png', 'c/upload-3.png'];
  const theirs = {
    client: { design_references: uploads, harvested_design_references: uploads.map((path) => ({ path, upload: true, kept: true })) },
    result: {
      owner: 'person', references: 3, occasions: [],
      suggestions: [
        { path: 'c/ig-9.jpg', platform: 'Instagram', posted_at: '2026-11-12T15:00:00Z', source_url: 'https://x/9' },
        { path: 'c/li-8.jpg', platform: 'LinkedIn', posted_at: '2026-11-10T15:00:00Z', source_url: 'https://x/8' },
      ],
    },
  };

  it("shows a library the team chose with its sentence, without the per-platform design lines, and offers recent everyday posts with Add", async () => {
    f.rpc.mockResolvedValue({ data: {}, error: null });
    const view = mount(vi.fn(), theirs);
    expect(await screen.findByText('Designs use the 3 references your team chose. New posts are not added on their own.')).toBeInTheDocument();
    expect(screen.queryByText('Designs')).toBeNull();
    expect(screen.queryByText('Instagram: 6 posts, newest Oct 27.')).toBeNull();
    // The copy lines stay.
    expect(screen.getByText("TikTok: 3 posts. TikTok copy follows the brand's overall voice until there are 5.")).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Uploaded by the team' })).toHaveLength(3);
    expect(screen.getByText('Recent everyday posts (not used in designs)')).toBeInTheDocument();
    const offered = screen.getByRole('group', { name: 'Instagram post, Nov 12' });
    expect(within(offered).queryByRole('button', { name: 'Keep' })).toBeNull();
    expect(within(offered).queryByRole('button', { name: 'Leave out' })).toBeNull();
    // Its picture is asked for with the library's.
    expect(f.signed.mock.calls.at(-1)![0]).toEqual([...uploads, 'c/ig-9.jpg', 'c/li-8.jpg']);
    expect(screen.queryByText(/Left out: made for an occasion/)).toBeNull();
    expect(view.container.textContent ?? '').not.toMatch(DEVELOPER_WORDS);

    fireEvent.click(within(offered).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/ig-9.jpg', p_choice: 'kept' }));
    // It joins the references at once, kept, and leaves the offered posts.
    const added = screen.getByRole('group', { name: 'Instagram post, Nov 12' });
    expect(within(added).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(added).queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1);
    expect(f.toast).not.toHaveBeenCalled();
  });

  const automatic = {
    result: {
      owner: 'app', references: 3, suggestions: [],
      occasions: [
        { path: 'c/ig-halloween.jpg', platform: 'Instagram', posted_at: '2026-10-31T15:00:00Z', source_url: 'https://x/h', occasion: 'holiday' },
        { path: 'c/ig-ribbon.jpg', platform: 'Instagram', posted_at: '2026-10-09T15:00:00Z', source_url: 'https://x/r', occasion: 'awareness' },
        { path: 'c/li-fair.jpg', platform: 'LinkedIn', posted_at: '2026-10-03T15:00:00Z', source_url: 'https://x/f', occasion: 'event' },
        { path: 'c/li-quote.jpg', platform: 'LinkedIn', posted_at: '2026-09-28T15:00:00Z', source_url: 'https://x/q', occasion: 'person' },
        { path: 'c/ig-bingo.jpg', platform: 'Instagram', posted_at: '2026-09-20T15:00:00Z', source_url: 'https://x/b', occasion: 'contest' },
      ],
    },
  };

  it('lists the posts left out for an occasion in a closed list, each with what it was made for, and Use anyway keeps one', async () => {
    f.rpc.mockResolvedValue({ data: {}, error: null });
    const view = mount(vi.fn(), automatic);
    expect(await screen.findByText("Designs use this client's everyday posts, picked from its accounts every week.")).toBeInTheDocument();
    // One upload chosen so far.
    expect(screen.getByText('Your team has chosen 1 reference. With 3 or more, designs use only the references your team chose.')).toBeInTheDocument();
    // An automatic library keeps its per-platform lines.
    expect(screen.getByText('Instagram: 6 posts, newest Oct 27.')).toBeInTheDocument();
    const list = screen.getByText('Left out: made for an occasion (5)').closest('details')!;
    expect(list).not.toHaveAttribute('open');
    for (const label of ['Holiday or season', 'Awareness day or month', 'Dated event', 'Named person', 'Contest or game']) expect(within(list).getByText(label)).toBeInTheDocument();
    expect(Object.values(OCCASION_WORDS)).toHaveLength(5);
    const halloween = within(list).getByRole('group', { name: 'Instagram post, Oct 31' });
    expect(within(halloween).getByText('Instagram · Oct 31')).toBeInTheDocument();
    expect(screen.queryByText('Recent everyday posts (not used in designs)')).toBeNull();
    expect(view.container.textContent ?? '').not.toMatch(DEVELOPER_WORDS);

    fireEvent.click(within(halloween).getByRole('button', { name: 'Use anyway' }));
    await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/ig-halloween.jpg', p_choice: 'kept' }));
    expect(screen.getByText('Left out: made for an occasion (4)')).toBeInTheDocument();
    const used = screen.getByRole('group', { name: 'Instagram post, Oct 31' });
    expect(within(used).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
    // Two chosen now: the upload and this post.
    expect(screen.getByText('Your team has chosen 2 references. With 3 or more, designs use only the references your team chose.')).toBeInTheDocument();

    // Leaving it out afterwards puts it in the list of posts left out, where it can be used again.
    fireEvent.click(within(used).getByRole('button', { name: 'Leave out' }));
    await waitFor(() => expect(f.rpc).toHaveBeenLastCalledWith('design_reference_choose', { p_client: 'client-1', p_path: 'c/ig-halloween.jpg', p_choice: 'left_out' }));
    expect(within(screen.getByText('Left out (1)').closest('details')!).getByRole('group', { name: 'Instagram post, Oct 31' })).toBeInTheDocument();
  });

  it('puts a post back in its list when the choice is not saved, with no message from the server', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function design_reference_choose' } });
    mount(vi.fn(), automatic);
    const list = (await screen.findByText('Left out: made for an occasion (5)')).closest('details')!;
    fireEvent.click(within(within(list).getByRole('group', { name: 'Instagram post, Oct 31' })).getByRole('button', { name: 'Use anyway' }));
    expect(await screen.findByText('That choice is not saved yet.')).toBeInTheDocument();
    expect(screen.getByText('Left out: made for an occasion (5)')).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('shows the card as it was for a result from before the rule', async () => {
    mount();
    await screen.findByText(/Checked for new posts/);
    expect(screen.getByText('Designs')).toBeInTheDocument();
    expect(screen.queryByText(/Designs use/)).toBeNull();
    expect(screen.queryByText(/Your team has chosen/)).toBeNull();
    expect(screen.queryByText('Recent everyday posts (not used in designs)')).toBeNull();
    expect(screen.queryByText(/Left out: made for an occasion/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use anyway' })).toBeNull();
  });

  it('says in the card what is picked, what is left out, and when the team owns the library', async () => {
    mount();
    expect(await screen.findByText("The references this client's designs build on, and the look learned from them. Everyday posts from the client's own accounts are picked every week; posts made for a holiday, an awareness day, an event, a named person or a contest are left out. When your team chooses 3 or more references, designs use only those.")).toBeInTheDocument();
  });
});
