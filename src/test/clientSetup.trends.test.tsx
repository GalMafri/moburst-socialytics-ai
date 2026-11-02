/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// Client setup, "Trends we track": the topics, the Instagram, TikTok and
// LinkedIn hashtags and the exclusions the weekly trend search uses for this
// client, each with its reason and where it came from. Staff add a term
// (trend_term_add) or remove one (trend_term_remove); a removed suggestion
// is hidden. A client whose brand details are not read yet has no profile.

const f = vi.hoisted(() => ({
  profile: true,
  overrides: {} as Record<string, unknown>,
  terms: [] as any[],
  rpcs: [] as any[],
  reads: [] as any[],
  writeFails: false,
  readFails: false,
  next: 1,
  client: null as any,
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  // The two functions behave as the database's do: a hashtag gets its '#', a term that is already there
  // (removed or not) becomes the team's own, and a removed term stays as a row with removed_at set.
  rpc: async (name: string, args: any) => {
    f.rpcs.push({ name, ...args });
    if (f.writeFails && (name === 'trend_term_add' || name === 'trend_term_remove' || name === 'trend_search_override_clear')) {
      return { data: null, error: { code: '42501', message: 'Only Moburst staff can change what trends track.' } };
    }
    if (name === 'trend_term_add') {
      const term = args.p_kind === 'hashtag' && !String(args.p_term).startsWith('#') ? `#${args.p_term}` : args.p_term;
      const platform = args.p_kind === 'hashtag' ? args.p_platform : null;
      const hit = f.terms.find((t) => t.kind === args.p_kind && (t.platform ?? '') === (platform ?? '') && t.term.toLowerCase() === term.toLowerCase());
      if (hit) { hit.source = 'person'; hit.removed_at = null; return { data: hit.id, error: null }; }
      const row = { id: `new-${f.next++}`, client_id: args.p_client, kind: args.p_kind, platform, term, reason: '', source: 'person', removed_at: null, created_at: '2026-11-02T08:00:00Z' };
      f.terms.push(row);
      return { data: row.id, error: null };
    }
    if (name === 'trend_search_override_clear') {
      // Only that platform's key goes.
      const { [args.p_platform]: _gone, ...rest } = f.overrides;
      f.overrides = rest;
      return { data: null, error: null };
    }
    if (name === 'trend_term_remove') {
      const hit = f.terms.find((t) => t.id === args.p_id);
      if (hit && !hit.removed_at) hit.removed_at = '2026-11-02T08:05:00Z';
      return { data: null, error: null };
    }
    return { data: null, error: null };
  },
  functions: { invoke: async (name: string) => (name === 'sprout-profiles' ? { data: { profiles: [] }, error: null } : { data: {}, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const answer = () => {
      if (table === 'clients') return { data: f.client, error: null };
      if (table === 'client_lifecycle_steps') return { data: { status: 'done', attempted_at: '2026-10-19T10:00:00Z', done_at: '2026-10-19T10:00:00Z' }, error: null };
      if (table === 'trend_profiles') {
        f.reads.push({ table, filters: { ...filters } });
        return f.readFails ? { data: null, error: { code: '08006', message: 'connection failure' } } : { data: f.profile ? { client_id: 'c1', search_overrides: f.overrides } : null, error: null };
      }
      if (table === 'trend_terms') {
        f.reads.push({ table, filters: { ...filters } });
        if (f.readFails) return { data: null, error: { code: '08006', message: 'connection failure' } };
        return { data: f.terms.filter((t) => Object.entries(filters).every(([k, v]) => t[k] === v)), error: null };
      }
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q,
      in: (k: string, v: unknown) => { filters[k] = v; return q; },
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      is: (k: string, v: unknown) => { filters[k] = v; return q; },
      update: () => q, delete: () => q, upsert: () => q,
      maybeSingle: async () => answer(),
      single: async () => answer(),
      then: (resolve: any, reject: any) => Promise.resolve(answer()).then(resolve, reject),
    };
    return q;
  },
} }));
import { toast } from 'sonner';

const term = (over: Record<string, unknown>) => ({
  id: `t${f.next++}`, client_id: 'c1', kind: 'topic', platform: null, term: 'x', reason: '', source: 'lifecycle', removed_at: null, created_at: '2026-10-30T08:00:00Z', ...over,
});
const fixture = () => [
  term({ id: 't1', kind: 'topic', term: 'car accident tips', reason: 'People search this right after a crash.' }),
  term({ id: 't2', kind: 'topic', term: 'insurance claim help', reason: 'Claims confuse people.' }),
  term({ id: 't3', kind: 'topic', term: 'settlement calculator', reason: '', source: 'person' }),
  term({ id: 't4', kind: 'hashtag', platform: 'instagram', term: '#caraccidentlawyer', reason: 'The best posts in this space use it.' }),
  term({ id: 't5', kind: 'hashtag', platform: 'tiktok', term: '#legaltok', reason: 'Lawyers explain rules in short videos.' }),
  term({ id: 't6', kind: 'hashtag', platform: 'linkedin', term: '#personalinjury', reason: 'Used by firms and referral partners.' }),
  term({ id: 't7', kind: 'exclusion', term: 'law school admissions', reason: "Another meaning of the brand's words." }),
  term({ id: 't8', kind: 'exclusion', term: 'ambulance chaser memes', reason: 'Creators joke about lawyers chasing ambulances.', source: 'dismissal' }),
  term({ id: 't9', kind: 'topic', term: 'a topic somebody removed', reason: 'Removed earlier.', removed_at: '2026-10-31T09:00:00Z' }),
];

const clients = new Set<QueryClient>();
function mount(tab = 'strategy', id = 'c1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.add(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/clients/${id}/setup?tab=${tab}`]}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}
const group = async (name: string) => within(await screen.findByRole('group', { name }));
const rowOf = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

beforeEach(() => {
  f.profile = true; f.overrides = {}; f.terms = fixture(); f.rpcs = []; f.reads = []; f.writeFails = false; f.readFails = false; f.next = 100;
  vi.mocked(toast.error).mockClear();
  f.client = {
    id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com', timezone: 'America/New_York', geo: 'US', language: 'en',
    primary_platforms: ['Instagram'], content_pillars: [{ name: 'Injury law', description: 'Plain answers' }], social_keywords: ['car accident lawyer'],
    brand_identity: { primary_color: '#112233' }, brief_text: 'We help', media_backend: 'higgsfield', field_sources: {},
  };
});
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.clear(); vi.restoreAllMocks(); });

describe('Trends we track on the Content strategy tab', () => {
  it('sits after the Social keywords, whose help now says what keywords are for', async () => {
    mount();
    const heading = await screen.findByRole('heading', { name: 'Trends we track' });
    expect(screen.getByText('Social keywords').compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Phrases that describe the brand's space, used for competitor matching and reports\./)).toBeInTheDocument();
    expect(screen.queryByText(/TikTok and Instagram trend search/)).toBeNull();
    expect(screen.queryByText(/keywords trends are searched for/)).toBeNull();
  });

  it('lists the topics, the three hashtag groups and the exclusions, each with its reason and where it came from', async () => {
    mount();
    const topics = await group('Topics');
    expect(await topics.findByText('car accident tips')).toBeInTheDocument();
    expect(topics.getByText('insurance claim help')).toBeInTheDocument();
    expect(within(rowOf('car accident tips')).getByText('Suggested')).toBeInTheDocument();
    expect(within(rowOf('car accident tips')).getByText(/People search this right after a crash\./)).toBeInTheDocument();
    expect(within(rowOf('settlement calculator')).getByText('Added by your team')).toBeInTheDocument();

    for (const [name, tag, reason] of [
      ['Instagram hashtags', '#caraccidentlawyer', /The best posts in this space use it\./],
      ['TikTok hashtags', '#legaltok', /Lawyers explain rules in short videos\./],
      ['LinkedIn hashtags', '#personalinjury', /Used by firms and referral partners\./],
    ] as const) {
      const hashtags = await group(name);
      expect(hashtags.getByText(tag)).toBeInTheDocument();
      expect(within(rowOf(tag)).getByText('Suggested')).toBeInTheDocument();
      expect(within(rowOf(tag)).getByText(reason)).toBeInTheDocument();
    }
    // A tag is in its own platform's group only.
    expect((await group('Instagram hashtags')).queryByText('#legaltok')).toBeNull();

    const exclusions = await group('Exclusions');
    expect(exclusions.getByText('law school admissions')).toBeInTheDocument();
    expect(within(rowOf('law school admissions')).getByText('Suggested')).toBeInTheDocument();
    expect(within(rowOf('ambulance chaser memes')).getByText('From a dismissed trend')).toBeInTheDocument();
    expect(within(rowOf('ambulance chaser memes')).getByText(/Creators joke about lawyers chasing ambulances\./)).toBeInTheDocument();
  });

  it('reads only the terms nobody removed, so a removed suggestion stays hidden', async () => {
    mount();
    await screen.findByText('car accident tips');
    expect(screen.queryByText('a topic somebody removed')).toBeNull();
    const read = f.reads.find((r) => r.table === 'trend_terms');
    expect(read.filters).toEqual({ client_id: 'c1', removed_at: null });
    expect(f.reads.find((r) => r.table === 'trend_profiles').filters).toEqual({ client_id: 'c1' });
  });

  it('says what the product will do once the brand details are read, when there is no profile yet', async () => {
    f.profile = false; f.terms = [];
    mount();
    expect(await screen.findByText('Suggestions appear here once the brand details are read.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /^New / })).toBeNull();
  });

  it('offers an add box for a group with nothing in it yet', async () => {
    f.terms = f.terms.filter((t) => t.kind !== 'exclusion');
    mount();
    const exclusions = await group('Exclusions');
    expect(await exclusions.findByRole('textbox', { name: 'New exclusion' })).toBeInTheDocument();
    expect(exclusions.queryByRole('listitem')).toBeNull();
  });

  it('is not on the page of a client that does not exist yet', async () => {
    mount('strategy', 'new');
    await screen.findByText('Social keywords');
    expect(screen.queryByRole('heading', { name: 'Trends we track' })).toBeNull();
    expect(f.reads).toEqual([]);
  });

  it('adds a topic with its kind and no platform, trimmed, and shows it as the team\'s own once the list is read again', async () => {
    mount();
    const topics = await group('Topics');
    const box = await topics.findByRole('textbox', { name: 'New topic' });
    fireEvent.change(box, { target: { value: '  settlement timeline  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_add', p_client: 'c1', p_kind: 'topic', p_platform: '', p_term: 'settlement timeline' }]));
    expect(await topics.findByText('settlement timeline')).toBeInTheDocument();
    expect(within(rowOf('settlement timeline')).getByText('Added by your team')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('adds a hashtag with its kind and its platform, and the list shows the # the database added', async () => {
    mount();
    const tiktok = await group('TikTok hashtags');
    const box = await tiktok.findByRole('textbox', { name: 'New TikTok hashtag' });
    fireEvent.change(box, { target: { value: 'lawyerlife' } });
    fireEvent.click(tiktok.getByRole('button', { name: 'Add TikTok hashtag' }));
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_add', p_client: 'c1', p_kind: 'hashtag', p_platform: 'tiktok', p_term: '#lawyerlife' }]));
    expect(await tiktok.findByText('#lawyerlife')).toBeInTheDocument();
    expect(within(rowOf('#lawyerlife')).getByText('Added by your team')).toBeInTheDocument();
    expect((await group('Instagram hashtags')).queryByText('#lawyerlife')).toBeNull();
  });

  it('adds an exclusion with its kind and no platform', async () => {
    mount();
    const exclusions = await group('Exclusions');
    const box = await exclusions.findByRole('textbox', { name: 'New exclusion' });
    fireEvent.change(box, { target: { value: 'lawyer jokes' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_add', p_client: 'c1', p_kind: 'exclusion', p_platform: '', p_term: 'lawyer jokes' }]));
    expect(await exclusions.findByText('lawyer jokes')).toBeInTheDocument();
  });

  it('makes a hashtag one tag before it is sent: one leading #, then letters, digits and underscores only', async () => {
    mount();
    const instagram = await group('Instagram hashtags');
    const box = await instagram.findByRole('textbox', { name: 'New Instagram hashtag' });
    for (const [typed, sent] of [
      ['car accident lawyer', '#caraccidentlawyer'], ['##aso', '#aso'], ['  # legal\ttips  ', '#legaltips'], ['#plain', '#plain'],
      ['#café-life!', '#cafélife'], ['#a#b', '#ab'], ['עורך דין', '#עורךדין'], ['#x.y_z', '#xy_z'],
    ] as const) {
      f.rpcs = [];
      fireEvent.change(box, { target: { value: typed } });
      fireEvent.keyDown(box, { key: 'Enter' });
      await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_add', p_client: 'c1', p_kind: 'hashtag', p_platform: 'instagram', p_term: sent }]));
      await waitFor(() => expect(box).toHaveValue(''));
      expect(await instagram.findByText(sent)).toBeInTheDocument();
    }
    // Words with spaces are one tag, so none of them took a slot of its own.
    expect(instagram.queryByText(/ /, { selector: 'li > div' })).toBeNull();
  });

  it('sends nothing for a hashtag with nothing left once all but its letters, digits and underscores are taken out, and keeps what was typed without a message', async () => {
    mount();
    const linkedin = await group('LinkedIn hashtags');
    const box = await linkedin.findByRole('textbox', { name: 'New LinkedIn hashtag' });
    for (const typed of ['#', '###', ' # ', '# #', '## #', '#-!', '# . #', '🚗']) {
      fireEvent.change(box, { target: { value: typed } });
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.click(linkedin.getByRole('button', { name: 'Add LinkedIn hashtag' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(box).toHaveValue(typed);
    }
    expect(f.rpcs).toEqual([]);
    expect(screen.queryByText('That change is not saved yet.')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps a topic or an exclusion as it was typed, spaces and all', async () => {
    mount();
    const topics = await group('Topics');
    fireEvent.change(await topics.findByRole('textbox', { name: 'New topic' }), { target: { value: '#claim help' } });
    fireEvent.click(topics.getByRole('button', { name: 'Add topic' }));
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_add', p_client: 'c1', p_kind: 'topic', p_platform: '', p_term: '#claim help' }]));
  });

  it('adds nothing for a blank box', async () => {
    mount();
    const topics = await group('Topics');
    const box = await topics.findByRole('textbox', { name: 'New topic' });
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(topics.getByRole('button', { name: 'Add topic' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(f.rpcs).toEqual([]);
  });

  it('adding a suggestion again makes it the team\'s own', async () => {
    mount();
    const topics = await group('Topics');
    expect(await topics.findByText('car accident tips')).toBeInTheDocument();
    fireEvent.change(topics.getByRole('textbox', { name: 'New topic' }), { target: { value: 'Car accident tips' } });
    fireEvent.click(topics.getByRole('button', { name: 'Add topic' }));
    await waitFor(() => expect(within(rowOf('car accident tips')).getByText('Added by your team')).toBeInTheDocument());
    expect(topics.getAllByText(/car accident tips/i)).toHaveLength(1);
  });

  it('removes a term by its id, and it leaves the list once the list is read again', async () => {
    mount();
    const topics = await group('Topics');
    fireEvent.click(await topics.findByRole('button', { name: 'Remove topic car accident tips' }));
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_remove', p_id: 't1' }]));
    await waitFor(() => expect(topics.queryByText('car accident tips')).toBeNull());
    expect(topics.getByText('insurance claim help')).toBeInTheDocument();
    // The row is kept, marked removed, so a rewrite of the profile never suggests it again.
    expect(f.terms.find((t) => t.id === 't1').removed_at).toBeTruthy();
  });

  it('removes a hashtag from its own platform\'s group', async () => {
    mount();
    const linkedin = await group('LinkedIn hashtags');
    fireEvent.click(await linkedin.findByRole('button', { name: 'Remove LinkedIn hashtag #personalinjury' }));
    await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_term_remove', p_id: 't6' }]));
    await waitFor(() => expect(linkedin.queryByText('#personalinjury')).toBeNull());
    expect((await group('Instagram hashtags')).getByText('#caraccidentlawyer')).toBeInTheDocument();
  });

  it('keeps what was typed and says it is not added yet when the add does not go through, then adds it on the next try', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    const topics = await group('Topics');
    const box = await topics.findByRole('textbox', { name: 'New topic' });
    f.writeFails = true;
    fireEvent.change(box, { target: { value: 'claim deadlines' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText('That change is not saved yet.')).toBeInTheDocument();
    expect(f.rpcs).toHaveLength(1);
    expect(box).toHaveValue('claim deadlines');
    expect(topics.queryByText('claim deadlines')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText(/Only Moburst staff|42501|try again|failed|error/i)).toBeNull();
    // The team's own log has it; the screen does not.
    expect(warn).toHaveBeenCalledWith('[trends we track] not saved yet', expect.objectContaining({ code: '42501' }));

    f.writeFails = false;
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await topics.findByText('claim deadlines')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('That change is not saved yet.')).toBeNull());
    expect(box).toHaveValue('');
  });

  it('keeps the term on the list and says the change is not saved yet when a removal does not go through', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    const topics = await group('Topics');
    f.writeFails = true;
    fireEvent.click(await topics.findByRole('button', { name: 'Remove topic insurance claim help' }));
    expect(await screen.findByText('That change is not saved yet.')).toBeInTheDocument();
    expect(topics.getByText('insurance claim help')).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps loading, quietly, while the list does not answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.readFails = true;
    mount();
    expect(await screen.findByText(/Loading trends we track/)).toBeInTheDocument();
    expect(screen.queryByText('Suggestions appear here once the brand details are read.')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull();
    expect(screen.queryByText(/connection failure|did not load|could not/i)).toBeNull();
  });

  it('says how each group is used: Instagram hashtags and topics are searched, TikTok and LinkedIn hashtags are calendar suggestions', async () => {
    mount();
    const heading = await screen.findByRole('heading', { name: 'Trends we track' });
    const section = within(heading.closest('section') as HTMLElement);
    expect(section.getByText("What the weekly trends collection searches for and leaves out, and the hashtags suggested for the calendar. Your team's additions always come first.")).toBeInTheDocument();
    const helps: Array<[string, string]> = [
      ['Topics', "Searched every week on each platform except Instagram, up to 8 a week. Your team's come first; the rest take turns."],
      ['Instagram hashtags', "Searched every week on Instagram, up to 8 a week. Your team's come first; the rest take turns."],
      ['TikTok hashtags', 'Suggested for TikTok posts in the weekly calendar. Trends on TikTok are searched by topic.'],
      ['LinkedIn hashtags', 'Suggested for LinkedIn posts in the weekly calendar. Trends on LinkedIn are searched by topic.'],
      ['Exclusions', 'The filter never keeps posts about these.'],
    ];
    for (const [name, help] of helps) expect((await group(name)).getByText(help)).toBeInTheDocument();
    // The old wording is gone.
    expect(section.queryByText(/Instagram searches its hashtags instead|What the weekly trend search looks for/)).toBeNull();
  });

  it('words the section in plain American English, with no dash punctuation and nothing from the database', async () => {
    f.overrides = { linkedin: ['injury claim tips'], instagram: ['#claimhelp'] };
    mount();
    await screen.findByRole('button', { name: 'Go back to the hashtags' });
    const heading = await screen.findByRole('heading', { name: 'Trends we track' });
    await screen.findByText('car accident tips');
    const section = heading.closest('section') as HTMLElement;
    expect(section.textContent).not.toMatch(/[—–]| - /);
    expect(section.textContent).not.toMatch(/trend_terms|trend_profiles|trend_term_|lifecycle|dismissal|undefined|null/i);
    expect(within(section).getByText(/The filter never keeps posts about these\./)).toBeInTheDocument();
  });

  describe('searches a coverage rewrite gave a platform', () => {
    const tiktokLine = 'Trends on TikTok are searched with these terms this week, because the topics found too little:';
    const instagramLine = 'Trends on Instagram are searched with these terms this week, because the hashtags found too little:';

    it('shows nothing about rewrites when no platform has one', async () => {
      f.overrides = { tiktok: [], youtube: [3, ' '] };
      mount();
      await screen.findByText('car accident tips');
      expect(screen.queryByText(/are searched with these terms this week/)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Go back to the/ })).toBeNull();
    });

    it('shows each platform\'s searches under a plain line, topic platforms with the topics and Instagram with its hashtags', async () => {
      f.overrides = { tiktok: ['legal tips', 'injury claim'], instagram: ['#injurylaw', '#claimhelp'], youtube: ['crash explained', 7, ''] };
      mount();
      const tiktok = within(await screen.findByRole('group', { name: 'Searches on TikTok' }));
      expect(tiktok.getByText(tiktokLine)).toBeInTheDocument();
      expect(tiktok.getByText('legal tips')).toBeInTheDocument();
      expect(tiktok.getByText('injury claim')).toBeInTheDocument();
      expect(tiktok.getByRole('button', { name: 'Go back to the topics' })).toBeInTheDocument();

      const instagram = within(screen.getByRole('group', { name: 'Searches on Instagram' }));
      expect(instagram.getByText(instagramLine)).toBeInTheDocument();
      expect(instagram.getByText('#injurylaw')).toBeInTheDocument();
      expect(instagram.getByRole('button', { name: 'Go back to the hashtags' })).toBeInTheDocument();

      // Only the text searches are shown.
      const youtube = within(screen.getByRole('group', { name: 'Searches on YouTube' }));
      expect(youtube.getByText('crash explained')).toBeInTheDocument();
      expect(youtube.queryByText('7')).toBeNull();

      // Each sits in the group whose terms it replaced.
      expect((await group('Topics')).getByRole('group', { name: 'Searches on TikTok' })).toBeInTheDocument();
      expect((await group('Instagram hashtags')).getByRole('group', { name: 'Searches on Instagram' })).toBeInTheDocument();
      expect((await group('Instagram hashtags')).queryByRole('group', { name: 'Searches on TikTok' })).toBeNull();
    });

    it('goes back to the topics for one platform only, and the line leaves once the profile is read again', async () => {
      f.overrides = { tiktok: ['legal tips'], linkedin: ['injury claim tips'], instagram: ['#claimhelp'] };
      mount();
      const tiktok = within(await screen.findByRole('group', { name: 'Searches on TikTok' }));
      fireEvent.click(tiktok.getByRole('button', { name: 'Go back to the topics' }));
      await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_search_override_clear', p_client: 'c1', p_platform: 'tiktok' }]));
      await waitFor(() => expect(screen.queryByRole('group', { name: 'Searches on TikTok' })).toBeNull());
      expect(screen.getByRole('group', { name: 'Searches on LinkedIn' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Searches on Instagram' })).toBeInTheDocument();
      expect(f.overrides).toEqual({ linkedin: ['injury claim tips'], instagram: ['#claimhelp'] });
    });

    it('goes back to the hashtags on Instagram', async () => {
      f.overrides = { instagram: ['#claimhelp'] };
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Go back to the hashtags' }));
      await waitFor(() => expect(f.rpcs).toEqual([{ name: 'trend_search_override_clear', p_client: 'c1', p_platform: 'instagram' }]));
      await waitFor(() => expect(screen.queryByText(instagramLine)).toBeNull());
    });

    it('keeps the searches on screen and says the change is not saved yet when going back does not get through', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      f.overrides = { tiktok: ['legal tips'] };
      f.writeFails = true;
      mount();
      fireEvent.click(await screen.findByRole('button', { name: 'Go back to the topics' }));
      expect(await screen.findByText('That change is not saved yet.')).toBeInTheDocument();
      expect(screen.getByText(tiktokLine)).toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
      expect(screen.queryByText(/Only Moburst staff|42501|try again|failed|error/i)).toBeNull();
      expect(warn).toHaveBeenCalledWith('[trends we track] not saved yet', expect.objectContaining({ code: '42501' }));
    });
  });
});
