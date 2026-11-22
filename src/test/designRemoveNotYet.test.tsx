/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P07-08): Remove on a learned design rule and on the team's
// second logo file showed nothing while it was resent quietly and nothing when
// it still did not get through. Each now says the thing is not removed yet.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LearnedDesignPreferences } from '@/components/onboarding/LearnedDesignPreferences';
import { DesignSettingsCard } from '@/components/onboarding/DesignSettingsCard';

const REFUSED = { code: '42501', message: 'refused' };
const f = vi.hoisted(() => ({ settle: null as null | ((v: any) => void), settings: null as any }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }) }) },
  rpc: () => new Promise((r) => { f.settle = r; }),
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q,
      limit: async () => ({ data: [{ id: 'l1', pattern_type: 'avoid', pattern_description: 'No stock photos.', source: 'regenerate_note', created_at: '2026-11-03T10:00:00Z' }], error: null }),
      delete: () => ({ eq: () => new Promise((r) => { f.settle = r; }) }),
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? f.settings : { design_references: [], harvested_design_references: [] }, error: null }),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.settle = null; });
const mount = (node: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{node}</QueryClientProvider>);

it('says a learned design preference is not removed yet when the remove does not get through', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mount(<LearnedDesignPreferences clientId="c" />);
  const remove = await screen.findByRole('button', { name: 'Remove this design preference' });
  fireEvent.click(remove);
  expect(remove).toBeDisabled();
  await act(async () => { f.settle!({ error: REFUSED }); });
  expect(await screen.findByText('Not removed yet.')).toBeInTheDocument();
  expect(remove).toBeEnabled();
});

it("says the team's second logo file is not removed yet when the remove does not get through", async () => {
  const LOGO = 'c/design-settings/logo-site-aaaa.png';
  const OTHER = 'c/design-settings/logo-other-1.png';
  f.settings = {
    client_id: 'c', source: 'lifecycle', logo_path: LOGO, background: '#FFFFFF', placement: { anchor: 'center', width: 0.14, top: 0.928 }, reference_paths: [], confirmed_at: '2026-10-19T12:00:00Z',
    derived: { at: '2026-10-19T12:00:00Z', placement_from: 'client_posts', background_from: 'neutral' },
    logo_set: { of: LOGO, rule: 2, own: 'light', both: false, inks: [[23, 87, 132]], other: { path: OTHER, from: 'made', size: [300, 87] }, white: null, made: { other: OTHER }, site: null, person: { path: OTHER, of: LOGO, at: '2026-11-16T10:00:00Z' }, at: '2026-11-16T09:00:00.000Z' },
  };
  mount(<DesignSettingsCard clientId="c" />);
  fireEvent.click(await screen.findByRole('button', { name: "Remove your team's file" }));
  await act(async () => { f.settle!({ data: null, error: REFUSED }); });
  expect(await screen.findByText("Your team's file is not removed yet.")).toBeInTheDocument();
});
