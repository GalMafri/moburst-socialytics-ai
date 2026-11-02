// supabase/functions/_shared/notes/run.ts
//
// The notes_read job (client notes design, sections 3 and 9), run by
// run-scheduled-jobs. Each run does one bounded piece of work:
//   * the oldest waiting note's next part is read with one call to
//     MEMORY_MODEL, against the points in use, so each call sees what earlier
//     notes and parts taught; the job then asks to run again at once;
//   * with nothing waiting, it asks for one rewrite of each planned week the
//     new Avoid and Do points have not reached, and is done.
// A file's text is read out with no model call (read.ts) and kept on the
// note, so a part is never read from the file twice; a scan or a screenshot
// goes to the call as the file itself. A run that does not finish leaves the
// note Reading and is tried again with growing waits; what a stopped run
// wrote for a part is cleared before the part is read again.

import { anthropicMessages } from "../anthropic.ts";
import { MEMORY_MODEL } from "../voice/load.ts";
import { retryWait } from "../calendar/runWeek.ts";
import { inheritedLinks, parseReading, pointsInUse, readingPrompt, readNoteRows, todayIn, NOTES_BUCKET, type LinkRow, type NoteFileType } from "./notes.ts";
import { IMAGE_MAX_BYTES, readNoteFile, splitParts, type NoteSource, type Parsers } from "./read.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface NotesJob {
  id: string;
  kind: string;
  client_id: string;
  attempts: number;
  max_attempts: number;
}

export interface NotesJobOutcome {
  status: "done" | "queued" | "skipped";
  reason?: string | null;
  result?: Record<string, unknown> | null;
  available_at?: string;
  /** The job moved on to the next part or note: its tries start again. */
  resetAttempts?: boolean;
}

export interface NotesDeps {
  /** The file parsers (parsers.ts), loaded only when a DOCX, XLSX or PDF needs one. */
  parsers(): Promise<Parsers>;
}

/** Room for the thinking and the points of one part. */
export const READ_MAX_TOKENS = 6000;

/** The note a rewrite with no person carries (section 9). */
export const rewriteNote = (brand: string) => `Follow what ${brand} told the team in its newest notes.`;

const NEEDS_PARSER: ReadonlySet<NoteFileType> = new Set(["docx", "xlsx", "pdf"]);
const UNUSED: Parsers = {
  docxText: () => Promise.reject(new Error("No parser is loaded for this file.")),
  xlsxSheets: () => Promise.reject(new Error("No parser is loaded for this file.")),
  pdfText: () => Promise.reject(new Error("No parser is loaded for this file.")),
};

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const list = (x: unknown) => (Array.isArray(x) ? x : String(x ?? "").split(",")).map((v) => String(v).trim()).filter(Boolean);
const usage = (raw: unknown) => {
  const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
  return { input: Number(u?.input_tokens) || 0, output: Number(u?.output_tokens) || 0 };
};

function apiKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return key;
}

async function must<T = unknown>(p: PromiseLike<{ data?: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

interface Client { id: string; name: string; timezone: string | null; primary_platforms: unknown }
interface WaitingNote {
  id: string; kind: string; file_path: string | null; file_type: NoteFileType | null; text: string | null; parts_done: number;
  note_date: string; date_set_by: string; input_tokens: number; output_tokens: number;
}

export async function runNotesRead(admin: Db, job: NotesJob, deps: NotesDeps, now = new Date()): Promise<NotesJobOutcome> {
  try {
    const client = await must<Client | null>(admin.from("clients").select("id, name, timezone, primary_platforms").eq("id", job.client_id).maybeSingle(), "Could not read the client");
    if (!client) return { status: "skipped", reason: "The client no longer exists." };
    const today = todayIn(String(client.timezone || "UTC"), now);
    const waiting = await must<WaitingNote[] | null>(admin.from("client_notes")
      .select("id, kind, file_path, file_type, text, parts_done, note_date, date_set_by, input_tokens, output_tokens")
      .eq("client_id", client.id).eq("state", "reading").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1), "Could not read the waiting notes");
    const note = waiting?.[0];
    if (!note) return { status: "done", result: { rewrites: await askForRewrites(admin, client, today) } };
    const read = await readOnePart(admin, client, note, deps, now, today);
    return { status: "queued", available_at: now.toISOString(), resetAttempts: true, result: { note_id: note.id, ...read } };
  } catch (e) {
    // Whatever went wrong (a provider error, a reply that could not be read), the note stays Reading and is read again later.
    return { status: "queued", reason: message(e), available_at: new Date(now.getTime() + retryWait(job.attempts)).toISOString() };
  }
}

/** The file's bytes; a screenshot over what one reading takes comes as storage's smaller rendition. Null when the file is gone. */
async function download(admin: Db, path: string, type: NoteFileType): Promise<Uint8Array | null> {
  const bucket = admin.storage.from(NOTES_BUCKET);
  const { data, error } = await bucket.download(path);
  if (error || !data) {
    if (/not.?found/i.test(String(error?.message ?? ""))) return null;
    throw new Error(`Could not read the note's file: ${error?.message ?? "no file"}`);
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  if ((type === "png" || type === "jpg") && bytes.length > IMAGE_MAX_BYTES) {
    const smaller = await bucket.download(path, { transform: { width: 2000, height: 2000, resize: "contain", format: "origin" } });
    if (smaller.data) return new Uint8Array(await smaller.data.arrayBuffer());
  }
  return bytes;
}

/** What the note holds for the reading call: its kept text, or what its file holds. */
async function noteSource(admin: Db, note: WaitingNote, deps: NotesDeps): Promise<NoteSource> {
  if (note.text != null) return { kind: "text", text: note.text, chars: note.text.length };
  if (!note.file_path || !note.file_type) return { kind: "nothing", why: "The note has no text and no file." };
  const bytes = await download(admin, note.file_path, note.file_type);
  if (!bytes) return { kind: "nothing", why: "The note's file is no longer stored." };
  const source = await readNoteFile(bytes, note.file_type, NEEDS_PARSER.has(note.file_type) ? await deps.parsers() : UNUSED);
  if (source.kind === "text") {
    // Kept on the note, so every part is cut from the same text.
    await must(admin.from("client_notes").update({ text: source.text, text_chars: source.chars, updated_at: new Date().toISOString() }).eq("id", note.id), "Could not keep the note's text");
  }
  return source;
}

async function finishNote(admin: Db, noteId: string, patch: Record<string, unknown>, now: Date): Promise<"learned" | "nothing"> {
  const kept = await must<Array<{ id: string }> | null>(admin.from("client_note_points").select("id").eq("note_id", noteId).is("removed_at", null).limit(1), "Could not count the note's points");
  const state = kept?.length ? "learned" : "nothing";
  await must(admin.from("client_notes").update({ ...patch, state, read_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", noteId).eq("state", "reading"), "Could not finish the note");
  return state;
}

async function readOnePart(admin: Db, client: Client, note: WaitingNote, deps: NotesDeps, now: Date, today: string): Promise<Record<string, unknown>> {
  const source = await noteSource(admin, note, deps);
  if (source.kind === "nothing") {
    console.log(`[notes] ${note.id}: nothing to read (${source.why})`);
    return { state: await finishNote(admin, note.id, {}, now), why: source.why };
  }

  const parts = source.kind === "text" ? splitParts(source.text) : [null];
  const index = Math.min(Math.max(1, note.parts_done + 1), parts.length);
  // A part a stopped run began is read again from a clean slate.
  await must(admin.from("client_note_points").delete().eq("note_id", note.id).gte("part", index), "Could not clear a part read before");

  const rows = await readNoteRows(admin, client.id);
  const inUse = pointsInUse(rows.notes, rows.points, rows.links, today);
  const platforms = list(client.primary_platforms);
  const part = parts[index - 1];
  const { prompt, aliases } = readingPrompt({
    brand: String(client.name), noteDate: note.note_date, platforms, inUse,
    ...(part !== null ? { text: part } : { attached: source.kind === "image" ? "screenshot" as const : "document" as const }),
    part: { index, total: parts.length },
  });
  const content = source.kind === "document"
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: source.data } }, { type: "text", text: prompt }]
    : source.kind === "image"
      ? [{ type: "image", source: { type: "base64", media_type: source.mediaType, data: source.data } }, { type: "text", text: prompt }]
      : prompt;
  const result = await anthropicMessages({ apiKey: apiKey(), body: { model: MEMORY_MODEL, max_tokens: READ_MAX_TOKENS, messages: [{ role: "user", content }] } });
  const u = usage(result.raw);
  const tokens = { input_tokens: note.input_tokens + u.input, output_tokens: note.output_tokens + u.output };
  const reading = parseReading(result.text, { aliases, platforms, today });
  if (!reading) {
    // Every call is counted on the note, a reply that could not be read too.
    await must(admin.from("client_notes").update({ ...tokens, updated_at: now.toISOString() }).eq("id", note.id), "Could not count the reading");
    throw new Error("The reading's reply could not be read.");
  }

  // The ids are made here, so the links can name the points they join.
  const ids = reading.points.map(() => crypto.randomUUID());
  if (reading.points.length) {
    await must(admin.from("client_note_points").insert(reading.points.map((p, i) => ({
      id: ids[i], note_id: note.id, client_id: client.id, kind: p.kind, text: p.text, platform: p.platform, said_on: p.said_on, until: p.until, part: index,
    }))), "Could not keep the note's points");
  }
  const links: LinkRow[] = [];
  const seen = new Set<string>();
  const add = (l: LinkRow) => {
    const key = [l.point_id, l.other_id].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    links.push(l);
  };
  reading.points.forEach((p, i) => {
    for (const other of p.contradicts) add({ point_id: ids[i], other_id: other, relation: "conflict" });
    for (const other of p.repeats) {
      add({ point_id: ids[i], other_id: other, relation: "same" });
      // A repeat takes over the links of the point it repeats.
      for (const l of inheritedLinks(ids[i], other, [...rows.links, ...links])) add(l);
    }
  });
  if (links.length) {
    await must(admin.from("client_note_links").insert(links.map((l) => ({ ...l, client_id: client.id }))), "Could not keep how the points relate");
  }

  // The date the note itself gives, unless a person set one (checked again as it is written).
  if (index === 1 && reading.noteDate && note.date_set_by !== "person" && reading.noteDate !== note.note_date) {
    await must(admin.from("client_notes").update({ note_date: reading.noteDate }).eq("id", note.id).eq("date_set_by", "app"), "Could not date the note");
  }
  const patch = { ...tokens, parts_done: index };
  if (index < parts.length) {
    await must(admin.from("client_notes").update({ ...patch, updated_at: now.toISOString() }).eq("id", note.id), "Could not record the part");
    return { part: index, parts: parts.length, points: reading.points.length };
  }
  return { part: index, parts: parts.length, points: reading.points.length, state: await finishNote(admin, note.id, patch, now) };
}

/**
 * One rewrite, with no person, of each planned week with days to come that
 * has not followed the newest Avoid and Do points in use: planned before
 * them and not rewritten (beyond its empty posts) since. A week with a
 * revision waiting is left to it, since that revision reads the notes too.
 * Facts and upcoming items never ask for a rewrite. The rewrite keeps every
 * post a person worked on (runWeek.ts runWeekRevise), and a revision with no
 * person never teaches the memory.
 */
async function askForRewrites(admin: Db, client: Client, today: string): Promise<string[]> {
  const rows = await readNoteRows(admin, client.id);
  const rules = pointsInUse(rows.notes, rows.points, rows.links, today).filter((p) => p.kind === "avoid" || p.kind === "do");
  if (!rules.length) return [];
  const newest = Math.max(...rules.map((r) => Date.parse(r.created_at)));
  const plans = await must<Array<Record<string, unknown>> | null>(admin.from("calendar_plans").select("id, week_start, ready_at, pending_revision, revisions")
    .eq("client_id", client.id).eq("status", "ready").gte("week_start", addDays(today, -6)).order("week_start", { ascending: true }), "Could not read the planned weeks");
  const asked: string[] = [];
  for (const plan of plans ?? []) {
    if (plan.pending_revision) continue;
    const revisions = (Array.isArray(plan.revisions) ? plan.revisions : []) as Array<Record<string, unknown>>;
    const followed = Math.max(0, ...[plan.ready_at, ...revisions.filter((r) => r.scope !== "empty").map((r) => r.done_at ?? r.at)]
      .map((t) => Date.parse(String(t ?? ""))).filter(Number.isFinite));
    if (newest <= followed) continue;
    const { error } = await admin.rpc("calendar_request_revision", { p_plan: plan.id, p_note: rewriteNote(String(client.name)), p_user: null, p_scope: "untouched" });
    if (error) {
      // Someone asked for a revision meanwhile; it reads the notes too.
      console.warn(`[notes] no rewrite asked for ${plan.week_start}: ${error.message}`);
      continue;
    }
    asked.push(String(plan.week_start));
  }
  return asked;
}
