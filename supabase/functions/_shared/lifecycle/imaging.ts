// supabase/functions/_shared/lifecycle/imaging.ts
//
// The image work of the design_settings step: the client's logo as the PNG
// with a transparent background the design path composes, and the read of
// where the client's own posts put their logo. Loaded only when that step
// runs, so the rest of the lifecycle (and its tests) never loads the image
// libraries.

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { svgToPng } from "../render/resvg.ts";
import { cutLogo } from "../design-system/logoAsset.ts";
import { anthropicMessages } from "../anthropic.ts";
import { generatedMediaPath, inkColor, logoSpotPrompt, parseLogoSpot, pngSize, type LogoSpot } from "./designSettings.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

const MAX_BYTES = 5 * 1024 * 1024;
const BUCKET = "generated-media";
/** The read of a logo spot uses the same model as the read of the client's videos. */
const SPOT_MODEL = "claude-opus-5-5";
const SPOT_POSTS = 6;

export interface LogoFile {
  path: string;
  width: number;
  height: number;
  ink: [number, number, number] | null;
  converted: "kept" | "from_svg" | "from_raster";
}

async function sha(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function readUrl(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const resp = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0" } });
  if (!resp.ok) throw new Error(`The logo file answered ${resp.status}.`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("The logo file is too large.");
  return { bytes, type: (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() };
}

/**
 * The logo as a PNG in generated-media. A PNG already there is used as it
 * is; an SVG is drawn at 1200 pixels wide; a JPEG or GIF has the backdrop
 * around the mark made transparent. Null when the file is a kind the design
 * path cannot use (the step then waits for another logo).
 */
export async function logoPng(db: Db, clientId: string, logoUrl: string): Promise<LogoFile | null> {
  const projectUrl = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("SUPABASE_URL") ?? "";
  const own = generatedMediaPath(logoUrl, projectUrl);
  let bytes: Uint8Array;
  let type = "";
  if (own) {
    const { data, error } = await db.storage.from(BUCKET).download(own);
    if (error || !data) throw new Error(`The logo file could not be read: ${error?.message ?? "missing"}`);
    bytes = new Uint8Array(await data.arrayBuffer());
    type = own.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "";
  } else {
    ({ bytes, type } = await readUrl(logoUrl));
  }
  const head = new TextDecoder().decode(bytes.slice(0, 300)).toLowerCase();
  const isPng = pngSize(bytes) !== null;
  const isSvg = type.includes("svg") || head.includes("<svg") || (head.includes("<?xml") && head.includes("svg"));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isGif = head.startsWith("gif8");
  let png: Uint8Array;
  let converted: LogoFile["converted"];
  if (isPng) {
    png = bytes;
    converted = "kept";
  } else if (isSvg) {
    png = await svgToPng(db, new TextDecoder().decode(bytes), 1200, [], "Arial");
    converted = "from_svg";
  } else if (isJpeg || isGif) {
    png = (await cutLogo(bytes, { x: 0, y: 0, width: 1, height: 1 }, 0)).png;
    converted = "from_raster";
  } else {
    return null;
  }
  const size = pngSize(png);
  if (!size) return null;
  const path = own && isPng ? own : `${clientId}/design-settings/logo-site-${await sha(png)}.png`;
  if (!(own && isPng)) {
    const { error } = await db.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`The logo file could not be stored: ${error.message}`);
  }
  // A logo whose pixels cannot be read still places; the background then follows the darkest brand color.
  let ink: [number, number, number] | null = null;
  try {
    ink = inkColor((await Image.decode(png)).bitmap);
  } catch {
    ink = null;
  }
  return { path, width: size[0], height: size[1], ink, converted };
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Where the client's own designed posts put the logo, read from up to six of them. One model call. */
export async function readLogoSpot(db: Db, brand: string, referencePaths: string[], apiKey: string): Promise<LogoSpot | null> {
  // deno-lint-ignore no-explicit-any
  const content: any[] = [];
  for (const path of referencePaths.slice(0, SPOT_POSTS)) {
    try {
      const { data } = await db.storage.from("design-references").download(path);
      if (!data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength > 4 * 1024 * 1024) continue;
      const ext = path.split(".").pop()?.toLowerCase();
      content.push({ type: "image", source: { type: "base64", media_type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", data: base64(bytes) } });
    } catch {
      // a post that cannot be read is left out of the read
    }
  }
  if (!content.length) return null;
  content.push({ type: "text", text: logoSpotPrompt(brand, content.length) });
  const result = await anthropicMessages({ apiKey, body: { model: SPOT_MODEL, max_tokens: 400, messages: [{ role: "user", content }] } });
  return parseLogoSpot(result.text);
}
