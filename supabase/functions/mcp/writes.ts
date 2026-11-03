/**
 * The connector's saves: the only module of the connector that writes (two-
 * way sync with Claude, docs/superpowers/specs/2026-11-03-claude-sync-
 * design.md). The database guards stay as built: the person's OAuth session
 * writes nothing anywhere. A save runs here, through the service role, after
 * these checks in order:
 *   1. the token verified and the person was admitted (server.ts, access.ts);
 *   2. the person holds admin or moburst_user, and is_moburst_staff() and
 *      can_write_client(client_id) answer true when called as the person
 *      (both reads an OAuth session may call), so removing access cuts saves
 *      at the next call;
 *   3. client_name is the id's client, ignoring case, and the post, section
 *      or report belongs to that client; a copy or strategy save names the
 *      version it read, and the database writes it only while that version
 *      is still current (saveCopy's conditional update, and
 *      strategy_section_save_as's check under the section's lock);
 *   4. at most 200 saves per client in 24 hours, counted from the audit rows
 *      (the 120 calls a minute per person apply before this).
 * Each save then runs the code the app runs (_shared/notes/add.ts,
 * _shared/calendar/saveCopy.ts, strategy_section_save_as), names the person
 * and source 'claude' on the row, and names what it wrote in the result's
 * target for the audit row, never the text. Nothing here deletes. A refusal
 * is one plain sentence; a stale save also carries the current text.
 */
import { z } from "npm:zod@4.6.7";
import { ApiError } from "../_shared/api/errors.ts";
import { copyWrites, saveCopy, type CopyMemory, type CopyWrites } from "../_shared/calendar/saveCopy.ts";
import { addTextNote, noteWrites, type NoteWrites } from "../_shared/notes/add.ts";
import { NOTE_TEXT_MAX } from "../_shared/notes/notes.ts";
import { learnFromSignal } from "../_shared/voice/load.ts";
import type { LearnedChange, MemorySignal } from "../_shared/voice/voice.ts";
import type { Person } from "./access.ts";
import { sectionVersion, strategySections, type Annotations, type StrategyRows } from "./reads.ts";
import { failure, sentence, type ToolResult } from "./tools.ts";

export const WRITES_PER_CLIENT_PER_DAY = 200;
export const DECK_UPLOAD_HOURS = 2;
export const DECKS_BUCKET = "report-decks";
const STRATEGY_TEXT_MAX = 20_000;
const DECK_TITLE_MAX = 200;

/** The person's own answers, through their own client: read functions an OAuth session may call. */
export interface PersonChecks {
  isStaff(): Promise<boolean>;
  canWrite(clientId: string): Promise<boolean>;
}

export interface DeckRow {
  id: string;
  client_id: string;
  report_id: string | null;
  competitive_report_id: string | null;
  title: string;
  kind: "pptx" | "pdf" | "link";
  file_path: string | null;
  link: string | null;
  source: "claude";
  added_by: string;
  added_by_name: string | null;
  created_at?: string;
}

/** Everything a save reads and writes through the service role. Made only by makeServiceWriter, from index.ts. */
export interface ServiceWriter {
  client(clientId: string): Promise<{ id: string; name: string } | null>;
  /** The client's connector writes (audit rows with a target) since then. */
  writesSince(clientId: string, since: Date): Promise<number>;
  notes: NoteWrites;
  copy: CopyWrites;
  /** Teaches the client's preference memory from a copy edit, as the app's save does. */
  learn(clientId: string, signal: MemorySignal): Promise<{ changes: LearnedChange[] }>;
  strategy(clientId: string): Promise<StrategyRows>;
  /**
   * strategy_section_save_as for the person, from Claude, only while the
   * section's version is still `expected`: checked and written in one call
   * under the section's lock. Otherwise the section as it is now.
   */
  saveSection(userId: string, clientId: string, key: string, text: string, expected: string): Promise<{ saved: true } | { conflict: { text: string; version: string } }>;
  report(reportId: string): Promise<{ id: string; client_id: string; kind: "social" | "competitive" } | null>;
  /** A signed URL that puts one file at this path in the decks bucket, for two hours. */
  signUpload(path: string): Promise<string>;
  /** The name of the deck's file in the folder, once it has arrived; null before. */
  deckFile(folder: string, deckId: string): Promise<string | null>;
  deck(id: string): Promise<DeckRow | null>;
  saveDeck(row: DeckRow): Promise<{ added: boolean; deck: DeckRow }>;
}

export interface WriteDeps {
  person: PersonChecks;
  writer: ServiceWriter;
  now?(): Date;
  waitUntil?(p: Promise<unknown>): void;
}

interface SaveAt {
  person: Person;
  deps: WriteDeps;
  client: { id: string; name: string };
  now: Date;
}

export interface WriteSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: Annotations;
  run(args: Record<string, unknown>, at: SaveAt): Promise<ToolResult>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_CLIENT = "No client with that id among the clients you can see.";
const STAFF_ONLY = "Saving to Socialytics from Claude is for Moburst staff.";
const NO_REPORT = "No report with that id for this client.";
const MIME = { pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", pdf: "application/pdf" } as const;

const sameName = (a: unknown, b: unknown) => String(a ?? "").replace(/\s+/g, " ").trim().toLowerCase() === String(b ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const onDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
const already = (iso: string, name: string | null) => `Already saved on ${onDay(iso)} by ${String(name ?? "").trim() || "the team"}.`;
const saved = (body: Record<string, unknown>, target: string): ToolResult => ({ ok: true, status: 200, body, text: JSON.stringify(body), target });
const answered = (body: Record<string, unknown>): ToolResult => ({ ok: true, status: 200, body, text: JSON.stringify(body) });
const refused = (status: number, code: string, text: string): ToolResult => ({ ok: false, status, code, text: sentence(text) });
/** A save refused because its target changed since Claude read it: the sentence, then the target as it is now. */
const stale = (text: string, current: Record<string, unknown>): ToolResult => ({ ok: false, status: 409, code: "conflict", text: `${sentence(text)}\n${JSON.stringify({ current })}` });

/** A single-quoted word for a POSIX shell. */
const shellWord = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A link deck's id: made from the report and the link, so saving it again finds the same row. */
export async function deckIdForLink(reportId: string, link: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${reportId}|${link}`)));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50; // name-based, as a version 5 id is
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The report, when it is the client's. */
async function reportOf(args: Record<string, unknown>, at: SaveAt) {
  const id = String(args.report_id ?? "");
  const report = UUID.test(id) ? await at.deps.writer.report(id) : null;
  return report && report.client_id === at.client.id ? report : null;
}

const clientId = z.string().describe("The client id, from the project instruction or socialytics_clients_list.");
const clientName = z.string().describe("The client's name as Socialytics has it, to confirm the id. Case does not matter.");
const reportId = z.string().describe("The id of the client's social report (socialytics_reports_list) or competitive report (socialytics_competitive_reports_list).");
const SAME_CLIENT = "client_id and client_name must name the same client.";
const STAFF = "For Moburst staff, on clients they can change in Socialytics.";

export const WRITE_TOOLS: WriteSpec[] = [
  {
    name: "socialytics_note_save", title: "Save a client note to Socialytics",
    description: `Adds one note to a client's notes in Socialytics: client feedback, a meeting note or an instruction from the client, with the date it was said. Socialytics reads it into the points every post written for the client follows, as it does notes added in the app. The same text saved again adds nothing and answers who saved it and when. Text up to 20,000 characters. ${SAME_CLIENT} ${STAFF}`,
    inputSchema: z.object({
      client_id: clientId, client_name: clientName,
      text: z.string().describe("The note's full text, up to 20,000 characters."),
      title: z.string().optional().describe("A title, such as the file's name. Defaults to the text's first line."),
      date: z.string().optional().describe("The day it was said or written (yyyy-mm-dd), no later than tomorrow. Defaults to today."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (a, at) => {
      if (String(a.text ?? "").trim().length > NOTE_TEXT_MAX) return refused(400, "invalid_request", `A note holds at most ${NOTE_TEXT_MAX.toLocaleString("en-US")} characters`);
      const r = await addTextNote(at.deps.writer.notes, { clientId: at.client.id, text: a.text, title: a.title, date: a.date, source: "claude", userId: at.person.userId, now: at.now });
      if (!r.ok) return refused(r.status, r.status === 404 ? "not_found" : "invalid_request", r.error === "text is required." ? "The note is empty" : r.error === "date must be a day no later than tomorrow (YYYY-MM-DD)." ? "The date must be a real day, no later than tomorrow, as yyyy-mm-dd" : r.error);
      const note = r.note!;
      if (!r.added) return answered({ status: "already_saved", note_id: note.id, title: note.title, message: already(note.created_at, note.added_by_name) });
      return saved({ status: "saved", note_id: note.id, title: note.title, date: note.note_date, message: `Saved to ${at.client.name}'s notes. Socialytics reads it next, and the copy follows what it says.` }, note.id);
    },
  },
  {
    name: "socialytics_post_copy_save", title: "Save a calendar post's copy to Socialytics",
    description: `Saves new copy for one post on a client's content calendar, as the calendar's Save does: the copy, and its hashtags and call to action when given. The weekly revisions then keep the post as it is. based_on is the post's updated_at from socialytics_calendar_posts; if the post changed after that, nothing is saved and the current copy comes back. Copy equal to what is saved changes nothing. ${SAME_CLIENT} ${STAFF}`,
    inputSchema: z.object({
      client_id: clientId, client_name: clientName,
      post_key: z.string().describe("The post's key, from socialytics_calendar_posts."),
      copy: z.string().describe("The copy, up to 10,000 characters."),
      hashtags: z.array(z.string()).optional().describe("The post's hashtags, up to 30. Leave out to keep the post's own."),
      cta: z.string().optional().describe("The call to action. Leave out to keep the post's own."),
      based_on: z.string().describe("The post's updated_at, as socialytics_calendar_posts gave it."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (a, at) => {
      const key = String(a.post_key ?? "");
      const memory: CopyMemory = {
        learn: (signal) => at.deps.writer.learn(at.client.id, signal),
        background: (work, label) => {
          const p = work.catch((e) => console.warn(`mcp ${label}:`, e instanceof Error ? e.message : String(e)));
          at.deps.waitUntil?.(p);
        },
      };
      const r = await saveCopy(at.deps.writer.copy, { clientId: at.client.id, key, copy: a.copy, hashtags: a.hashtags, cta: a.cta, source: "claude", userId: at.person.userId, now: at.now, basedOn: a.based_on }, memory);
      if (!r.ok && r.status === 409 && r.current) {
        return stale("This post changed in Socialytics after you read it. Show the person the copy below and ask again", { post_key: key, copy: r.current.copy, hashtags: r.current.hashtags ?? [], cta: r.current.cta, updated_at: r.current.updated_at });
      }
      if (!r.ok) return refused(r.status, r.status === 404 ? "not_found" : "invalid_request", r.error);
      if (!r.changed) return answered({ status: "unchanged", post_key: key, updated_at: r.updatedAt, message: "This copy is already on the post. Nothing changed." });
      return saved({ status: "saved", post_key: key, updated_at: r.updatedAt, message: `Saved to the post on ${at.client.name}'s calendar.` }, key);
    },
  },
  {
    name: "socialytics_strategy_section_save", title: "Save a strategy section to Socialytics",
    description: `Saves a person's version of one section of a client's content strategy, as editing it on the Strategy page does; the strategy's rewrites keep it. section_key and based_on (the section's version) come from socialytics_strategy_get; if the section changed after that, nothing is saved and the current text comes back. Text equal to the section's changes nothing, and empty text is refused. ${SAME_CLIENT} ${STAFF}`,
    inputSchema: z.object({
      client_id: clientId, client_name: clientName,
      section_key: z.string().describe("The section's key, from socialytics_strategy_get."),
      text: z.string().describe("The section's new text, up to 20,000 characters."),
      based_on: z.string().describe("The section's version, as socialytics_strategy_get gave it."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    run: async (a, at) => {
      const key = String(a.section_key ?? "").trim();
      const text = String(a.text ?? "").replace(/\r/g, "").trim();
      if (!text) return refused(400, "invalid_request", "A section can't be saved empty. To go back to Socialytics' own version, use the Strategy page");
      if (text.length > STRATEGY_TEXT_MAX) return refused(400, "invalid_request", `A section holds at most ${STRATEGY_TEXT_MAX.toLocaleString("en-US")} characters`);
      const sections = strategySections(await at.deps.writer.strategy(at.client.id));
      if (!sections.length) return refused(404, "not_found", "This client has no strategy yet");
      const section = sections.find((s) => s.key === key);
      if (!section) return refused(404, "not_found", "No section with that key in this client's strategy");
      const version = await sectionVersion(section.text);
      if (text === section.text.trim()) return answered({ status: "unchanged", section_key: key, version, message: "The section already says this. Nothing changed." });
      if (String(a.based_on ?? "").trim() !== version) {
        return stale("This section changed in Socialytics after you read it. Show the person the text below and ask again", { section_key: key, text: section.text, version });
      }
      // Handing a section back to the product stays on the Strategy page.
      if (text === section.product.trim()) return refused(400, "invalid_request", "That is Socialytics' own version of this section. To go back to it, use the Strategy page");
      const written = await at.deps.writer.saveSection(at.person.userId, at.client.id, key, text, version);
      if ("conflict" in written) {
        return stale("This section changed in Socialytics after you read it. Show the person the text below and ask again", { section_key: key, text: written.conflict.text, version: written.conflict.version });
      }
      return saved({ status: "saved", section_key: key, version: await sectionVersion(text), message: `Saved as your version of this section of ${at.client.name}'s strategy.` }, key);
    },
  },
  {
    name: "socialytics_report_deck_upload", title: "Start attaching a deck to a report",
    description: `Starts attaching a finished deck file (.pptx or .pdf, up to 50 MB) to a client's social or competitive report: returns a deck id and a one-time upload command for the file, valid for two hours. The deck shows on the report once socialytics_report_deck_save is called with that deck id. ${SAME_CLIENT} ${STAFF}`,
    inputSchema: z.object({
      client_id: clientId, client_name: clientName, report_id: reportId,
      file_name: z.string().describe("The deck file's name or path, ending in .pptx or .pdf."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (a, at) => {
      const file = String(a.file_name ?? "").trim();
      const ext = /\.(pptx|pdf)$/i.exec(file)?.[1]?.toLowerCase() as keyof typeof MIME | undefined;
      if (!ext) return refused(400, "invalid_request", "Only a .pptx or .pdf file can be attached");
      const report = await reportOf(a, at);
      if (!report) return refused(404, "not_found", NO_REPORT);
      const deckId = crypto.randomUUID();
      const url = await at.deps.writer.signUpload(`${at.client.id}/${report.id}/${deckId}.${ext}`);
      return saved({
        deck_id: deckId,
        upload_command: `curl -sS -f -X PUT -H ${shellWord(`Content-Type: ${MIME[ext]}`)} --data-binary @${shellWord(file)} ${shellWord(url)}`,
        expires_in_hours: DECK_UPLOAD_HOURS,
        message: "Run upload_command where the file is, then call socialytics_report_deck_save with this deck_id.",
      }, deckId);
    },
  },
  {
    name: "socialytics_report_deck_save", title: "Attach a deck to a report",
    description: `Lists a finished deck on a client's social or competitive report, where anyone who can see the report, the client included, can open it. Give deck_id once its file was uploaded with the command from socialytics_report_deck_upload, or link for a Google Slides or Drive link (https). Saving the same deck again adds nothing. ${SAME_CLIENT} ${STAFF}`,
    inputSchema: z.object({
      client_id: clientId, client_name: clientName, report_id: reportId,
      title: z.string().describe("The deck's title, as people should see it on the report."),
      deck_id: z.string().optional().describe("The deck id from socialytics_report_deck_upload."),
      link: z.string().optional().describe("A Google Slides or Drive link (https), instead of a deck id."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (a, at) => {
      const title = String(a.title ?? "").replace(/\s+/g, " ").trim();
      const deckId = typeof a.deck_id === "string" ? a.deck_id.trim() : "";
      const link = typeof a.link === "string" ? a.link.trim() : "";
      if (deckId && link) return refused(400, "invalid_request", "Give either deck_id or link, not both");
      if (!deckId && !link) return refused(400, "invalid_request", "Give the deck_id from the upload, or a link");
      if (!title) return refused(400, "invalid_request", "The deck needs a title");
      if (title.length > DECK_TITLE_MAX) return refused(400, "invalid_request", `A deck title holds at most ${DECK_TITLE_MAX} characters`);
      let url: URL | null = null;
      if (link) {
        try { url = new URL(link); } catch { url = null; }
        if (!url || url.protocol !== "https:" || !/^https:\/\//i.test(link) || link.length > 2000) return refused(400, "invalid_request", "The link must be an https address");
      }
      if (deckId && !UUID.test(deckId)) return refused(404, "not_found", "No deck with that id");
      const report = await reportOf(a, at);
      if (!report) return refused(404, "not_found", NO_REPORT);
      const base = {
        client_id: at.client.id, report_id: report.kind === "social" ? report.id : null, competitive_report_id: report.kind === "competitive" ? report.id : null,
        title, source: "claude" as const, added_by: at.person.userId, added_by_name: await at.deps.writer.notes.authorName(at.person.userId),
      };
      let row: DeckRow;
      if (deckId) {
        const folder = `${at.client.id}/${report.id}`;
        const name = await at.deps.writer.deckFile(folder, deckId);
        if (!name) return refused(409, "not_ready", "The deck's file has not arrived yet. Run the upload command, then save again");
        const kind = /\.pdf$/i.test(name) ? "pdf" : "pptx";
        row = { ...base, id: deckId, kind, file_path: `${folder}/${name}`, link: null };
      } else {
        row = { ...base, id: await deckIdForLink(report.id, link), kind: "link", file_path: null, link };
      }
      const r = await at.deps.writer.saveDeck(row);
      if (!r.added) return answered({ status: "already_saved", deck_id: r.deck.id, message: already(String(r.deck.created_at ?? ""), r.deck.added_by_name) });
      return saved({ status: "saved", deck_id: row.id, title, message: `Attached to ${at.client.name}'s ${report.kind === "social" ? "social" : "competitive"} report. Anyone who can see the report can open it.` }, row.id);
    },
  },
];

/** Runs one save for a person, after the checks every save shares. The arguments were checked against the tool's schema by the SDK. */
export async function runWrite(name: string, args: Record<string, unknown>, person: Person, deps: WriteDeps, requestId: string): Promise<ToolResult> {
  const tool = WRITE_TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, status: 404, code: "not_found", text: "There is no such Socialytics tool." };
  try {
    if (person.role !== "admin" && person.role !== "moburst_user") return refused(403, "forbidden", STAFF_ONLY);
    const id = String(args.client_id ?? "");
    if (!UUID.test(id)) return refused(404, "not_found", NO_CLIENT);
    if (!(await deps.person.isStaff())) return refused(403, "forbidden", STAFF_ONLY);
    if (!(await deps.person.canWrite(id))) return refused(404, "not_found", NO_CLIENT);
    const client = await deps.writer.client(id);
    if (!client) return refused(404, "not_found", NO_CLIENT);
    if (!sameName(args.client_name, client.name)) {
      return refused(400, "invalid_request", `That client id is not ${String(args.client_name ?? "").replace(/\s+/g, " ").trim() || "the client named"}'s. Find the client's id with socialytics_clients_list and save again`);
    }
    const now = deps.now?.() ?? new Date();
    if ((await deps.writer.writesSince(client.id, new Date(now.getTime() - 86_400_000))) >= WRITES_PER_CLIENT_PER_DAY) {
      return refused(429, "rate_limited", `${client.name} has had ${WRITES_PER_CLIENT_PER_DAY} saves from Claude in the last 24 hours. Try again tomorrow`);
    }
    return await tool.run(args, { person, deps, client, now });
  } catch (e) {
    if (e instanceof ApiError) return failure(e, name, requestId);
    console.error(`mcp ${name} failed (request ${requestId}):`, e instanceof Error ? e.message : String(e));
    return { ok: false, status: 500, code: "internal", text: "Socialytics could not save this just now." };
  }
}

// deno-lint-ignore no-explicit-any
type Db = any;

const DECK_COLUMNS = "id, client_id, report_id, competitive_report_id, title, kind, file_path, link, source, added_by, added_by_name, created_at";

async function must<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

/** The person's own answers, through the person's own client (RLS and auth.uid() as them). */
export function personChecks(db: Db): PersonChecks {
  return {
    isStaff: async () => (await must<boolean | null>(db.rpc("is_moburst_staff"), "Could not check the role")) === true,
    canWrite: async (clientId) => (await must<boolean | null>(db.rpc("can_write_client", { _client_id: clientId }), "Could not check access")) === true,
  };
}

/** The service writer over the service-role client. index.ts makes the one instance; nothing else in the connector holds that client. */
export function makeServiceWriter(db: Db): ServiceWriter {
  const notes = noteWrites(db);
  const deck = async (id: string) => must<DeckRow | null>(db.from("report_decks").select(DECK_COLUMNS).eq("id", id).maybeSingle(), "Could not read the deck");
  return {
    client: async (id) => must(db.from("clients").select("id, name").eq("id", id).maybeSingle(), "Could not read the client"),
    writesSince: async (clientId, since) => {
      const { count, error } = await db.from("api_requests").select("id", { count: "exact", head: true })
        .eq("client_id", clientId).eq("method", "MCP").not("target", "is", null).gte("created_at", since.toISOString());
      if (error) throw new Error(`Could not count the saves: ${error.message}`);
      return Number(count) || 0;
    },
    notes,
    copy: copyWrites(db),
    learn: (clientId, signal) => learnFromSignal(db, clientId, signal),
    strategy: async (clientId) => {
      const [row, edits] = await Promise.all([
        must<StrategyRows["row"]>(db.from("content_strategies").select("written_at, sections, section_texts, platforms, pillars").eq("client_id", clientId).maybeSingle(), "Could not read the strategy"),
        must<StrategyRows["edits"] | null>(db.from("content_strategy_edits").select("section_key, text, editor_name, edited_at, source").eq("client_id", clientId), "Could not read the strategy"),
      ]);
      return { row: row ?? null, edits: edits ?? [] };
    },
    saveSection: async (userId, clientId, key, text, expected) => {
      const answer = await must<{ conflict?: boolean; text?: string; version?: string } | null>(
        db.rpc("strategy_section_save_as", { p_user: userId, p_client: clientId, p_key: key, p_text: text, p_source: "claude", p_expected: expected }),
        "Could not save the section",
      );
      return answer?.conflict ? { conflict: { text: String(answer.text ?? ""), version: String(answer.version ?? "") } } : { saved: true as const };
    },
    report: async (id) => {
      const social = await must<{ id: string; client_id: string } | null>(db.from("reports").select("id, client_id").eq("id", id).maybeSingle(), "Could not read the report");
      if (social) return { id: social.id, client_id: social.client_id, kind: "social" };
      const competitive = await must<{ id: string; client_id: string } | null>(db.from("competitive_reports").select("id, client_id").eq("id", id).maybeSingle(), "Could not read the report");
      return competitive ? { id: competitive.id, client_id: competitive.client_id, kind: "competitive" } : null;
    },
    signUpload: async (path) => {
      const { data, error } = await db.storage.from(DECKS_BUCKET).createSignedUploadUrl(path);
      if (error || !data?.signedUrl) throw new Error(`Could not sign the upload: ${error?.message ?? "no URL"}`);
      return String(data.signedUrl);
    },
    deckFile: async (folder, deckId) => {
      const { data, error } = await db.storage.from(DECKS_BUCKET).list(folder, { search: deckId, limit: 10 });
      if (error) throw new Error(`Could not look for the deck's file: ${error.message}`);
      const hit = ((data ?? []) as Array<{ name: string }>).find((f) => f.name === `${deckId}.pptx` || f.name === `${deckId}.pdf`);
      return hit?.name ?? null;
    },
    deck,
    saveDeck: async (row) => {
      const added = await must<DeckRow[] | null>(db.from("report_decks").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select(DECK_COLUMNS), "Could not save the deck");
      if (added?.length) return { added: true, deck: added[0] };
      const was = await deck(row.id);
      if (!was) throw new Error("Could not save the deck: no row");
      return { added: false, deck: was };
    },
  };
}
