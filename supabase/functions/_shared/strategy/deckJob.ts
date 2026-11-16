// supabase/functions/_shared/strategy/deckJob.ts
//
// One strategy_deck job (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
// design.md, section 4; Lital's answers of 3 Nov 2026): a new copy of the
// Moburst-branded template in ai@moburst.com's Drive, filled with the
// client's strategy, shared as editor with the person who asked (no Google
// email), and its link saved on the export. A deck is never rewritten after
// it is made.
//
//   1. An access token from the sign-in in Vault (google/oauth.ts).
//   2. The folder and the template: imported once from the repo's .pptx
//      (kept in the private strategy-decks bucket), with every text run's
//      weight set by name; imported again when the template's version moves.
//   3. The charts and the client's logo as images, stored privately and
//      handed to Slides as 10-minute signed links.
//   4. files.copy, presentations.get, one batchUpdate (deck.ts).
//   5. Every token must have been found, or the copy goes to the trash and
//      the job ends with a log line.
//   6. permissions.create for the person who asked, then the link is saved.
// Google not connected: the export ends at once, and the page says plainly
// that Google is not connected yet. Anything else is tried again quietly by
// the worker; the export is marked failed only when the tries run out.

import type { JobOutcome, ScheduledJob } from "../scheduled-jobs/types.ts";
import type { GoogleApi } from "../google/api.ts";
import { GoogleNotConnected } from "../google/oauth.ts";
import { copyFile, createFolder, fileAlive, importPptx, presentationUrl, shareAsEditor, trashFile } from "../google/drive.ts";
import { batchUpdate, getPresentation } from "../google/slides.ts";
import { deckName, deckRequests, findArchetypes, planDeck, unfilled, weightRequests, type Measure } from "./deck.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** The template's version: a new build of assets/strategy-deck/template.pptx gets a new one, and is imported again. */
export const TEMPLATE_VERSION = "strategy-v1";
export const DECK_BUCKET = "strategy-decks";
export const TEMPLATE_PATH = `template/${TEMPLATE_VERSION}.pptx`;
export const FOLDER_NAME = "Socialytics strategy decks";
/** Slides fetches an image once, at insertion; ten minutes is plenty. */
export const SIGNED_SECONDS = 600;

/** A logo past this size is not a logo; the cover then has no logo (its title already names the client). */
export const LOGO_MAX_BYTES = 5_000_000;
/** The width an SVG logo is drawn at: sharp on a slide, a small file. */
export const LOGO_PNG_WIDTH = 800;
/** PNG, JPEG, GIF or SVG, from the first bytes. */
export function imageType(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (/<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 16_384)))) return "image/svg+xml";
  return null;
}

/** A response's body, or null when it is over the cap: its own length is checked first, then the bytes as they stream in. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => null);
    return null;
  }
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.byteLength <= max ? all : null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

/** The client's logo from its address: https only, within the size cap, of a type the deck can use; null otherwise. */
export async function fetchLogo(url: string | null, doFetch: typeof fetch = fetch): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  const res = await doFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const bytes = await readCapped(res, LOGO_MAX_BYTES);
  const type = bytes ? imageType(bytes) : null;
  return bytes && type ? { bytes, type } : null;
}

export interface DeckJobDeps {
  now(): Date;
  /** An access token; GoogleNotConnected when there is no usable sign-in. */
  accessToken(db: Db): Promise<string>;
  api(accessToken: string): GoogleApi;
  measure(db: Db): Promise<Measure>;
  png(db: Db, svg: string, width: number): Promise<Uint8Array>;
  /** The client's logo as PNG, JPEG, GIF or SVG bytes (fetchLogo), or null. An SVG is drawn to a PNG by the job, which Slides takes. */
  logo(url: string | null): Promise<{ bytes: Uint8Array; type: string } | null>;
  /** The template's bytes from the private bucket, or null when it is not there yet. */
  template(db: Db): Promise<Uint8Array | null>;
  /** Keep a file privately and answer a signed link to it. */
  store(db: Db, path: string, bytes: Uint8Array, type: string): Promise<string>;
  unstore(db: Db, paths: string[]): Promise<void>;
  /** The email of the person who asked. */
  email(db: Db, userId: string): Promise<string | null>;
}

/** Writes only to a deck still open: one closed as abandoned stays closed when its worker finishes late. Answers whether a row was written. */
async function setExport(db: Db, id: string, patch: Record<string, unknown>, now: Date): Promise<boolean> {
  const { data, error } = await db.from("content_strategy_exports").update({ ...patch, updated_at: now.toISOString() }).eq("id", id).in("status", ["queued", "making"]).select("id");
  if (error) throw new Error(`Could not update the deck's export row: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** The folder and the template in Drive, made or imported when missing. */
async function ensureTemplate(db: Db, api: GoogleApi, deps: DeckJobDeps, now: Date): Promise<{ folder: string; template: string }> {
  const { data: conn, error } = await db.from("google_connection").select("folder_id, template_id, template_version").eq("id", true).maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  let folder: string | null = conn?.folder_id ?? null;
  if (!folder || !(await fileAlive(api, folder))) {
    folder = await createFolder(api, FOLDER_NAME);
    await db.from("google_connection").update({ folder_id: folder, template_id: null, template_version: null, updated_at: now.toISOString() }).eq("id", true);
  }
  let template: string | null = conn?.folder_id === folder ? conn?.template_id ?? null : null;
  if (!template || conn?.template_version !== TEMPLATE_VERSION || !(await fileAlive(api, template))) {
    const bytes = await deps.template(db);
    if (!bytes) throw new Error(`The deck template is not in storage yet (${DECK_BUCKET}/${TEMPLATE_PATH}).`);
    template = await importPptx(api, { name: "Socialytics strategy template (do not edit)", folderId: folder, bytes });
    await batchUpdate(api, template, weightRequests(await getPresentation(api, template)));
    await db.from("google_connection").update({ template_id: template, template_version: TEMPLATE_VERSION, updated_at: now.toISOString() }).eq("id", true);
  }
  return { folder, template };
}

export async function runStrategyDeck(db: Db, job: ScheduledJob, deps: DeckJobDeps): Promise<JobOutcome> {
  const exportId = String(job.payload?.export_id ?? "");
  const now = deps.now();
  const { data: row, error } = await db.from("content_strategy_exports").select("id, client_id, status, requested_by, strategy_written_at").eq("id", exportId).maybeSingle();
  if (error) throw new Error(`Could not read the deck's export row: ${error.message}`);
  if (!row || row.status === "done" || row.status === "failed") return { status: "skipped", reason: "No deck to make." };
  // The lease hands a job back whenever its worker died, with no limit on tries: one past its last try is the end of the deck.
  if (job.attempts > job.max_attempts) {
    await setExport(db, row.id, { status: "failed" }, now);
    return { status: "failed", reason: "The deck's worker stopped before it finished, on every try." };
  }
  await setExport(db, row.id, { status: "making" }, now);

  let token: string;
  try {
    token = await deps.accessToken(db);
  } catch (e) {
    if (!(e instanceof GoogleNotConnected)) throw e;
    await setExport(db, row.id, { status: "failed" }, now);
    return { status: "skipped", reason: "Google is not connected." };
  }
  const api = deps.api(token);
  const stored: string[] = [];
  let copy: string | null = null;
  try {
    const { folder, template } = await ensureTemplate(db, api, deps, now);
    const [{ data: s, error: sErr }, { data: edits, error: eErr }, { data: client, error: cErr }] = await Promise.all([
      db.from("content_strategies").select("sections, platforms, pillars, written_at").eq("client_id", row.client_id).maybeSingle(),
      db.from("content_strategy_edits").select("section_key, text, value").eq("client_id", row.client_id),
      db.from("clients").select("name, logo_url").eq("id", row.client_id).maybeSingle(),
    ]);
    if (sErr || eErr || cErr) throw new Error(`Could not read the strategy: ${(sErr ?? eErr ?? cErr).message}`);
    if (!s?.written_at || !client) {
      await setExport(db, row.id, { status: "failed" }, now);
      return { status: "skipped", reason: "The client has no strategy." };
    }
    const images: Record<string, string> = {};
    const keep = async (name: string, bytes: Uint8Array, type: string) => {
      const path = `charts/${row.id}/${name}`;
      images[name.replace(/\.\w+$/, "")] = await deps.store(db, path, bytes, type);
      stored.push(path);
    };
    let logo = await deps.logo(typeof client.logo_url === "string" ? client.logo_url : null).catch(() => null);
    // Slides takes PNG, JPEG and GIF: an SVG is drawn to a PNG first. A logo that cannot be, leaves its place on the cover empty (deck.ts).
    if (logo?.type === "image/svg+xml") {
      const svg = new TextDecoder().decode(logo.bytes);
      logo = await deps.png(db, svg, LOGO_PNG_WIDTH).then((bytes) => ({ bytes, type: "image/png" }), () => null);
    }
    if (logo) await keep(`logo.${logo.type.split("/")[1]}`, logo.bytes, logo.type);
    const plan = planDeck({
      client: String(client.name), logo: logo ? "logo" : null, written_at: String(s.written_at), sections: s.sections ?? {}, edits: edits ?? [],
      platforms: Array.isArray(s.platforms) ? s.platforms : [], pillars: Array.isArray(s.pillars) ? s.pillars : [],
    }, await deps.measure(db));
    for (const [name, chart] of Object.entries(plan.charts)) await keep(`${name}.png`, await deps.png(db, chart.svg, chart.width), "image/png");

    copy = await copyFile(api, template, { name: deckName(String(client.name), String(s.written_at)), folderId: folder });
    const { requests, required } = deckRequests(plan, findArchetypes(await getPresentation(api, copy)), images);
    const missing = unfilled(required, await batchUpdate(api, copy, requests));
    if (missing.length) {
      console.warn("[strategy deck] the copy did not fill, so it went to the trash:", missing.slice(0, 10).join("; "));
      await trashFile(api, copy);
      await setExport(db, row.id, { status: "failed" }, now);
      return { status: "failed", reason: `The deck did not fill: ${missing.slice(0, 5).join("; ")}` };
    }
    const email = row.requested_by ? await deps.email(db, String(row.requested_by)) : null;
    if (email) await shareAsEditor(api, copy, email);
    // The export was closed while the deck was being made: the copy is trashed, so no one keeps a deck the page calls failed.
    if (!(await setExport(db, row.id, { status: "done", file_id: copy, url: presentationUrl(copy), made_at: now.toISOString() }, now))) {
      await trashFile(api, copy);
      return { status: "failed", reason: "The deck was closed before it was finished." };
    }
    return { status: "done", result: { file_id: copy, slides: plan.slides.length, shared: !!email, ...(plan.over.length ? { over: plan.over } : {}) } };
  } catch (e) {
    if (copy) await trashFile(api, copy).catch(() => null);
    if (job.attempts >= job.max_attempts) await setExport(db, row.id, { status: "failed" }, now).catch(() => null);
    throw e;
  } finally {
    if (stored.length) await deps.unstore(db, stored).catch(() => null);
  }
}

/**
 * A deck still queued or making whose strategy_deck job has ended (failed,
 * skipped or done) or is gone is closed as failed, so the page stops saying it
 * is being made and the client's one-deck-at-a-time slot is free for a new
 * request. The job is the record of whether the deck is still being worked
 * on, so no time limit is involved: a slow deck with a live job is untouched.
 * The export and its job are made together (strategy_deck_request), so a
 * missing job is never one not yet queued. Run by the worker's every-minute
 * pass. Answers what it closed.
 */
export async function closeStalledDecks(db: Db, now: Date): Promise<Array<{ table: string; id: string }>> {
  const { data: open, error } = await db.from("content_strategy_exports").select("id").in("status", ["queued", "making"]);
  if (error) throw new Error(`Could not read the decks under way: ${error.message}`);
  const ids = ((open ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return [];
  const { data: jobs, error: jobsError } = await db.from("scheduled_jobs").select("payload").eq("kind", "strategy_deck").in("status", ["queued", "running", "waiting", "blocked"]);
  if (jobsError) throw new Error(`Could not read the deck jobs: ${jobsError.message}`);
  const live = new Set(((jobs ?? []) as Array<{ payload: { export_id?: string } | null }>).map((j) => String(j.payload?.export_id ?? "")));
  const dead = ids.filter((id) => !live.has(id));
  if (!dead.length) return [];
  const { error: closeError } = await db.from("content_strategy_exports").update({ status: "failed", updated_at: now.toISOString() }).in("id", dead).in("status", ["queued", "making"]);
  if (closeError) throw new Error(`Could not close the abandoned decks: ${closeError.message}`);
  return dead.map((id) => ({ table: "content_strategy_exports", id }));
}

/** The worker's abandoned-work sweep: the report sweep and the deck sweep, each kept from stopping the other. */
export async function closeAbandonedAll(sweeps: {
  reports: () => Promise<Array<{ table: string; id: string }>>;
  decks: () => Promise<Array<{ table: string; id: string }>>;
}): Promise<Array<{ table: string; id: string }>> {
  const out: Array<{ table: string; id: string }> = [];
  for (const [what, sweep] of [["reports", sweeps.reports], ["decks", sweeps.decks]] as const) {
    try {
      out.push(...(await sweep()));
    } catch (e) {
      console.warn(`[run-scheduled-jobs] abandoned ${what}:`, e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}
