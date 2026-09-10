// supabase/functions/_shared/higgsfield/renderImage.ts
//
// One still, rendered through Higgsfield's MCP, in the shape the Gemini path
// already returns: base64 bytes and a mime type. Everything downstream of the
// model call in generate-post-image stays exactly as it was.
//
// Why bytes and not the url Higgsfield hands back: those CDN links expire
// (about a week), and the frontend's upload-to-storage step falls back to
// keeping whatever url it was given if the upload hiccups. Returning a link
// would therefore write an expiring url into post_iterations.media_urls and
// the design would quietly vanish later. Downloading here costs one hop and
// removes that whole class of failure.

import { McpClient } from "./mcp.ts";
import { MCP_URL, accessTokenFor } from "./oauth.ts";
import {
  HiggsfieldError,
  IMAGE_MODEL,
  awaitJobs,
  creditBalance,
  firstResult,
  imageAspect,
  importReferences,
  submitImage,
} from "./generate.ts";

/**
 * Refuse below this rather than fail mid-generation with a billing error.
 * An image is 2 credits; the floor leaves room to say so clearly.
 */
export const CREDIT_FLOOR = 20;

/** btoa() on a multi-megabyte string blows the stack, so encode in chunks. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface RenderedImage {
  imageB64: string;
  imageMime: string;
  textResponse: string | null;
  /** What Higgsfield actually ran. It can substitute for the one asked for. */
  model: string | null;
  creditsBefore: number | null;
}

export interface RenderImageArgs {
  /** Service-role client: reads the stored token and signs references. */
  supabase: any;
  prompt: string;
  /** The ratio the Gemini path computed, e.g. "4:5". */
  aspectRatio: string;
  /** Signed HTTPS urls, from resolveContextImageUrls. */
  referenceUrls?: string[];
  /** Total time to allow. Edge functions die at 150s. */
  budgetMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Generate one image. Throws HiggsfieldError with a sentence a person can act
 * on; the caller turns that into its own error envelope.
 */
export async function renderImageWithHiggsfield(args: RenderImageArgs): Promise<RenderedImage> {
  const doFetch = args.fetchImpl ?? fetch;
  const budgetMs = args.budgetMs ?? 100_000;
  const startedAt = Date.now();

  const token = await accessTokenFor(args.supabase);
  const mcp = new McpClient({ url: MCP_URL, accessToken: token, timeoutMs: 30_000 });

  const balance = await creditBalance(mcp);
  if (balance && balance.credits < CREDIT_FLOOR) {
    throw new HiggsfieldError(
      `The Higgsfield account is down to ${Math.floor(balance.credits)} credits, so this design was not started. ` +
        `Top the account up, or switch this client back to the standard image model in Client Setup.`,
    );
  }

  const referenceIds = args.referenceUrls?.length ? await importReferences(mcp, args.referenceUrls, "image") : [];
  if (args.referenceUrls?.length && !referenceIds.length) {
    console.warn("[higgsfield/renderImage] no reference survived import; generating from the prompt alone");
  }

  const jobs = await submitImage(mcp, {
    prompt: args.prompt,
    aspect: imageAspect(args.aspectRatio),
    referenceIds,
    resolution: "2k",
    model: IMAGE_MODEL,
  });

  // Leave time to download what was generated; a result nobody fetched is
  // a spent credit with nothing to show.
  const spent = Date.now() - startedAt;
  const waited = await awaitJobs(mcp, jobs, { budgetMs: Math.max(budgetMs - spent - 15_000, 10_000) });
  const done = firstResult(waited);

  const resp = await doFetch(done.url);
  if (!resp.ok) {
    throw new HiggsfieldError(`Higgsfield produced the image but it could not be downloaded (${resp.status}).`);
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (!buf.length) throw new HiggsfieldError("Higgsfield produced an empty image.");

  return {
    imageB64: bytesToBase64(buf),
    imageMime: resp.headers.get("content-type")?.split(";")[0] || "image/png",
    textResponse: null,
    model: done.model ?? IMAGE_MODEL,
    creditsBefore: balance?.credits ?? null,
  };
}
