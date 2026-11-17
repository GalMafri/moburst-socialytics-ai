// supabase/functions/_shared/brand-references/discover.ts
//
// The weekly check of a client's posts for its design references (design:
// docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md, "When
// references refresh"; the rules: docs/superpowers/plans/2026-11-17-
// reference-library.md): a Sprout read of the window, newest first, every
// page; then a review of the posts that could reach the library. The reviewer
// sees the image, the platform, the date and the caption, and answers two
// questions: is it a designed layout, and was it made for an occasion. Each
// answer is stored in design_reference_reviews, so a post is asked once per
// version of the question (a designed post answered under an older version
// is asked once more, from its stored image). Which posts are reviewed is
// corpus.ts's decision.
// Everything that leaves the project goes through CheckIO, so the lifecycle's
// tests stand in for Sprout, the images and the model.

import { fetchSocialImage } from "./mediaFetch.ts";
import { sproutAccessToken } from "../sprout/profiles.ts";
import { type Candidate, kindClassification, REVIEW_SYSTEM, reviewQuestion, usableClassification } from "./candidates.ts";
import { captionHash, type Review, REVIEW_RULE } from "./corpus.ts";
import { StyleError } from "./errors.ts";
import { anthropicFetch } from "../anthropic.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const MAX_BYTES = 4 * 1024 * 1024;
const PAGE_SIZE = 50;
const MAX_PAGES = 100;
/** Most posts one read returns. A read this long may have been cut short, so nothing is concluded from what it lacks. */
export const READ_CAP = PAGE_SIZE * MAX_PAGES;
const PAGE_GAP_MS = 200;
/** Reviews stop starting after this long in one run, inside one function's compute; the rest are reviewed a minute later. */
export const REVIEW_BUDGET_MS = 55_000;
/** A check that reads past 90 days starts no further part of the year after this long in one run; the next part is read a minute later. */
export const SLICE_START_BUDGET_MS = 30_000;
/** A read of one part of the year gives up after this long into a run, so a run always ends well inside the worker's lease. */
export const READ_STOP_MS = 70_000;
/**
 * After this many failed runs of the same check in a row (an hour, then six
 * hours apart), a first batch the model answers none of no longer stops the
 * check: its posts are recorded as not answered and asked again a week later,
 * so one post the model can never review does not hold a client's library
 * back for good.
 */
export const GIVE_UP_AFTER_FAILURES = 2;
const REVIEW_MODEL = "claude-haiku-4-5-20251001";

export interface CheckIO {
  now(): Date;
  apiKey(db: Db): Promise<string>;
  /** The profiles' published posts in the window, every page, newest first. One Sprout read. With `stopAt` (a clock time), it throws once that time has passed with pages still to read. */
  // deno-lint-ignore no-explicit-any
  readPosts(args: { profileIds: string[]; customer: string; since: Date; until: Date; stopAt?: number }): Promise<any[]>;
  /** A post's image from the provider's own media host; throws when it cannot be read. */
  image(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
  /** The model's answer on one post: is it a designed post, and was it made for an occasion. */
  review(args: { apiKey: string; brand: string; imageUrl: string; platform: string; postedAt: string; caption: string }): Promise<unknown>;
}

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

async function responseJson(response: Response, label: string) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = [body.message, body.error?.message, ...(Array.isArray(body.errors) ? body.errors.map((e: { message?: unknown }) => e.message) : [])]
      .filter((s) => typeof s === "string").join(" ").replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 300);
    console.error(`[brand-discovery] ${label} failed (${response.status})`, detail || JSON.stringify(body).slice(0, 400));
    throw new StyleError("provider", `${label} did not answer. It will be tried again.`);
  }
  return response.json();
}

/** Provider-owned public media only; no caller-supplied URL enters this fetch. */
async function imageBytes(url: string) {
  const response = await fetchSocialImage(url);
  if (!response.ok) throw new Error("Image unavailable");
  const mime = (response.headers.get("content-type") || "").split(";")[0];
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("Not a supported still image");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty image");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Image too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, mime };
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The profiles' posts, as Sprout's analytics/posts lists them, newest first by the date they were posted. */
// deno-lint-ignore no-explicit-any
async function readPosts(args: { profileIds: string[]; customer: string; since: Date; until: Date; stopAt?: number }): Promise<any[]> {
  let token: string;
  try {
    token = await sproutAccessToken();
  } catch (e) {
    console.error("[brand-discovery] Sprout connection:", e instanceof Error ? e.message : e);
    throw new StyleError("provider", "Social account connection did not answer. It will be tried again.");
  }
  // deno-lint-ignore no-explicit-any
  const posts: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
    // A read that has run out of its time is given up whole: part of a read is never taken for all of it.
    if (page > 1 && args.stopAt && Date.now() > args.stopAt) throw new StyleError("provider", "Published-post lookup took too long. It will be tried again.");
    const result = await responseJson(await fetch(`https://api.sproutsocial.com/v1/${encodeURIComponent(args.customer)}/analytics/posts`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        filters: [`customer_profile_id.eq(${args.profileIds.join(",")})`, `created_time.in(${day(args.since)}T00:00:00...${day(args.until)}T23:59:59)`],
        fields: ["guid", "customer_profile_id", "network", "created_time", "perma_link", "content_category", "visual_media", "is_boosted", "text"],
        sort: ["created_time:desc"], timezone: "UTC", page, limit: PAGE_SIZE,
      }),
      signal: AbortSignal.timeout(20000),
    }), "Published-post lookup");
    if (!Array.isArray(result.data)) throw new StyleError("provider", "Published-post lookup did not answer. It will be tried again.");
    posts.push(...result.data);
    if (page >= Number(result.paging?.total_pages || 1)) return posts;
  }
  return posts;
}

type ReviewImage = { type: "url"; url: string } | { type: "base64"; media_type: string; data: string };

/** The request the reviewer is sent for one post: its image, then the question. The image goes by URL here; a check of the question itself may send the bytes. */
export function reviewRequest(args: { brand: string; platform: string; postedAt: string; caption: string }, image: ReviewImage): Record<string, unknown> {
  return {
    model: REVIEW_MODEL, max_tokens: 400, system: REVIEW_SYSTEM,
    messages: [{ role: "user", content: [{ type: "image", source: image }, { type: "text", text: reviewQuestion(args) }] }],
  };
}

/** The reviewer's JSON answer, or {} when the reply holds none. */
// deno-lint-ignore no-explicit-any
export function reviewReply(result: any): unknown {
  try {
    return JSON.parse(String(result?.content?.[0]?.text || "").match(/\{[\s\S]*\}/)?.[0] || "{}");
  } catch {
    return {};
  }
}

async function review(args: { apiKey: string; brand: string; imageUrl: string; platform: string; postedAt: string; caption: string }): Promise<unknown> {
  return reviewReply(await responseJson(await anthropicFetch("/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json", "x-api-key": args.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(reviewRequest(args, { type: "url", url: args.imageUrl })), signal: AbortSignal.timeout(20000),
  }), "Reference quality check"));
}

/** The Anthropic key: the function environment first, then the workspace setting. */
export async function anthropicKeyFor(db: Db): Promise<string> {
  const fromEnv = env("ANTHROPIC_API_KEY");
  if (fromEnv) return fromEnv;
  const { data } = await db.from("app_settings").select("value").eq("key", "anthropic_api_key").maybeSingle();
  if (!data?.value) throw new StyleError("provider", "The AI connection is not configured.");
  return String(data.value);
}

export function liveCheckIO(): CheckIO {
  return { now: () => new Date(), apiKey: anthropicKeyFor, readPosts, image: imageBytes, review };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ReviewRun {
  /** The rows written this run, a post whose image could not be read included. */
  rows: Review[];
  /** Calls made to the model this run. */
  modelCalls: number;
  /** Designed posts whose question the model did not answer this run (an error, not an answer): left exactly as they were, and asked again on the next run. */
  missed: string[];
}

/**
 * Review the queued posts, four at a time, until the queue or the time runs
 * out (the first four whatever the time). A new post's image is read, and one that matches an image answered
 * before (under the current question) takes that answer without a model
 * call. A designed post asked again is asked from its stored image, and only
 * its answer to the occasion question changes: it stays designed whatever
 * comes back. When the model does not answer it (an error: a rate limit, an
 * overload), its row is left exactly as it was, so it is asked again on the
 * next run and loses no time in a library; only an answer that was read and
 * is not a full one is recorded as not answered. Every answer is stored at
 * once; a designed post's image is kept at `<client>/social-<hash>`.
 * `failedBefore` is how many runs of this check failed in a row before this
 * one (GIVE_UP_AFTER_FAILURES).
 */
export async function reviewPosts(db: Db, client: { id: string; name: string }, queue: Candidate[], known: Review[], io: CheckIO, apiKey: string, started = Date.now(), failedBefore = 0): Promise<ReviewRun> {
  const rows: Review[] = [];
  const missed: string[] = [];
  let modelCalls = 0;
  const knownById = new Map(known.map((r) => [r.source_post_id, r]));
  // An image answered before answers a new post only when the answer is still good: not designed, or designed under the current question (answered ones last, so they win).
  const byHash = new Map(known
    .filter((r) => r.content_hash && (r.verdict === "not_designed" || (r.verdict === "designed" && (r.rule ?? 1) >= REVIEW_RULE)))
    .sort((a, b) => Number(a.kind != null) - Number(b.kind != null))
    .map((r) => [r.content_hash!, r]));
  const store = async (row: Review) => {
    const { error } = await db.from("design_reference_reviews").upsert({ client_id: client.id, ...row }, { onConflict: "client_id,source_post_id" });
    if (error) throw new StyleError("provider", "A reviewed post could not be saved. It will be tried again.");
    rows.push(row);
  };
  // A post known only from its stored review has no caption or image here: it is never asked (the queue leaves it out; this holds it to that).
  queue = queue.filter((c) => !c.carried);
  const ask = (c: Candidate, imageUrl: string) => io.review({ apiKey, brand: client.name, imageUrl, platform: c.platform, postedAt: c.posted_at, caption: c.text });
  // The first four are always reviewed, so a check whose reads took long (a whole year of posts) still moves forward every run.
  for (let at = 0; at < queue.length && (at === 0 || Date.now() - started < REVIEW_BUDGET_MS); at += 4) {
    const batch = queue.slice(at, at + 4);
    let answered = 0;
    let failed = 0;
    const unanswered = new Set<string>();
    const stored = (c: Candidate) => {
      const r = knownById.get(c.source_post_id);
      return r?.verdict === "designed" && r.path ? r : null;
    };

    // A designed post asked again: from its stored image, no download and no new file.
    const again = Promise.all(batch.filter((c) => stored(c)).map(async (c) => {
      const row = stored(c)!;
      modelCalls++;
      try {
        const value = await ask(c, db.storage.from("design-references").getPublicUrl(row.path).data.publicUrl);
        answered++;
        return { c, row, answer: kindClassification(value), state: "answered" as const };
      } catch (e) {
        console.warn("[brand-discovery] review did not finish", c.source_post_id, e instanceof Error ? e.message : "unknown");
        // A stored image that is gone is that post's own trouble, not the model being down: it is asked again a week later.
        let there = true;
        try {
          there = !!(await db.storage.from("design-references").download(row.path)).data;
        } catch {
          // The storage did not answer: the model's failure stands as one.
        }
        if (there) failed++;
        return { c, row, answer: null, state: there ? "thrown" as const : "gone" as const };
      }
    }));

    // Each new image read and hashed first, so one image posted twice is looked at once.
    const read = await Promise.all(batch.filter((c) => !stored(c)).map(async (c) => {
      try {
        const image = await io.image(c.image_url);
        const hash = await sha256(image.bytes);
        const ext = image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg";
        return { c, image, hash, ext };
      } catch (e) {
        console.warn("[brand-discovery] image unavailable", c.source_post_id, e instanceof Error ? e.message : "unknown");
        return { c, image: null, hash: null, ext: null };
      }
    }));
    const fresh = [...new Map(read.filter((x) => x.hash && !byHash.has(x.hash)).map((x) => [x.hash!, x])).values()];
    await Promise.all(fresh.map(async ({ c, image, hash, ext }) => {
      // Stored first and read by URL: encoding full-size photos here ran the function out of CPU (14 Oct 2026).
      // A candidate sits apart from the kept references until it is accepted, so a rejection never removes a file in use.
      const looked = `${client.id}/candidates/${hash}.${ext}`;
      const { error: lookError } = await db.storage.from("design-references").upload(looked, image!.bytes, { contentType: image!.mime, upsert: true });
      if (lookError) throw new StyleError("provider", "Reference storage failed. It will be tried again.");
      const imageUrl = db.storage.from("design-references").getPublicUrl(looked).data.publicUrl;
      modelCalls++;
      // deno-lint-ignore no-explicit-any
      let value: any;
      try {
        value = await ask(c, imageUrl);
        answered++;
      } catch (e) {
        console.warn("[brand-discovery] review did not finish", hash, e instanceof Error ? e.message : "unknown");
        unanswered.add(hash!);
        failed++;
        return;
      } finally {
        await db.storage.from("design-references").remove([looked]);
      }
      const usable = usableClassification(value);
      // The occasion question counts only for a designed post, and only as a full answer.
      const answer = usable ? kindClassification(value) : null;
      const path = `${client.id}/social-${hash}.${ext}`;
      if (usable) {
        const { error: uploadError } = await db.storage.from("design-references").upload(path, image!.bytes, { contentType: image!.mime, upsert: true });
        if (uploadError) throw new StyleError("provider", "Reference storage failed. It will be tried again.");
      }
      byHash.set(hash!, {
        source_post_id: "", network: "", posted_at: null, source_url: null, content_hash: hash, verdict: usable ? "designed" : "not_designed", path: usable ? path : null,
        confidence: typeof value?.confidence === "number" ? value.confidence : null, reason: typeof value?.reason === "string" ? value.reason.slice(0, 500) : null, reviewed_at: "",
        kind: answer?.kind ?? null, occasion: answer?.occasion ?? null, evidence: answer?.evidence || null,
      });
    }));
    const asked = await again;
    // The model answered none of this batch: it is down, and the whole check is tried again later. After the check has
    // failed GIVE_UP_AFTER_FAILURES times in a row, its first batch is recorded as not answered instead, so the check goes on.
    const givenUp = !!failed && !answered && at === 0 && failedBefore >= GIVE_UP_AFTER_FAILURES;
    if (failed && !answered && !givenUp) throw new StyleError("provider", "The reference quality check did not answer. It will be tried again.");
    const reviewedAt = io.now().toISOString();
    // Asked again: only the answer to the occasion question is written. An answer that was read and is not a full one
    // leaves the post designed and asked again a week later; so does a stored image that is gone.
    for (const { c, row, answer, state } of asked) {
      // The model did not answer (an error, not an answer): the row stays exactly as it was and is asked again on the next run.
      if (state === "thrown" && !givenUp) {
        missed.push(c.source_post_id);
        continue;
      }
      const next: Review = {
        ...row, kind: answer?.kind ?? null, occasion: answer?.occasion ?? null, evidence: answer?.evidence || null, caption_hash: captionHash(c.text),
        profile_id: c.profile_id || row.profile_id || null, rule: REVIEW_RULE, reviewed_at: reviewedAt,
      };
      await store(next);
      knownById.set(next.source_post_id, next);
      if (next.content_hash) byHash.set(next.content_hash, next);
    }
    for (const { c, hash } of read) {
      const base = {
        source_post_id: c.source_post_id, network: c.network, posted_at: c.posted_at || null, source_url: c.source_url, reviewed_at: reviewedAt, caption_hash: captionHash(c.text),
        profile_id: c.profile_id || null, rule: REVIEW_RULE,
      };
      const none = { kind: null, occasion: null, evidence: null };
      // One the model would not answer is looked at again on a later weekly check, like an image that could not be read.
      if (hash && unanswered.has(hash)) {
        await store({ ...base, ...none, content_hash: hash, verdict: "unreadable", path: null, confidence: null, reason: "The post could not be reviewed." });
        continue;
      }
      // The same image, cross-posted or posted again, takes the answer it had.
      const answer = hash ? byHash.get(hash)! : null;
      await store(answer
        ? { ...base, content_hash: hash, verdict: answer.verdict, path: answer.path, confidence: answer.confidence, reason: answer.reason, kind: answer.kind ?? null, occasion: answer.occasion ?? null, evidence: answer.evidence ?? null }
        : { ...base, ...none, content_hash: null, verdict: "unreadable", path: null, confidence: null, reason: "The image could not be read." });
    }
  }
  return { rows, modelCalls, missed };
}
