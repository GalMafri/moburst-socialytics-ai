// supabase/functions/_shared/strategy/deckLive.ts
//
// The deck job's live dependencies (deckJob.ts): Google through the Vault
// sign-in, Geist's metrics and the resvg renderer the app already uses, the
// private strategy-decks bucket. Kept apart so tests never load the renderer.

import { googleApi } from "../google/api.ts";
import { googleAccessToken, googleConfig } from "../google/oauth.ts";
import { fontBytes } from "../render/fonts.ts";
import * as opentype from "https://esm.sh/opentype.js@1.3.4";
import { svgToPng } from "../render/resvg.ts";
import { DECK_BUCKET, fetchLogo, SIGNED_SECONDS, TEMPLATE_PATH, type DeckJobDeps } from "./deckJob.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export function liveDeckDeps(env: (k: string) => string | undefined): DeckJobDeps {
  const config = googleConfig(env);
  return {
    now: () => new Date(),
    accessToken: (db: Db) => googleAccessToken(db, config, new Date()),
    api: (token) => googleApi(token),
    async measure(db) {
      // Geist's own metrics, as the renderer measures text (render/measure.ts).
      // deno-lint-ignore no-explicit-any
      const parse = ((opentype as any).parse ?? (opentype as any).default?.parse) as (b: ArrayBuffer) => { getAdvanceWidth(t: string, s: number): number };
      const face = async (w: number) => { const b = await fontBytes(db, "Geist", w); return parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer); };
      const [light, medium, bold] = await Promise.all([face(300), face(500), face(700)]);
      return (text, size, weight) => (weight === "Bold" ? bold : weight === "Medium" ? medium : light).getAdvanceWidth(text, size);
    },
    async png(db, svg, width) {
      const fonts = await Promise.all([300, 400, 500].map((w) => fontBytes(db, "Geist", w)));
      return svgToPng(db, svg, width, fonts, "Geist");
    },
    logo: (url) => fetchLogo(url),
    async template(db) {
      const { data } = await db.storage.from(DECK_BUCKET).download(TEMPLATE_PATH);
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    },
    async store(db, path, bytes, type) {
      const { error } = await db.storage.from(DECK_BUCKET).upload(path, new Blob([bytes as unknown as BlobPart], { type }), { contentType: type, upsert: true });
      if (error) throw new Error(`Could not keep a deck image: ${error.message}`);
      const { data, error: signError } = await db.storage.from(DECK_BUCKET).createSignedUrl(path, SIGNED_SECONDS);
      if (signError || !data?.signedUrl) throw new Error(`Could not sign a deck image: ${signError?.message ?? "no link"}`);
      return data.signedUrl as string;
    },
    async unstore(db, paths) {
      await db.storage.from(DECK_BUCKET).remove(paths);
    },
    async email(db, userId) {
      const { data } = await db.auth.admin.getUserById(userId);
      return data?.user?.email ?? null;
    },
  };
}
