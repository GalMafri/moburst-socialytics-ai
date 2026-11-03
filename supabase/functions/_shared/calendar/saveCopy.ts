// supabase/functions/_shared/calendar/saveCopy.ts
//
// Saving a calendar post's copy: the one path for the calendar's Save
// (calendar-posts save_copy) and for copy a person approves in Claude (the
// connector's socialytics_post_copy_save; docs/superpowers/specs/2026-11-03-
// claude-sync-design.md). A save writes a revision row (post_iterations,
// without media), puts the copy on the calendar post and marks it worked on
// (touched_at), so the week's revisions keep it; a person's edit teaches the
// client's preference memory.
//
// A save from Claude carries the updated_at Claude read. When the post
// changed since, it is refused with the copy as it is now, so Claude can
// show it and ask again; the post is written only while it still has the
// updated_at that was checked. Copy equal to what is stored changes nothing.

export type CopySource = "calendar" | "regeneration" | "claude";

/** A calendar post's copy as it is now. */
export interface CopyPost {
  copy: string;
  hashtags: string[] | null;
  cta: string | null;
  platform: string | null;
  updated_at: string;
}

/** A revision row (post_iterations) for a copy save. */
export interface IterationRow {
  client_id: string;
  report_id: string | null;
  calendar_post_key: string;
  version: number;
  platform: string | null;
  post_copy: string;
  hashtags: string[] | null;
  cta: string | null;
  concept: string | null;
  visual_direction: string | null;
  format: string | null;
  source: CopySource;
  created_by: string;
}

/** What a copy save reads and writes, through the service role. */
export interface CopyWrites {
  post(clientId: string, key: string): Promise<CopyPost | null>;
  /** The highest version among the post's revisions; 0 with none. */
  lastVersion(clientId: string, key: string): Promise<number>;
  insertIteration(row: IterationRow): Promise<void>;
  /** Writes the fields; with unchangedSince, only while updated_at is still that. The new updated_at, or null when no row was written. */
  updatePost(clientId: string, key: string, fields: Record<string, unknown>, unchangedSince?: string): Promise<string | null>;
}

/** What teaches the client's preference memory (_shared/voice learnFromSignal). */
export interface CopySignal {
  kind: "copy_edit";
  before: string;
  after: string;
  platform: string | null;
}

export interface SaveCopy {
  clientId: string;
  key: string;
  copy: unknown;
  hashtags?: unknown;
  cta?: unknown;
  reportId?: unknown;
  version?: unknown;
  platform?: unknown;
  concept?: unknown;
  visualDirection?: unknown;
  format?: unknown;
  source: CopySource;
  userId: string;
  now: Date;
  /** From Claude: the post's updated_at as Claude read it. */
  basedOn?: unknown;
}

export type SaveCopyResult =
  | { ok: true; changed: boolean; updatedAt: string | null }
  | { ok: false; status: 400 | 404 | 409; error: string; current?: CopyPost };

export const COPY_MAX = 10_000;
export const HASHTAGS_MAX = 30;
export const CTA_MAX = 300;

/** A timestamp as one comparable value, to the microsecond; null when it is not one. */
function instant(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(String(v ?? "").trim());
  if (!m) return null;
  const z = m[4];
  const zone = !z || z.toUpperCase() === "Z" ? "Z" : z.length === 3 ? `${z}:00` : z.includes(":") ? z : `${z.slice(0, 3)}:${z.slice(3)}`;
  const ms = Date.parse(`${m[1]}T${m[2]}${zone}`);
  if (!Number.isFinite(ms)) return null;
  return `${ms}.${(m[3] ?? "").padEnd(6, "0").slice(0, 6)}`;
}

/** True when two timestamps name the same instant, however their zone is written. */
export function sameInstant(a: unknown, b: unknown): boolean {
  const x = instant(a);
  return x !== null && x === instant(b);
}

const sameList = (a: string[] | null, b: string[] | null) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

export async function saveCopy(w: CopyWrites, a: SaveCopy, learn?: (signal: CopySignal) => void): Promise<SaveCopyResult> {
  const copy = String(a.copy ?? "").trim();
  if (a.source !== "claude") {
    // The calendar's Save, exactly as calendar-posts wrote it.
    if (!a.clientId || !a.key || !copy) return { ok: false, status: 400, error: "client_id, calendar_post_key and post_copy are required." };
    const hashtags = Array.isArray(a.hashtags) ? a.hashtags.map(String).slice(0, HASHTAGS_MAX) : null;
    const before = await w.post(a.clientId, a.key);
    await w.insertIteration({
      client_id: a.clientId, report_id: (a.reportId as string) || null, calendar_post_key: a.key,
      version: Number(a.version) || 1, platform: (a.platform as string) || null, post_copy: copy,
      hashtags, cta: (a.cta as string) || null, concept: (a.concept as string) || null, visual_direction: (a.visualDirection as string) || null,
      format: (a.format as string) || null, source: a.source === "regeneration" ? "regeneration" : "calendar", created_by: a.userId,
    });
    // The calendar post holds the current copy too, for every view that reads it directly.
    const updatedAt = await w.updatePost(a.clientId, a.key, { copy, touched_at: a.now.toISOString(), ...(hashtags ? { hashtags } : {}), ...(a.cta ? { cta: String(a.cta) } : {}) });
    // A person's edit says how they want copy written; a regeneration doesn't.
    const previous = String(before?.copy || "").trim();
    if (a.source !== "regeneration" && previous && previous !== copy) learn?.({ kind: "copy_edit", before: previous, after: copy, platform: before?.platform ?? ((a.platform as string) || null) });
    return { ok: true, changed: true, updatedAt };
  }

  if (!copy) return { ok: false, status: 400, error: "The copy is empty." };
  if (copy.length > COPY_MAX) return { ok: false, status: 400, error: `Copy holds at most ${COPY_MAX} characters.` };
  let hashtags: string[] | null = null;
  if (a.hashtags !== undefined && a.hashtags !== null) {
    if (!Array.isArray(a.hashtags) || a.hashtags.length > HASHTAGS_MAX || a.hashtags.some((h) => typeof h !== "string")) return { ok: false, status: 400, error: `hashtags must be a list of at most ${HASHTAGS_MAX} hashtags.` };
    hashtags = (a.hashtags as string[]).map((h) => h.trim()).filter(Boolean);
  }
  const cta = a.cta === undefined || a.cta === null ? null : String(a.cta).trim();
  if (cta && cta.length > CTA_MAX) return { ok: false, status: 400, error: `The call to action holds at most ${CTA_MAX} characters.` };
  if (!instant(a.basedOn)) return { ok: false, status: 400, error: "based_on must be the updated_at you read for this post." };

  const post = await w.post(a.clientId, a.key);
  if (!post) return { ok: false, status: 404, error: "No post with that key in this client's calendar." };
  const unchanged = String(post.copy ?? "").trim() === copy && (hashtags === null || sameList(hashtags, post.hashtags)) && (!cta || cta === (post.cta ?? ""));
  if (unchanged) return { ok: true, changed: false, updatedAt: post.updated_at };
  const stale = async (now?: CopyPost | null): Promise<SaveCopyResult> => {
    const current = now === undefined ? await w.post(a.clientId, a.key) : now;
    return current
      ? { ok: false, status: 409, error: "This post changed in Socialytics after you read it.", current }
      : { ok: false, status: 404, error: "No post with that key in this client's calendar." };
  };
  if (!sameInstant(a.basedOn, post.updated_at)) return stale(post);

  const fields = { copy, touched_at: a.now.toISOString(), ...(hashtags ? { hashtags } : {}), ...(cta ? { cta } : {}) };
  const updatedAt = await w.updatePost(a.clientId, a.key, fields, post.updated_at);
  if (!updatedAt) return stale();
  await w.insertIteration({
    client_id: a.clientId, report_id: null, calendar_post_key: a.key, version: (await w.lastVersion(a.clientId, a.key)) + 1,
    platform: post.platform, post_copy: copy, hashtags: hashtags ?? post.hashtags, cta: cta || post.cta, concept: null, visual_direction: null, format: null,
    source: "claude", created_by: a.userId,
  });
  const previous = String(post.copy ?? "").trim();
  if (previous && previous !== copy) learn?.({ kind: "copy_edit", before: previous, after: copy, platform: post.platform });
  return { ok: true, changed: true, updatedAt };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** CopyWrites over a service-role client. */
export function copyWrites(db: Db): CopyWrites {
  return {
    async post(clientId, key) {
      const { data } = await db.from("calendar_posts").select("copy, hashtags, cta, platform, updated_at").eq("client_id", clientId).eq("post_key", key).maybeSingle();
      return (data as CopyPost | null) ?? null;
    },
    async lastVersion(clientId, key) {
      const { data } = await db.from("post_iterations").select("version").eq("client_id", clientId).eq("calendar_post_key", key).order("version", { ascending: false }).limit(1);
      return Number((data as Array<{ version: number }> | null)?.[0]?.version) || 0;
    },
    async insertIteration(row) {
      const { error } = await db.from("post_iterations").insert(row);
      if (error) throw new Error(`Could not save the copy: ${error.message}`);
    },
    async updatePost(clientId, key, fields, unchangedSince) {
      let q = db.from("calendar_posts").update(fields).eq("client_id", clientId).eq("post_key", key);
      if (unchangedSince) q = q.eq("updated_at", unchangedSince);
      const { data } = await q.select("updated_at");
      return (data as Array<{ updated_at: string }> | null)?.[0]?.updated_at ?? null;
    },
  };
}
