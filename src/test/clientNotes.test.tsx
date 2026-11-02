/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// Client setup, "Client notes" (client notes design, section 8): a note box,
// a drop zone for files and folders, what the copy follows now, and the
// notes. Quiet throughout: nothing here shows a failure (the display guard
// scans this component too).

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientNotes } from '@/components/onboarding/ClientNotes';

const f = vi.hoisted(() => ({ upload: vi.fn(), invoke: vi.fn(), tables: {} as Record<string, any[]> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  storage: { from: (bucket: string) => ({ upload: (path: string, file: File, opts: unknown) => f.upload(bucket, path, file, opts) }) },
  functions: { invoke: (name: string, opts: any) => f.invoke(name, opts) },
  from: (table: string) => {
    let rows = [...(f.tables[table] ?? [])];
    const q: any = {
      select: () => q, order: () => q,
      eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === v); return q; },
      is: (k: string, v: unknown) => { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q; },
      then: (resolve: any, reject: any) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return q;
  },
} }));

const NOTE = { client_id: 'c1', kind: 'typed', file_type: null, text_chars: null, parts_done: 1, date_set_by: 'app', added_by_name: 'Sinead', read_at: null };
const POINT = { client_id: 'c1', platform: null, said_on: null, until: null, part: 1, removed_at: null };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ClientNotes clientId="c1" clientName="Bader Law" brandNotes={null} timeZone="America/New_York" /></QueryClientProvider>);
}
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type, lastModified: 1730000000000 + size });

beforeEach(() => {
  f.tables = { client_notes: [], client_note_points: [], client_note_links: [] };
  f.upload.mockResolvedValue({ data: {}, error: null });
  f.invoke.mockResolvedValue({ data: { ok: true }, error: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('adding notes', () => {
  it('makes three uploads and one add call for three dropped files', async () => {
    mount();
    const files = [file('Call Oct 28.pdf', 'application/pdf', 11), file('Feedback.docx', '', 12), file('Screenshot.png', 'image/png', 13)];
    fireEvent.drop(await screen.findByTestId('client-notes-drop'), { dataTransfer: { files } });
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    expect(f.upload.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['client-notes', 'c1/1730000000011-11.pdf'], ['client-notes', 'c1/1730000000012-12.docx'], ['client-notes', 'c1/1730000000013-13.png'],
    ]);
    // Each file goes up as the type its name says, with a repeat writing the same object.
    expect(f.upload.mock.calls[1][2].type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(f.upload.mock.calls[0][3]).toEqual({ upsert: true });
    expect(f.invoke).toHaveBeenCalledWith('client-notes', { body: { action: 'add_files', client_id: 'c1', files: [
      { path: 'c1/1730000000011-11.pdf', name: 'Call Oct 28.pdf' }, { path: 'c1/1730000000012-12.docx', name: 'Feedback.docx' }, { path: 'c1/1730000000013-13.png', name: 'Screenshot.png' },
    ] } });
  });

  it('refuses a kind of file it cannot read with one plain line, and sends nothing for it', async () => {
    mount();
    fireEvent.drop(await screen.findByTestId('client-notes-drop'), { dataTransfer: { files: [file('deck.key', 'application/x-iwork-keynote-sffkey')] } });
    expect(await screen.findByText('deck.key is not a PDF, Word, Excel, CSV, text, Markdown, PNG or JPG file up to 20 MB.')).toBeInTheDocument();
    expect(f.upload).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });

  it('keeps a file that did not go up, ready to send again, and says only that it is not uploaded yet', async () => {
    f.upload.mockResolvedValue({ data: null, error: { statusCode: 413, message: 'Payload too large' } });
    mount();
    fireEvent.drop(await screen.findByTestId('client-notes-drop'), { dataTransfer: { files: [file('a.txt', 'text/plain')] } });
    expect(await screen.findByText('a.txt is not uploaded yet.')).toBeInTheDocument();
    expect(f.invoke).not.toHaveBeenCalled();
    f.upload.mockResolvedValue({ data: {}, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
  });

  it('adds a typed note with an id of its own, dated only when a person picks a date', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Add a note'), { target: { value: 'Call with Bader Law.\nNo puns.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(1));
    const body = f.invoke.mock.calls[0][1].body;
    expect(body).toEqual({ action: 'add_text', client_id: 'c1', note_id: expect.stringMatching(/^[0-9a-f-]{36}$/), text: 'Call with Bader Law.\nNo puns.' });
    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Second call.' } });
    fireEvent.change(screen.getByLabelText('Date of the new note'), { target: { value: '2026-10-28' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledTimes(2));
    expect(f.invoke.mock.calls[1][1].body).toMatchObject({ text: 'Second call.', date: '2026-10-28' });
    expect(f.invoke.mock.calls[1][1].body.note_id).not.toBe(body.note_id);
  });
});

describe('the notes', () => {
  beforeEach(() => {
    f.tables.client_notes = [
      { ...NOTE, id: 'n1', title: 'Call Oct 1', note_date: '2026-10-01', state: 'learned', created_at: '2026-10-01T10:00:00Z' },
      { ...NOTE, id: 'n2', title: 'Call Oct 28', note_date: '2026-10-28', state: 'learned', created_at: '2026-10-28T10:00:00Z' },
      { ...NOTE, id: 'n3', title: 'Invoice.pdf', kind: 'file', file_type: 'pdf', note_date: '2026-10-29', state: 'nothing', created_at: '2026-10-29T10:00:00Z' },
      { ...NOTE, id: 'n4', title: 'Brief.docx', kind: 'file', file_type: 'docx', note_date: '2026-11-02', state: 'reading', parts_done: 0, created_at: '2026-11-02T10:00:00Z' },
    ];
    f.tables.client_note_points = [
      { ...POINT, id: 'old', note_id: 'n1', kind: 'avoid', text: 'Say "budget".', created_at: '2026-10-01T10:05:00Z' },
      { ...POINT, id: 'new', note_id: 'n2', kind: 'avoid', text: 'Never say "cheap"; say "affordable".', created_at: '2026-10-28T10:05:00Z' },
      { ...POINT, id: 'ig', note_id: 'n2', kind: 'do', text: 'Use carousels.', platform: 'Instagram', created_at: '2026-10-28T10:05:00Z' },
    ];
    f.tables.client_note_links = [{ client_id: 'c1', point_id: 'new', other_id: 'old', relation: 'conflict' }];
  });

  it('lists the notes newest first with one line each, and what the copy follows now', async () => {
    mount();
    const list = await screen.findByRole('list', { name: 'Notes' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => within(i).getByRole('button', { name: /^Open / }).textContent)).toEqual(['Brief.docx', 'Invoice.pdf', 'Call Oct 28', 'Call Oct 1']);
    expect(within(items[0]).getByText('Reading')).toBeInTheDocument();
    expect(within(items[1]).getByText('Nothing in this note for the copy')).toBeInTheDocument();
    expect(within(items[2]).getByText('2 points learned')).toBeInTheDocument();
    expect(within(items[2]).getByText('Added by Sinead on Oct 28, 2026')).toBeInTheDocument();

    const follows = screen.getByRole('region', { name: 'What the copy follows now' });
    expect(within(follows).getByText('Never say "cheap"; say "affordable".')).toBeInTheDocument();
    expect(within(follows).getByText('Use carousels.')).toBeInTheDocument();
    expect(within(follows).getByText(/Instagram only/)).toBeInTheDocument();
    // The older point a newer note replaced is not followed.
    expect(within(follows).queryByText('Say "budget".')).toBeNull();
  });

  it('opens a note to show its points, which a newer note replaced, and removes one point', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Call Oct 1' }));
    const opened = screen.getByRole('group', { name: 'Points from Call Oct 1' });
    expect(within(opened).getByText('Say "budget".')).toBeInTheDocument();
    expect(within(opened).getByText('Replaced by a newer note')).toBeInTheDocument();
    fireEvent.click(within(opened).getByRole('button', { name: 'Remove this point' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('client-notes', { body: { action: 'remove_point', point_id: 'old' } }));
  });

  it('asks before removing a note, and says copy already written stays as it is', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Call Oct 28' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Copy already written stays as it is\./)).toBeInTheDocument();
    expect(f.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('client-notes', { body: { action: 'remove_note', note_id: 'n2' } }));
  });

  it("changes a note's date as a person's date", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Date of Call Oct 1'), { target: { value: '2026-09-30' } });
    await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('client-notes', { body: { action: 'set_date', note_id: 'n1', date: '2026-09-30' } }));
  });

  it('says only that a change is not saved yet when it does not get through', async () => {
    f.invoke.mockResolvedValue({ data: null, error: { context: { status: 400 } } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Call Oct 28' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('That change is not saved yet.')).toBeInTheDocument();
  });
});
