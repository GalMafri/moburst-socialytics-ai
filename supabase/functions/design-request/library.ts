// supabase/functions/design-request/library.ts
//
// The client's posts a design is planned from, as the planner sees them
// (design: docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md,
// "How platform differences reach designs and copy"): the settings row's
// library, the request platform's posts first, each image after its label,
// "Post 3 (LinkedIn, Oct 28, 2026, kept by the team)". A video planned from
// the client's own videos sees their stills instead. Free of Deno globals:
// index.ts hands in the database.

import { planLibrary, postLabel } from "../_shared/design-prompts/designRefs.ts";
import { platformName } from "../_shared/calendar/evidence.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface PlannerLibrary {
  /** The paths shown, in the order they are numbered. */
  library: string[];
  /** Each image after its label, for the planner's message. */
  content: Array<{ type: string; text?: string; source?: unknown }>;
  /** Some posts are from other platforms than the request's. */
  otherPlatforms: boolean;
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function plannerLibrary(db: Db, args: { paths: string[]; harvested: unknown; platform: string | null; max: number; stills?: boolean }): Promise<PlannerLibrary> {
  const planned = args.stills ? args.paths.map((path) => ({ path, entry: null })) : planLibrary(args.paths, args.harvested, args.platform);
  const library: string[] = [];
  const content: PlannerLibrary["content"] = [];
  let otherPlatforms = false;
  const own = platformName(args.platform);
  for (const { path, entry } of planned) {
    if (library.length >= args.max) break;
    const { data } = await db.storage.from("design-references").download(path);
    if (!data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const mediaType = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
    library.push(path);
    if (entry?.platform && own && entry.platform !== own) otherPlatforms = true;
    content.push({ type: "text", text: args.stills ? `Still ${library.length}:` : `${postLabel(library.length, entry)}:` });
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64(bytes) } });
  }
  return { library, content, otherPlatforms };
}
