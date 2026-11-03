/**
 * The connector's reads of a client's calendar, content strategy and client
 * notes (two-way sync with Claude, docs/superpowers/specs/2026-11-03-claude-
 * sync-design.md). Every read goes through the person's own client, so RLS
 * answers as them: the calendar for anyone who sees the client, the strategy
 * and the notes for Moburst staff with access to it. For anyone else those
 * two read as not found, as a client out of scope does. Each strategy
 * section carries a version, the hash of its text, which a save from Claude
 * names so a section changed since is never overwritten.
 */
import { z } from "npm:zod@4.6.7";
import { ApiError } from "../_shared/api/errors.ts";
import { wordReason, type StoredReason } from "../_shared/calendar/reasonText.ts";
import { pointsInUse, pointStates, readNoteRows, selectForPrompt, todayIn, type LinkRow, type NoteRow, type PointRow } from "../_shared/notes/notes.ts";
import type { Person } from "./access.ts";
import { capItems } from "./limits.ts";
import { failure, type ToolResult } from "./tools.ts";

/** MCP tool annotations (specification 2025-11-25, ToolAnnotations). */
export interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface CalendarRow {
  post_key: string;
  post_date: string;
  posting_time: string | null;
  platform: string;
  format: string | null;
  pillar: string | null;
  copy: string | null;
  hashtags: string[] | null;
  cta: string | null;
  reasons: StoredReason[] | null;
  touched_at: string | null;
  updated_at: string;
}

export interface StrategyEditRow {
  section_key: string;
  text: string;
  editor_name: string;
  edited_at: string;
  source: string;
}

export interface WrittenPlatformRow {
  platform: string;
  key: string;
  state: string;
  handle: string | null;
  cadence: { per_week: number } | null;
  reason: string | null;
  [k: string]: unknown;
}

export interface StrategyRows {
  /** content_strategies; null, or written_at null, while there is no strategy yet. */
  /**
   * sections holds text per section (a strategy written on 2 Nov) or fields
   * per section (written as fields since 3 Nov); section_texts then holds
   * each section as the lines the Strategy page shows.
   */
  row: { written_at: string | null; sections: Record<string, unknown>; section_texts?: Record<string, string> | null; platforms: WrittenPlatformRow[]; pillars: Array<{ name: string }> } | null;
  edits: StrategyEditRow[];
}

type NoteListRow = NoteRow & { title: string; state: string; source: string; added_by_name: string | null; created_at: string; kind: string };

export interface NoteText {
  id: string;
  client_id: string;
  title: string;
  text: string | null;
  text_chars: number | null;
  note_date: string;
  source: string;
  added_by_name: string | null;
  created_at: string;
  state: string;
  kind: string;
}

/** What the reads ask the database, through the person's own client. */
export interface PersonReads {
  client(clientId: string): Promise<{ id: string; name: string; timezone: string | null; brand_notes: string | null } | null>;
  calendarPosts(clientId: string, from: string, to: string): Promise<CalendarRow[]>;
  /** calendar_post_worked, the app's own answer to whether someone worked on a post. */
  worked(clientId: string, post: CalendarRow): Promise<boolean>;
  strategy(clientId: string): Promise<StrategyRows>;
  notes(clientId: string): Promise<{ notes: NoteListRow[]; points: Array<PointRow & { part?: number }>; links: LinkRow[] }>;
  note(noteId: string): Promise<NoteText | null>;
}

export interface ReadSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: Annotations;
  /** Listed for admins and Moburst staff only. */
  staffOnly: boolean;
  run(args: Record<string, unknown>, at: ReadAt): Promise<unknown>;
}

interface ReadAt { person: Person; reads: PersonReads; now: Date }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CLIENT = "No client with that id among the clients you can see.";
const FIND_CLIENT = "Call socialytics_clients_list first to find the client id.";
const STAFF = "For Moburst staff.";
/** The longest window of calendar posts one call reads. */
export const CALENDAR_MAX_DAYS = 92;
const CALENDAR_DEFAULT_DAYS = 28;
/** The most of one note's text one answer carries, so it stays under the result cap. */
export const NOTE_TEXT_SHOWN = 90_000;

const dayRe = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The client, when the person can see it and, for a staff-only read, is staff. Else not found. */
async function clientFor(args: Record<string, unknown>, at: ReadAt, staffOnly: boolean) {
  const id = String(args.client_id ?? "");
  if (!UUID.test(id) || !at.person.scope.allows(id) || (staffOnly && at.person.role === "client")) throw new ApiError(404, "not_found", NO_CLIENT);
  const client = await at.reads.client(id);
  if (!client) throw new ApiError(404, "not_found", NO_CLIENT);
  return client;
}

/** A section's version: the first 16 hex digits of the SHA-256 of its text as shown. */
export async function sectionVersion(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
  return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

const FIXED_TITLES: Record<string, string> = { goals: "Goals", audience: "Audience", positioning: "Positioning", not_now: "Not now", avoid: "What to avoid", measures: "Measures" };

/** A strategy section as the Strategy page shows it: a person's version where one exists, else the product's. */
export interface ShownSection {
  key: string;
  title: string;
  text: string;
  product: string;
  edit: StrategyEditRow | null;
}

/** The sections the Strategy page shows, in its order. None while there is no strategy. */
export function strategySections(rows: StrategyRows): ShownSection[] {
  const row = rows.row;
  if (!row?.written_at) return [];
  const sections = row.sections ?? {};
  const edits = new Map(rows.edits.map((e) => [e.section_key, e]));
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const live = platforms.filter((p) => p.state === "posting" || p.state === "new");
  const keyed: Array<[string, string]> = [
    ["goals", FIXED_TITLES.goals], ["audience", FIXED_TITLES.audience], ["positioning", FIXED_TITLES.positioning],
    ...(Array.isArray(row.pillars) ? row.pillars : []).map((p): [string, string] => [`pillar:${String(p.name ?? "").trim()}`, `Pillar: ${String(p.name ?? "").trim()}`]),
    ...live.map((p): [string, string] => [`platform:${p.key}:${p.state === "posting" ? "posting" : "new"}`, `${p.platform}, ${p.state === "posting" ? "posting now" : "new"}`]),
    ...(platforms.some((p) => p.state === "not_now") || edits.has("not_now") || sections.not_now ? [["not_now", FIXED_TITLES.not_now] as [string, string]] : []),
    ["avoid", FIXED_TITLES.avoid], ["measures", FIXED_TITLES.measures],
  ];
  const seen = new Set<string>();
  const out: ShownSection[] = [];
  for (const [key, title] of keyed) {
    if (seen.has(key)) continue;
    seen.add(key);
    // The product's text as the page shows it, as strategy_section_save_as reads it for the version.
    const own = sections[key];
    const product = typeof own === "string" ? own : String(row.section_texts?.[key] ?? "");
    const edit = edits.get(key) ?? null;
    out.push({ key, title, text: edit?.text ?? product, product, edit });
  }
  return out;
}

function noteState(state: string, points: number): string {
  if (state === "reading") return "Reading";
  if (state === "learned" && points > 0) return `${points} point${points === 1 ? "" : "s"} learned`;
  return "Nothing in this note for the copy";
}
const STATE_WORDS: Record<string, string> = { reading: "Reading", learned: "Learned", nothing: "Nothing in this note for the copy" };
const from = (source: string) => (source === "claude" ? "Claude" : "Socialytics");

const id = (what: string) => z.string().describe(what);
const day = (what: string) => z.string().optional().describe(`${what} (yyyy-mm-dd).`);

export const READ_TOOLS: ReadSpec[] = [
  {
    name: "socialytics_calendar_posts", title: "Get a client's calendar posts",
    description: `The posts on a client's content calendar from one day to another (by default the client's today to 28 days ahead, at most 92 days), by date: each post's key, date, time, platform, format, pillar, copy, hashtags, call to action, why it is planned, whether someone has worked on it, and updated_at. ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id."), from: day("First day"), to: day("Last day") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    staffOnly: false,
    run: async (a, at) => {
      const client = await clientFor(a, at, false);
      const f = typeof a.from === "string" && a.from ? a.from : undefined, t = typeof a.to === "string" && a.to ? a.to : undefined;
      if ((f && !dayRe.test(f)) || (t && !dayRe.test(t))) throw new ApiError(400, "invalid_request", "From and to must be yyyy-mm-dd");
      const start = f ?? (t ? addDays(t, -CALENDAR_DEFAULT_DAYS) : todayIn(String(client.timezone || "UTC"), at.now));
      const end = t ?? addDays(start, CALENDAR_DEFAULT_DAYS);
      if (start > end) throw new ApiError(400, "invalid_request", "From must be on or before to");
      if (daysBetween(start, end) > CALENDAR_MAX_DAYS) throw new ApiError(400, "invalid_request", `Ask for at most ${CALENDAR_MAX_DAYS} days at a time`);
      const rows = await at.reads.calendarPosts(client.id, start, end);
      const worked = await Promise.all(rows.map((p) => at.reads.worked(client.id, p)));
      const posts = rows.map((p, i) => ({
        post_key: p.post_key, date: p.post_date, time: p.posting_time ?? null, platform: p.platform, format: p.format ?? null, pillar: p.pillar ?? null,
        copy: p.copy ?? "", hashtags: Array.isArray(p.hashtags) ? p.hashtags : [], cta: p.cta ?? null,
        why: (Array.isArray(p.reasons) && p.reasons[0] ? wordReason(p.reasons[0]) || String(p.reasons[0].label ?? "") : ""),
        worked_on: worked[i], updated_at: p.updated_at,
      }));
      const { kept, omitted } = capItems(posts, (k) => ({ data: { from: start, to: end, posts: k }, omitted_posts: posts.length }));
      return omitted ? { data: { from: start, to: end, posts: kept }, omitted_posts: omitted } : { data: { from: start, to: end, posts } };
    },
  },
  {
    name: "socialytics_strategy_get", title: "Get a client's content strategy",
    description: `A client's content strategy as the Strategy page shows it: when it was written, each section (goals, audience, positioning, each pillar, each platform, not now, what to avoid, measures) with its key, title and text, who edited it and when where a person did, whether that edit came from Claude, and its version; and each platform's state. ${STAFF} ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    staffOnly: true,
    run: async (a, at) => {
      const client = await clientFor(a, at, true);
      const rows = await at.reads.strategy(client.id);
      const shown = strategySections(rows);
      if (!shown.length) return { data: { written_at: null, sections: [], platforms: [] } };
      const sections = await Promise.all(shown.map(async (s) => ({
        key: s.key, title: s.title, text: s.text, edited_by: s.edit?.editor_name || null, edited_at: s.edit?.edited_at ?? null, from_claude: s.edit?.source === "claude", version: await sectionVersion(s.text),
      })));
      const platforms = (rows.row!.platforms ?? []).map((p) => ({ platform: p.platform, state: p.state, handle: p.handle ?? null, posts_per_week: p.cadence?.per_week ?? null, reason: p.reason ?? null }));
      return { data: { written_at: rows.row!.written_at, sections, platforms } };
    },
  },
  {
    name: "socialytics_client_notes", title: "Get a client's notes",
    description: `What a client told the team, as Socialytics keeps it: the team's standing notes; the points every post for the client follows now (things to avoid, things to do, what is coming up and facts, each with its date and platform); and the notes, newest first, each with its id, title, date, who added it, whether it came from Claude or Socialytics, and where its reading stands. With note_id, that note's text. ${STAFF} ${FIND_CLIENT}`,
    inputSchema: z.object({ client_id: id("The client id."), note_id: z.string().optional().describe("One note's id, for its text.") }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    staffOnly: true,
    run: async (a, at) => {
      const client = await clientFor(a, at, true);
      if (typeof a.note_id === "string" && a.note_id) {
        const note = await at.reads.note(a.note_id);
        if (!note || note.client_id !== client.id) throw new ApiError(404, "not_found", "No note with that id for this client");
        const text = String(note.text ?? "");
        const whole = Math.max(Number(note.text_chars) || 0, text.length);
        return {
          data: {
            note_id: note.id, title: note.title, date: note.note_date, added_by: note.added_by_name ?? null, from: from(note.source), state: STATE_WORDS[note.state] ?? "Reading",
            text: text.length > NOTE_TEXT_SHOWN ? text.slice(0, NOTE_TEXT_SHOWN) : text,
            ...(whole > NOTE_TEXT_SHOWN || whole > text.length ? { text_chars: whole } : {}),
          },
        };
      }
      const today = todayIn(String(client.timezone || "UTC"), at.now);
      const { notes, points, links } = await at.reads.notes(client.id);
      const states = pointStates(notes, points, links, today);
      const chosen = selectForPrompt({ points: pointsInUse(notes, points, links, today), standing: client.brand_notes, today });
      const list = [...notes].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).map((n) => ({
        note_id: n.id, title: n.title, date: n.note_date, added_by: n.added_by_name ?? null, added_on: n.created_at, from: from(n.source),
        state: noteState(n.state, points.filter((p) => p.note_id === n.id && states.has(p.id)).length),
      }));
      const head = { standing_notes: chosen.standing, points: chosen.points.map((p) => ({ kind: p.kind, text: p.text, platform: p.platform ?? null, date: p.date, until: p.until ?? null })) };
      const { kept, omitted } = capItems(list, (k) => ({ data: { ...head, notes: k }, omitted_notes: list.length }));
      return omitted ? { data: { ...head, notes: kept }, omitted_notes: omitted } : { data: { ...head, notes: list } };
    },
  },
];

/** Runs one read tool for a person. The arguments were checked against the tool's schema by the SDK. */
export async function runRead(name: string, args: Record<string, unknown>, person: Person, reads: PersonReads, requestId: string, now = new Date()): Promise<ToolResult> {
  const tool = READ_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, status: 404, code: "not_found", text: "There is no such Socialytics tool." };
  try {
    const body = await tool.run(args, { person, reads, now });
    return { ok: true, status: 200, body, text: JSON.stringify(body) };
  } catch (e) {
    return failure(e, name, requestId);
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

const CALENDAR_COLUMNS = "post_key, post_date, posting_time, platform, format, pillar, copy, hashtags, cta, reasons, touched_at, updated_at";

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

/** PersonReads over the person's own client: RLS answers every read as them. */
export function personReads(db: Db): PersonReads {
  return {
    client: async (clientId) => must(db.from("clients").select("id, name, timezone, brand_notes").eq("id", clientId).maybeSingle()),
    calendarPosts: async (clientId, start, end) => (await must<CalendarRow[] | null>(db.from("calendar_posts").select(CALENDAR_COLUMNS).eq("client_id", clientId)
      .gte("post_date", start).lte("post_date", end).order("post_date", { ascending: true }).order("posting_time", { ascending: true }).limit(1000))) ?? [],
    worked: async (clientId, p) => !!(await must(db.rpc("calendar_post_worked", { p_client: clientId, p_key: p.post_key, p_platform: p.platform, p_copy: p.copy ?? "", p_touched: p.touched_at }))),
    strategy: async (clientId) => {
      const [row, edits] = await Promise.all([
        must<StrategyRows["row"]>(db.from("content_strategies").select("written_at, sections, section_texts, platforms, pillars").eq("client_id", clientId).maybeSingle()),
        must<StrategyEditRow[] | null>(db.from("content_strategy_edits").select("section_key, text, editor_name, edited_at, source").eq("client_id", clientId)),
      ]);
      return { row: row ?? null, edits: edits ?? [] };
    },
    notes: async (clientId) => (await readNoteRows(db, clientId)) as unknown as Awaited<ReturnType<PersonReads["notes"]>>,
    note: async (noteId) => (UUID.test(noteId)
      ? must(db.from("client_notes").select("id, client_id, title, text, text_chars, note_date, source, added_by_name, created_at, state, kind").eq("id", noteId).maybeSingle())
      : null),
  };
}
