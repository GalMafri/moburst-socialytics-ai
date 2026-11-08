/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// Client setup for a client the Sprout onboarding added with no website:
// every line about what the product read from its social profiles is a fact
// with a date or a count (onboarding from social profiles, section 6).

const NOW = '2026-11-03T10:00:00.000Z';
const f = vi.hoisted(() => ({ client: null as any, steps: [] as any[], rpcs: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async (name: string, args: any) => { f.rpcs.push({ name, ...args }); return { data: null, error: null }; },
  functions: { invoke: async () => ({ data: { profiles: [] }, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const answer = (single: boolean) => {
      if (table === 'clients') return { data: f.client, error: null };
      if (table === 'client_lifecycle_steps') {
        if (Array.isArray(filters.step)) return { data: f.steps.filter((s) => (filters.step as string[]).includes(s.step)), error: null };
        return { data: single ? f.steps.find((s) => s.step === filters.step) ?? null : [], error: null };
      }
      return { data: single ? null : [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q,
      in: (k: string, v: unknown) => { filters[k] = v; return q; },
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      is: (k: string, v: unknown) => { filters[k] = v; return q; },
      maybeSingle: async () => answer(true),
      single: async () => answer(true),
      then: (resolve: any, reject: any) => Promise.resolve(answer(false)).then(resolve, reject),
    };
    return q;
  },
} }));

function mount(tab = 'info') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/clients/c1/setup?tab=${tab}`]}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  f.rpcs = [];
  f.client = {
    id: 'c1', name: 'Olo', website_url: null, timezone: 'America/Chicago', geo: 'US,GB', language: 'en,es', logo_url: 'https://x/logo-profile-linkedin.png',
    primary_platforms: ['Instagram', 'LinkedIn'], content_pillars: [{ name: 'Order ahead', description: 'd' }], social_keywords: [], brief_text: "Drafted from the client's posts on 2026-11-03:\n\nOlo sells online ordering.",
    location: { source: 'followers', locality: 'Austin', timezone: 'America/Chicago', website: null }, pillars_source: 'social_posts', pillars_derived_at: NOW,
    field_sources: {
      timezone: { by: 'lifecycle', from: 'followers' }, geo: { by: 'lifecycle', from: 'followers' }, language: { by: 'lifecycle', from: 'posts' },
      logo_url: { by: 'lifecycle', at: NOW, from: 'profile_picture:linkedin' }, brief_text: { by: 'lifecycle', at: NOW, from: 'posts' }, content_pillars: { by: 'lifecycle' },
    },
  };
  f.steps = [
    { step: 'website', status: 'waiting', done_at: null, result: { posts: 214, months: 12, searched_at: NOW, waiting_for: 'website' } },
    { step: 'social_read', status: 'done', done_at: NOW, result: { checked_at: NOW, follower_countries: [{ country: 'US', followers: 70, share: 0.7 }, { country: 'GB', followers: 30, share: 0.3 }], languages: [{ language: 'en', posts: 9 }, { language: 'es', posts: 3 }], language_posts: 12 } },
    { step: 'brief_pillars', status: 'done', done_at: NOW, result: { brief: 'from_posts' } },
    { step: 'competitors', status: 'done', done_at: NOW, result: { selected: ['Toast', 'ChowNow', 'Square'], chosen_from: 'posts' } },
    { step: 'tracking', status: 'waiting', done_at: null, result: { waiting_for: 'client_website' } },
  ];
});
afterEach(() => { cleanup(); });

it('states what the product read from the profiles as facts with dates and counts, and starts nothing on opening', async () => {
  mount();
  expect(await screen.findByText('No website found yet. Looked through 214 posts from the last 12 months and searched the web for Olo on Nov 3, 2026.')).toBeInTheDocument();
  expect(await screen.findByText("Worked out from where most of the client's followers are (Austin). You can change it here.")).toBeInTheDocument();
  expect(screen.getByText("From where the client's followers are: United States 70%, United Kingdom 30%. You can change it here.")).toBeInTheDocument();
  expect(screen.getByText(/From the client's posts: English in 9 of 12, Spanish in 3 of 12\./)).toBeInTheDocument();
  expect(f.rpcs).toEqual([]);
});

it('says where the logo and the brief came from', async () => {
  mount('brief');
  expect(await screen.findByText("From the client's LinkedIn profile picture, Nov 3, 2026. The website's logo replaces it once the website is found; a logo you upload is kept.")).toBeInTheDocument();
  expect(screen.getByText("Drafted from the client's posts on Nov 3, 2026. You can rewrite it; the product never replaces your version.")).toBeInTheDocument();
});

it('says a logo and a time zone from the LinkedIn page came from the page, never from the website', async () => {
  f.client = {
    ...f.client, logo_url: 'https://x/logo-linkedin.png', timezone: 'America/New_York',
    location: { source: 'profile_address', via: 'linkedin_page', locality: 'New York', timezone: 'America/New_York', website: null },
    field_sources: { ...f.client.field_sources, timezone: { by: 'lifecycle', from: 'profile_address' }, logo_url: { by: 'lifecycle', at: NOW, from: 'linkedin_page' } },
  };
  mount();
  expect(await screen.findByText("Worked out from the address on the client's LinkedIn page. You can change it here.")).toBeInTheDocument();
  cleanup();
  mount('brief');
  expect(await screen.findByText("From the logo on the client's LinkedIn page, Nov 3, 2026. The website's logo replaces it once the website is found; a logo you upload is kept.")).toBeInTheDocument();
  expect(screen.queryByText("The logo on file was taken from the client's website.")).toBeNull();
});

it('says a time zone from the agency is the one most of the agency\'s clients use', async () => {
  f.client = { ...f.client, timezone: 'America/New_York', location: { source: 'agency', timezone: 'America/New_York', country: null, website: null }, field_sources: { ...f.client.field_sources, timezone: { by: 'lifecycle', from: 'agency' } } };
  mount();
  expect(await screen.findByText("Worked out from the time zone most of the agency's clients use, until the client's own location is found. You can change it here.")).toBeInTheDocument();
});

it('names the three competitors chosen, and why tracking waits, as a plain fact', async () => {
  mount('competitors');
  expect(await screen.findByText('Toast, ChowNow, Square')).toBeInTheDocument();
  expect(screen.getByText("RivalIQ follows companies by their website, so tracking starts once the client's website is found.")).toBeInTheDocument();
});

it('says how many posts with text the brief waits for, and when the time zone is not known yet', async () => {
  f.client = { ...f.client, brief_text: '', content_pillars: [], timezone: 'UTC', location: null, field_sources: {} };
  f.steps = f.steps.map((s) => (s.step === 'brief_pillars' ? { step: 'brief_pillars', status: 'waiting', done_at: null, result: { waiting_for: 'posts', text_posts: 3 } } : s));
  mount();
  expect(await screen.findByText("Not known yet: no address or location in the client's profiles or posts. Calendar times show in UTC until then.")).toBeInTheDocument();
  cleanup();
  mount('strategy');
  // Under the pillars, and under the brief.
  expect((await screen.findAllByText('Written once the client has 5 posts with text. It has 3.')).length).toBeGreaterThan(0);
});

it('uses no developer words, no em dashes and American spelling in any line it adds', async () => {
  mount();
  await screen.findByText(/No website found yet/);
  const text = document.body.textContent ?? '';
  expect(text).not.toMatch(/social_read|brief_pillars|client_website|rivaliq_full|waiting_for|profile_picture|undefined|NaN/);
  expect(text).not.toMatch(/—/);
  expect(text).not.toMatch(/colour|organis|recognis|licence/);
});
