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

export interface DeckJobDeps {
  now(): Date;
  /** An access token; GoogleNotConnected when there is no usable sign-in. */
  accessToken(db: Db): Promise<string>;
  api(accessToken: string): GoogleApi;
  measure(db: Db): Promise<Measure>;
  png(db: Db, svg: string, width: number): Promise<Uint8Array>;
  /** The client's logo as PNG, JPEG or GIF bytes, or null. */
  logo(url: string | null): Promise<{ bytes: Uint8Array; type: string } | null>;
  /** The template's bytes from the private bucket, or null when it is not there yet. */
  template(db: Db): Promise<Uint8Array | null>;
  /** Keep a file privately and answer a signed link to it. */
  store(db: Db, path: string, bytes: Uint8Array, type: string): Promise<string>;
  unstore(db: Db, paths: string[]): Promise<void>;
  /** The email of the person who asked. */
  email(db: Db, userId: string): Promise<string | null>;
}

async function setExport(db: Db, id: string, patch: Record<string, unknown>, now: Date): Promise<void> {
  const { error } = await db.from("content_strategy_exports").update({ ...patch, updated_at: now.toISOString() }).eq("id", id);
  if (error) throw new Error(`Could not update the deck's export row: ${error.message}`);
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
    const logo = await deps.logo(typeof client.logo_url === "string" ? client.logo_url : null).catch(() => null);
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
    await setExport(db, row.id, { status: "done", file_id: copy, url: presentationUrl(copy), made_at: now.toISOString() }, now);
    return { status: "done", result: { file_id: copy, slides: plan.slides.length, shared: !!email, ...(plan.over.length ? { over: plan.over } : {}) } };
  } catch (e) {
    if (copy) await trashFile(api, copy).catch(() => null);
    if (job.attempts >= job.max_attempts) await setExport(db, row.id, { status: "failed" }, now).catch(() => null);
    throw e;
  } finally {
    if (stored.length) await deps.unstore(db, stored).catch(() => null);
  }
}
