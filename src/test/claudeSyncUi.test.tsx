/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// What the app shows of the two-way sync with Claude: the Claude project
// panel in Client setup (staff only, the client's name and id filled in, a
// Copy button for each text), the decks on a report (newest first; staff see
// who saved them from Claude, clients when they were added; nothing while
// there are none), and where a note or a strategy section came from.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const f = vi.hoisted(() => ({ staff: true, rows: [] as any[], filters: [] as Array<[string, unknown]>, signed: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => { f.filters.push([k, v]); return q; },
      order: () => q,
      then: (ok: any, bad: any) => Promise.resolve({ data: table === 'report_decks' ? f.rows : [], error: null }).then(ok, bad),
    };
    return q;
  },
  storage: { from: (bucket: string) => ({ createSignedUrl: (path: string, seconds: number) => f.signed(bucket, path, seconds) }) },
} }));

import { ClaudeProject } from '@/components/onboarding/ClaudeProject';
import { openDeck, ReportDecks } from '@/components/reports/ReportDecks';
import { originLine } from '@/components/strategy/StrategySection';
import { knowledgePrompt, projectInstruction } from '@/lib/claudeProject';
import { deckAddedLine, noteAddedLine } from '@/lib/display';

const BADER = '00000000-0000-4000-8000-000000000001';
const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

beforeEach(() => { f.staff = true; f.rows = []; f.filters = []; f.signed.mockResolvedValue({ data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/report-decks/a.pptx?token=t' }, error: null }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the Claude project panel', () => {
  it('shows staff the instruction and the one-time prompt for this client, each with Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    wrap(<ClaudeProject clientId={BADER} clientName="Bader Law" />);
    expect(screen.getByRole('heading', { name: 'Claude project' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project instruction').textContent).toBe(projectInstruction({ name: 'Bader Law', id: BADER }));
    expect(screen.getByLabelText("Send this project's knowledge").textContent).toBe(knowledgePrompt({ name: 'Bader Law', id: BADER }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy the project instruction' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(projectInstruction({ name: 'Bader Law', id: BADER })));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows nothing to anyone but staff', () => {
    f.staff = false;
    const { container } = wrap(<ClaudeProject clientId={BADER} clientName="Bader Law" />);
    expect(container.textContent).toBe('');
  });
});

describe('the decks on a report', () => {
  const DECKS = [
    { id: 'd2', title: 'October deck', kind: 'pptx', file_path: `${BADER}/r1/d2.pptx`, link: null, source: 'claude', added_by_name: 'Sinead', created_at: '2026-11-03T12:00:00Z' },
    { id: 'd1', title: 'Q3 field', kind: 'link', file_path: null, link: 'https://docs.google.com/presentation/d/1', source: 'claude', added_by_name: 'Neria', created_at: '2026-10-02T12:00:00Z' },
  ];

  it('lists them newest first; staff see who saved each from Claude', async () => {
    f.rows = DECKS;
    wrap(<ReportDecks reportId="r1" kind="social" />);
    const list = await screen.findByRole('region', { name: 'Decks' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('p')!.textContent)).toEqual(['October deck', 'Q3 field']);
    expect(within(items[0]).getByText('From Claude, by Sinead on Nov 3, 2026')).toBeInTheDocument();
    expect(f.filters).toContainEqual(['report_id', 'r1']);
  });

  it('shows a client when each was added, and reads a competitive report by its own column', async () => {
    f.staff = false;
    f.rows = DECKS;
    wrap(<ReportDecks reportId="cr1" kind="competitive" />);
    expect(await screen.findByText('Added on Nov 3, 2026')).toBeInTheDocument();
    expect(screen.queryByText(/Claude/)).toBeNull();
    expect(f.filters).toContainEqual(['competitive_report_id', 'cr1']);
  });

  it('shows nothing while a report has none', async () => {
    const { container } = wrap(<ReportDecks reportId="r1" kind="social" />);
    await waitFor(() => expect(f.filters.length).toBeGreaterThan(0));
    expect(container.textContent).toBe('');
  });

  it("opens a link deck at its link, and a file deck through a short link made for the person", async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(((url?: string) => (url ? null : tab)) as any);
    await openDeck(DECKS[1] as any);
    expect(open).toHaveBeenCalledWith('https://docs.google.com/presentation/d/1', '_blank', 'noopener,noreferrer');
    await openDeck(DECKS[0] as any);
    expect(f.signed).toHaveBeenCalledWith('report-decks', `${BADER}/r1/d2.pptx`, 600);
    expect(tab.location.href).toBe('https://x.supabase.co/storage/v1/object/sign/report-decks/a.pptx?token=t');
  });

  it('closes the tab quietly when the file has no link yet', async () => {
    const tab = { location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockImplementation((() => tab) as any);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    f.signed.mockResolvedValue({ data: null, error: { message: 'Object not found' } });
    vi.useFakeTimers();
    const done = openDeck(DECKS[0] as any);
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
  });
});

describe('where a note, a section or a deck came from', () => {
  it('says From Claude, by the person, for what was saved from Claude', () => {
    expect(noteAddedLine({ added_by_name: 'Sinead', created_at: '2026-11-03T12:00:00Z', source: 'claude' }, 'America/New_York')).toBe('From Claude, by Sinead on Nov 3, 2026');
    expect(noteAddedLine({ added_by_name: null, created_at: '2026-11-03T12:00:00Z', source: 'claude' })).toBe('From Claude on Nov 3, 2026');
    expect(noteAddedLine({ added_by_name: 'Sinead', created_at: '2026-10-28T12:00:00Z', source: 'app' })).toBe('Added by Sinead on Oct 28, 2026');
    expect(noteAddedLine({ added_by_name: '', created_at: '2026-10-28T12:00:00Z' })).toBe('Added on Oct 28, 2026');
    expect(deckAddedLine({ added_by_name: 'Sinead', created_at: '2026-11-03T12:00:00Z', source: 'claude' }, { staff: true })).toBe('From Claude, by Sinead on Nov 3, 2026');
    expect(deckAddedLine({ added_by_name: 'Sinead', created_at: '2026-11-03T12:00:00Z', source: 'claude' }, { staff: false })).toBe('Added on Nov 3, 2026');
    const written = { at: '2026-11-01T00:00:00Z', sources: [] };
    expect(originLine({ section_key: 'goals', text: 't', editor_name: 'Sinead Cronin', edited_at: '2026-11-03T12:00:00Z', source: 'claude' }, written)).toBe('From Claude, by Sinead on Nov 3. Kept when the strategy is rewritten.');
    expect(originLine({ section_key: 'goals', text: 't', editor_name: 'Neria', edited_at: '2026-11-03T12:00:00Z', source: 'app' }, written)).toBe('Edited by Neria on Nov 3. Kept when the strategy is rewritten.');
  });
});
