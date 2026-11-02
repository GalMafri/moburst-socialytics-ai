import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AutomaticBrandReferences } from '../components/onboarding/AutomaticBrandReferences';
import { checkedLine, copyLines, lookLine, platformLines } from '../lib/designReferences';

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

function mount(ready = vi.fn()) {
  f.client = { harvested_design_references: library, design_style_synthesis: synthesis, social_voice: voice, design_references: ['c/upload.png'] };
  f.step = { status: 'done', done_at: '2026-11-02T08:00:00Z', attempted_at: '2026-11-02T08:00:00Z', result: { platforms } };
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
