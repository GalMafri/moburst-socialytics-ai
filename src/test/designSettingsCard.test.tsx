/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DesignSettingsCard } from '@/components/onboarding/DesignSettingsCard';

// Design settings are derived automatically (Lital's decision 2, 19 Oct 2026)
// and in place from then on. Automatic designs are off for good (Lital, 20 Oct
// 2026), so the card offers no switch for them.

const f = vi.hoisted(() => ({ settings: null as any, writes: [] as any[], uploads: [] as any[], rpcs: [] as any[], onRpc: null as null | ((name: string, args: any) => void) }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  storage: { from: (bucket: string) => ({
    createSignedUrls: async () => ({ data: [{ path: 'c/a.jpg', signedUrl: 'https://signed/a' }] }),
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }),
    upload: async (path: string, file: File, options: any) => { f.uploads.push({ bucket, path, type: file.type, options }); return { error: null }; },
  }) },
  rpc: async (name: string, args: any) => { f.rpcs.push({ name, args }); f.onRpc?.(name, args); return { data: null, error: null }; },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q,
      upsert: (row: any) => { f.writes.push(row); return Promise.resolve({ error: null }); },
      update: (row: any) => { f.writes.push(row); return q; },
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? f.settings : { design_references: [], harvested_design_references: [{ path: 'c/a.jpg' }] }, error: null }),
      then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.writes = []; f.uploads = []; f.rpcs = []; f.onRpc = null; });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><DesignSettingsCard clientId="c" /></QueryClientProvider>);
}

it('shows derived settings as in place, editable, with no automatic designs switch and no confirmation step', async () => {
  f.settings = { client_id: 'c', source: 'lifecycle', logo_path: 'c/brand/logo.png', background: '#0B0E1A', placement: { anchor: 'center', width: 0.25, top: 0.04 }, reference_paths: ['c/a.jpg'], confirmed_at: '2026-10-19T12:00:00Z',
    derived: { at: '2026-10-19T12:00:00Z', placement_from: 'client_posts', background_from: 'brand_color' } };
  mount();
  expect(await screen.findByText("Worked out automatically on Oct 19, 2026: the logo from the client's website, its place from where the client's own posts put it, the background from a brand color. You can change any of them here.")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  expect(screen.queryByText(/Confirm them once|not confirmed|Add some in the Brief tab/)).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByText(/automatically/i, { selector: 'label' })).toBeNull();
  // Nothing to save until a person changes something.
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Background behind the logo'), { target: { value: '#FFFFFF' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(f.writes).toHaveLength(1));
  expect(f.writes.at(-1)).toMatchObject({ background: '#FFFFFF', confirmed_by: 'person-1' });
  // The library is not the card's: a save keeps the logo, placement and background only, so the posts keep refreshing.
  expect(f.writes.at(-1)).not.toHaveProperty('reference_paths');
});

it('keeps the logo, placement and background only: the posts designs follow refresh on their own', async () => {
  f.settings = { client_id: 'c', source: 'person', logo_path: 'c/logo.png', background: '#000000', placement: { anchor: 'left', width: 0.2, top: 0.05, left: 0.05 }, reference_paths: ['c/a.jpg'], updated_at: '2026-10-12T09:00:00Z' };
  mount();
  await screen.findByText(/Set by your team/);
  expect(screen.queryByText(/posts designs are built from/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Use all' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Leave this post out|Use this post/ })).toBeNull();
  expect(screen.getByText("The client's posts they follow refresh on their own, under Brand references from social posts.")).toBeInTheDocument();
});


it('says a person set them, and what automatic updates do with them', async () => {
  f.settings = { client_id: 'c', source: 'person', logo_path: 'c/logo.png', background: '#000000', placement: { anchor: 'left', width: 0.2, top: 0.05, left: 0.05 }, reference_paths: ['c/a.jpg'], updated_at: '2026-10-12T09:00:00Z' };
  mount();
  expect(await screen.findByText('Set by your team on Oct 12, 2026. Automatic updates leave these as they are.')).toBeInTheDocument();
  expect(screen.queryByText(/The product keeps/)).toBeNull();
});

// The client's logo set (16 Nov 2026): the logo for light and for dark
// pictures and the logo in white, each shown only when a file serves it. A
// file of the team's own is optional, and choosing or removing one never
// takes the settings over.

const LOGO = 'c/design-settings/logo-site-aaaa.png';
const OTHER = 'c/design-settings/logo-0123456789abcdef-other.png';
const WHITE = 'c/design-settings/logo-0123456789abcdef-white.png';
const lifecycleRow = (logo_set: unknown) => ({
  client_id: 'c', source: 'lifecycle', logo_path: LOGO, background: '#FFFFFF', placement: { anchor: 'center', width: 0.14, top: 0.928 }, reference_paths: ['c/a.jpg'], confirmed_at: '2026-10-19T12:00:00Z',
  derived: { at: '2026-10-19T12:00:00Z', placement_from: 'client_posts', background_from: 'neutral' }, logo_set,
});
const logoSet = (over: Record<string, unknown> = {}) => ({
  of: LOGO, rule: 1, own: 'light', both: false, other: { path: OTHER, from: 'made', size: [300, 87] }, white: { path: WHITE }, made: { other: OTHER, white: WHITE }, site: null,
  posts: { read: 16, found: 5, shown: { stored: 0, other: 4, white: 1 } }, canvas: { file: 'other', ground: '#0F294C', from: 'client_posts' }, at: '2026-11-16T09:00:00.000Z', ...over,
});
/** The tile with this label: its picture's address, its ground, and every word in it. */
const tileOf = (label: string) => {
  const el = screen.getByText(label).closest('[data-logo-tile]') as HTMLElement;
  const img = el.querySelector('img');
  return { el, src: img?.getAttribute('src') ?? null, ground: (el.querySelector('[data-logo-ground]') as HTMLElement).style.background, text: el.textContent };
};

it('shows the logo for light and for dark pictures with where each came from', async () => {
  f.settings = lifecycleRow(logoSet());
  mount();
  await screen.findByText('Logo on light pictures');
  expect(tileOf('Logo on light pictures')).toMatchObject({ src: `https://x/${LOGO}`, ground: 'rgb(255, 255, 255)' });
  expect(tileOf('Logo on light pictures').text).toContain("The client's logo file");
  expect(tileOf('Logo on dark pictures')).toMatchObject({ src: `https://x/${OTHER}`, ground: 'rgb(11, 14, 26)' });
  expect(tileOf('Logo on dark pictures').text).toContain('A light version of it');
  expect(tileOf('Logo in white')).toMatchObject({ src: `https://x/${WHITE}`, ground: 'rgb(11, 14, 26)' });
  expect(tileOf('Logo in white').text).toContain('A white version of it');
  expect(screen.getByText('Each design carries the one its picture calls for.')).toBeInTheDocument();
  expect(screen.getByText("The client's logo file, best as a PNG with a transparent background.")).toBeInTheDocument();
  // One quiet control beside the tiles, for the pictures the client's file was not made for. No tile has a control, and nothing asks for anything.
  expect(screen.getByText('Choose a file for dark pictures')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-logo-tile] button, [data-logo-tile] label')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: "Remove your team's file" })).toBeNull();
  // Nothing on the card says how a design is started.
  expect(screen.queryByText('Designs start from')).toBeNull();
  // The card's own background field and previews still show the client's logo file on its background.
  expect((screen.getByLabelText('Background behind the logo') as HTMLInputElement).value).toBe('#FFFFFF');
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
});

it('shows the same tiles on a row a person set', async () => {
  f.settings = { ...lifecycleRow(logoSet({ canvas: { file: 'stored', ground: '#FFFFFF', from: 'settings' } })), source: 'person', updated_at: '2026-10-12T09:00:00Z' };
  mount();
  await screen.findByText('Logo on dark pictures');
  expect(tileOf('Logo on dark pictures')).toMatchObject({ src: `https://x/${OTHER}` });
  expect(tileOf('Logo on light pictures')).toMatchObject({ src: `https://x/${LOGO}` });
  expect(screen.getByText('Choose a file for dark pictures')).toBeInTheDocument();
});

it("replaces the second file without making the row the team's, and brings back what the set holds", async () => {
  // The browser's image work is not in the test's page: the chosen file is stored as it is.
  vi.stubGlobal('Image', class { onload: null | (() => void) = null; naturalWidth = 300; naturalHeight = 90; set src(_: string) { queueMicrotask(() => this.onload?.()); } });
  URL.createObjectURL = () => 'blob:logo';
  URL.revokeObjectURL = () => {};
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  f.settings = lifecycleRow(logoSet());
  // The database names the file on the row; the next read shows it.
  f.onRpc = (_name, args) => {
    const { person: _gone, ...rest } = f.settings.logo_set;
    f.settings = { ...f.settings, logo_set: args.p_path ? { ...rest, person: { path: args.p_path, of: LOGO, at: '2026-11-16T10:00:00Z' } } : rest };
  };
  mount();
  await screen.findByText('Logo on dark pictures');
  const file = new File([new Uint8Array([1, 2, 3])], 'white logo.png', { type: 'image/png', lastModified: 1700000000000 });
  fireEvent.change(screen.getByLabelText('A second logo file'), { target: { files: [file] } });
  const path = 'c/design-settings/logo-other-1700000000000-3.png';
  await waitFor(() => expect(f.rpcs).toHaveLength(1));
  expect(f.uploads).toEqual([{ bucket: 'generated-media', path, type: 'image/png', options: { contentType: 'image/png', upsert: true } }]);
  expect(f.rpcs[0]).toEqual({ name: 'set_design_logo_other', args: { p_client: 'c', p_path: path } });
  // Nothing is written to the settings themselves: the row stays the lifecycle's, and there is nothing to save.
  expect(f.writes).toEqual([]);
  await waitFor(() => expect(tileOf('Logo on dark pictures').src).toBe(`https://x/${path}`));
  expect(tileOf('Logo on dark pictures').text).toContain('Set by your team');
  expect(screen.getByText(/^Worked out automatically on Oct 19, 2026/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

  // Remove: one call with no path, and the tile shows what the set holds again.
  fireEvent.click(screen.getByRole('button', { name: "Remove your team's file" }));
  await waitFor(() => expect(f.rpcs).toHaveLength(2));
  expect(f.rpcs[1]).toEqual({ name: 'set_design_logo_other', args: { p_client: 'c', p_path: null } });
  await waitFor(() => expect(tileOf('Logo on dark pictures').src).toBe(`https://x/${OTHER}`));
  expect(tileOf('Logo on dark pictures').text).toContain('A light version of it');
  expect(screen.queryByRole('button', { name: "Remove your team's file" })).toBeNull();
  expect(f.writes).toEqual([]);
  expect(f.uploads).toHaveLength(1);
  vi.unstubAllGlobals();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

it('shows no tile for pictures no file serves, and one quiet control beside the tiles', async () => {
  f.settings = lifecycleRow(logoSet({ other: null, white: null, canvas: { file: 'stored', ground: '#FFFFFF', from: 'settings' } }));
  mount();
  await screen.findByText('Logo on light pictures');
  // The client's file serves light pictures only: one tile, with its file in it. Nothing stands in for dark pictures.
  expect(document.querySelectorAll('[data-logo-tile]')).toHaveLength(1);
  expect(tileOf('Logo on light pictures').src).toBe(`https://x/${LOGO}`);
  expect(screen.queryByText('Logo on dark pictures')).toBeNull();
  expect(screen.queryByText('Logo in white')).toBeNull();
  for (const ground of Array.from(document.querySelectorAll('[data-logo-ground]'))) expect(ground.querySelector('img')).not.toBeNull();
  expect(screen.getByText('Choose a file for dark pictures')).toBeInTheDocument();
});

it('looks as before when the set does not exist yet', async () => {
  f.settings = lifecycleRow(null);
  mount();
  expect(await screen.findByText("The client's logo file, best as a PNG with a transparent background.")).toBeInTheDocument();
  expect(screen.queryByText('Logo on light pictures')).toBeNull();
  expect(screen.queryByText('Logo on dark pictures')).toBeNull();
  expect(screen.queryByText('Designs start from')).toBeNull();
  expect(screen.queryByText('Each design carries the one its picture calls for.')).toBeNull();
  expect(screen.queryByText(/^Choose a file for/)).toBeNull();
  expect(document.querySelector('[data-logo-tile]')).toBeNull();
});
