/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';

// The strategy cards' edit sheets: a person's goals keep their words but show
// the latest numbers and dates, the sheet speaks plainly (no product or
// vendor names), and a competitor or a platform is picked from a list instead
// of typed before a colon.

const f = vi.hoisted(() => ({ rpcs: [] as any[], competitors: [] as string[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  // The client's competitor set, as the editor reads it when a positioning sheet opens.
  from: (table: string) => {
    const rows = table === 'competitor_sets' ? [{ id: 's1' }] : f.competitors.map((name) => ({ name }));
    const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: rows[0] ?? null, error: null }), then: (ok: any) => ok({ data: rows, error: null }) };
    return q;
  },
  rpc: async (name: string, args: any) => {
    f.rpcs.push({ name, ...args });
    return { data: { section_key: args.p_key, text: args.p_text, value: args.p_value ?? null, editor_name: 'Neria Cohen', edited_at: '2026-11-04T09:00:00Z', source: 'app' }, error: null };
  },
} }));

import { GoalCards } from '@/components/strategy/GoalCards';
import { NotNow, PlatformCard } from '@/components/strategy/PlatformCard';
import { PositioningCard } from '@/components/strategy/AudiencePosition';
import { MemoryRouter } from 'react-router-dom';
import { StrategyBody } from '@/pages/ClientStrategy';

const goal = (over: any = {}) => ({ title: 'Grow reach', why: 'More captains see us.', platform: 'Instagram', metric: 'median_engagement', direction: 'above', baseline: 61, by: '2027-05-01', ...over });
const edit = (key: string, value: any, over: any = {}) => ({ section_key: key, text: 'x', value, editor_name: 'Neria Cohen', edited_at: '2026-11-04T09:00:00Z', source: 'app', ...over });
const props = (sectionKey: string, product: any, e?: any) => ({ clientId: 'c1', sectionKey, product, edit: e, onSaved: () => {} });

beforeEach(() => { f.rpcs = []; f.competitors = []; });
afterEach(cleanup);

describe('a person\'s edited goals', () => {
  it('show the latest numbers and dates under the title the person wrote', () => {
    const stored = edit('goals', { items: [goal({ title: 'Grow reach my way', baseline: 42, by: '2027-02-01' })] });
    const view = render(<GoalCards {...props('goals', { items: [goal()] }, stored)} />);
    const goals = within(view.getByTestId('strategy-goals'));
    expect(goals.getByText('Grow reach my way')).toBeInTheDocument();
    expect(goals.getByText('61')).toBeInTheDocument();
    expect(goals.getByText(/May 1, 2027/)).toBeInTheDocument();
    expect(goals.queryByText('42')).toBeNull();
    expect(goals.queryByText(/Feb 1, 2027/)).toBeNull();
  });

  it('are saved as the words typed, without the numbers and dates', async () => {
    const view = render(<GoalCards {...props('goals', { items: [goal()] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit the goals' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Goal 1'), { target: { value: 'Grow reach my way' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value).toEqual({ items: [{ title: 'Grow reach my way', why: 'More captains see us.', platform: 'Instagram', metric: 'median_engagement', direction: 'above' }] });
    expect(f.rpcs[0].p_text).toBe('- Grow reach my way. Why: More captains see us.');
  });

  it('stay on the goal they were written for when a rewrite lists the goals in another order, and keep a goal the rewrite dropped in view', async () => {
    const stored = edit('goals', { items: [
      { title: 'My LinkedIn goal', why: 'Mine.', platform: 'LinkedIn', metric: 'followers', direction: 'above' },
      { title: 'My TikTok goal', why: 'Also mine.', platform: 'TikTok', metric: 'followers', direction: 'above' },
    ] });
    const latest = { items: [goal(), goal({ title: 'Grow LinkedIn', platform: 'LinkedIn', metric: 'followers', baseline: 900 })] };
    const view = render(<GoalCards {...props('goals', latest, stored)} />);
    const goals = within(view.getByTestId('strategy-goals'));
    expect(goals.getByText('Grow reach')).toBeInTheDocument();
    expect(goals.getByText('My LinkedIn goal')).toBeInTheDocument();
    expect(goals.queryByText('Grow LinkedIn')).toBeNull();
    expect(goals.queryByText('My TikTok goal')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Edit the goals' }));
    const sheet = within(await view.findByRole('dialog'));
    expect(sheet.getByText('Your earlier goals')).toBeInTheDocument();
    expect(sheet.getByText('My TikTok goal. Also mine.')).toBeInTheDocument();
  });

  it('keep a goal the rewrite dropped in what is saved until it is removed in the sheet', async () => {
    const orphan = { title: 'My TikTok goal', why: 'Also mine.', platform: 'TikTok', metric: 'followers', direction: 'above' };
    const stored = edit('goals', { items: [{ title: 'My reach goal', why: 'Mine.', platform: 'Instagram', metric: 'median_engagement', direction: 'above' }, orphan] });
    const view = render(<GoalCards {...props('goals', { items: [goal()] }, stored)} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit the goals' }));
    let sheet = within(await view.findByRole('dialog'));
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value.items).toHaveLength(2);
    expect(f.rpcs[0].p_value.items[1]).toEqual(orphan);
    expect(f.rpcs[0].p_text).toBe('- My reach goal. Why: Mine.');
    cleanup();
    f.rpcs = [];
    const again = render(<GoalCards {...props('goals', { items: [goal()] }, stored)} />);
    fireEvent.click(again.getByRole('button', { name: 'Edit the goals' }));
    sheet = within(await again.findByRole('dialog'));
    fireEvent.click(sheet.getByRole('button', { name: 'Remove earlier goal 1' }));
    expect(sheet.queryByText('My TikTok goal. Also mine.')).toBeNull();
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value.items).toHaveLength(1);
  });

  it('keep their words in the table of how each platform is measured, on the page', () => {
    const strategy = { shape: 2, written_at: '2026-11-03T10:00:00Z', sources: [], pillars: [], sections: { goals: { items: [goal(), goal({ title: 'Grow TikTok', platform: 'TikTok', metric: 'followers' })] } },
      platforms: [{ platform: 'Instagram', key: 'instagram', state: 'posting', handle: null, reason: null, cadence: null }, { platform: 'TikTok', key: 'tiktok', state: 'posting', handle: null, reason: null, cadence: null }] } as any;
    const stored = edit('goals', { items: [{ title: 'Mine', why: 'w', platform: 'Instagram', metric: 'median_engagement', direction: 'above' }] });
    const view = render(<MemoryRouter><StrategyBody clientId="c1" client="Acme" logo={null} strategy={strategy} edits={[stored] as any} posts={[]} onSaved={() => {}} /></MemoryRouter>);
    const table = within(view.getByTestId('strategy-measures'));
    // The person edited one goal; the other platform keeps the latest write's goal in the table.
    expect(table.getByText('median engagement per post, above')).toBeInTheDocument();
    expect(table.getByText('followers, above')).toBeInTheDocument();
    expect(table.queryByText('Posts a week')).toBeNull();
  });

  it('say only that numbers and dates stay current on a goals or platform card', async () => {
    const goals = render(<GoalCards {...props('goals', { items: [goal()] })} />);
    fireEvent.click(goals.getByRole('button', { name: 'Edit the goals' }));
    expect((await goals.findByRole('dialog')).textContent).toContain('Numbers and dates stay current.');
    cleanup();
    const view = render(<PositioningCard {...props('positioning', { statement: 'S', points: [] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit our position' }));
    expect((await view.findByRole('dialog')).textContent).not.toContain('Numbers and dates');
  });
});

describe('saving a goals or platform card unchanged', () => {
  // The written version's typed part is what an unchanged sheet saves, so the save hands the card back: no person's version is created.
  it('hands the goals card back instead of saving a version', async () => {
    const view = render(<GoalCards {...props('goals', { items: [goal(), goal({ title: 'Grow TikTok', platform: 'TikTok', metric: 'followers', baseline: 900 })] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit the goals' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_text).toBe('');
    expect(f.rpcs[0].p_value).toBeNull();
  });

  it('hands a person\'s goals back when their words are put back to the written ones', async () => {
    const stored = edit('goals', { items: [{ title: 'Grow reach my way', why: 'More captains see us.', platform: 'Instagram', metric: 'median_engagement', direction: 'above' }] });
    const view = render(<GoalCards {...props('goals', { items: [goal()] }, stored)} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit the goals' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Goal 1'), { target: { value: 'Grow reach' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0]).toMatchObject({ p_text: '', p_value: null });
  });

  it('hands the platform card back instead of saving a version', async () => {
    const product = { role: 'Home of the league.', post: ['Checklists', 'Game recaps'], worked: [{ date: '2026-10-05', multiple: 2.7, metric: 'impressions', link: null, text: 'A recap', format: 'carousel' }], checks: { day_30: 'Two posts a week.', day_90: 'Median above 60.' } };
    const p = { platform: 'Instagram', key: 'instagram', state: 'posting', handle: null, reason: null, cadence: null } as any;
    const view = render(<PlatformCard p={p} {...props('platform:instagram:posting', product)} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit Instagram' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0]).toMatchObject({ p_text: '', p_value: null });
  });

  it('still saves a version when only a word changes', async () => {
    const product = { role: 'Home of the league.', post: ['Checklists'], worked: [], checks: { day_30: 'a', day_90: 'b' } };
    const p = { platform: 'Instagram', key: 'instagram', state: 'posting', handle: null, reason: null, cadence: null } as any;
    const view = render(<PlatformCard p={p} {...props('platform:instagram:posting', product)} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit Instagram' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Role'), { target: { value: 'Our home.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value).toEqual({ role: 'Our home.', post: ['Checklists'], checks: { day_30: 'a', day_90: 'b' } });
  });
});

describe('the edit sheet', () => {
  it('says nothing about the product or Claude', async () => {
    const stored = edit('positioning', null, { text: 'Payments first.', source: 'claude' });
    const view = render(<PositioningCard {...props('positioning', { statement: 'S', points: [{ vs: 'BenchApp', point: 'P' }] }, stored)} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit our position' }));
    const sheet = await view.findByRole('dialog');
    expect(sheet.textContent).not.toMatch(/product|claude/i);
    expect(within(sheet).getByText('The version saved from the connector')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Go back to the written version' })).toBeInTheDocument();
  });

  it('asks to keep each line to the cap in plain words', async () => {
    const view = render(<PositioningCard {...props('positioning', { statement: 'S', points: [] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await view.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Our position'), { target: { value: 'x'.repeat(150) } });
    expect(sheet.getByText('A line has 150 characters. Keep each line to 140 characters.')).toBeInTheDocument();
  });

  it('offers a competitor in the client\'s set that no written point names, and saves it', async () => {
    f.competitors = ['Rival Co', 'BenchApp', 'Third Co'];
    const view = render(<PositioningCard {...props('positioning', { statement: 'S', points: [{ vs: 'BenchApp', point: 'We post checklists.' }] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await view.findByRole('dialog'));
    await waitFor(() => expect([...(sheet.getByLabelText('Competitor 1') as HTMLSelectElement).options].map((o) => o.textContent)).toContain('Third Co'));
    fireEvent.click(sheet.getByRole('button', { name: 'Add a line' }));
    fireEvent.change(sheet.getByLabelText('Competitor 2'), { target: { value: 'Third Co' } });
    fireEvent.change(sheet.getByLabelText('Against each competitor 2'), { target: { value: 'We are faster.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value.points).toEqual([{ vs: 'BenchApp', point: 'We post checklists.' }, { vs: 'Third Co', point: 'We are faster.' }]);
  });

  it('picks a competitor for each point and waits on a point without one', async () => {
    const view = render(<PositioningCard {...props('positioning', { statement: 'S', points: [{ vs: 'BenchApp', point: 'We post checklists.' }] })} competitorNames={['Rival Co']} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await view.findByRole('dialog'));
    expect(sheet.queryByText(/colon/i)).toBeNull();
    const pick = sheet.getByLabelText('Competitor 1') as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Choose a competitor', 'Rival Co', 'BenchApp']);
    fireEvent.click(sheet.getByRole('button', { name: 'Add a line' }));
    fireEvent.change(sheet.getByLabelText('Against each competitor 2'), { target: { value: 'We are faster.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    // Save waits; the empty half is outlined and a line beside it says what is missing.
    expect(sheet.queryByRole('alert')).toBeNull();
    const empty = sheet.getByLabelText('Competitor 2');
    expect(empty.className).toContain('border-destructive');
    expect(sheet.getByLabelText('Competitor 1').className).not.toContain('border-destructive');
    expect(empty.getAttribute('aria-describedby')).toBeTruthy();
    expect(sheet.getByText('Choose a competitor for each point.')).toBeInTheDocument();
    expect(sheet.getByLabelText('Against each competitor 2').className).not.toContain('border-destructive');
    expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(sheet.getByLabelText('Competitor 2')).toBeRequired();
    expect(sheet.getByLabelText('Competitor 1')).not.toBeRequired();
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    expect(f.rpcs).toHaveLength(0);
    fireEvent.change(sheet.getByLabelText('Competitor 2'), { target: { value: 'Rival Co' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value.points).toEqual([{ vs: 'BenchApp', point: 'We post checklists.' }, { vs: 'Rival Co', point: 'We are faster.' }]);
  });

  it('picks a platform beside each Not now reason', async () => {
    const view = render(<NotNow {...props('not_now', { items: [{ platform: 'YouTube', reason: 'Long video is costly to make.' }] })} />);
    fireEvent.click(view.getByRole('button', { name: 'Edit not now' }));
    const sheet = within(await view.findByRole('dialog'));
    expect((sheet.getByLabelText('Platform 1') as HTMLSelectElement).value).toBe('YouTube');
    fireEvent.change(sheet.getByLabelText('Platform 1'), { target: { value: 'Pinterest' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(f.rpcs).toHaveLength(1));
    expect(f.rpcs[0].p_value).toEqual({ items: [{ platform: 'Pinterest', reason: 'Long video is costly to make.' }] });
  });
});
