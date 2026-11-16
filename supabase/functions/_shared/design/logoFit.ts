// supabase/functions/_shared/design/logoFit.ts
//
// The stored logo of a client's design settings, as its ink alone. A logo
// stored before the trimming existed (a mark drawn on a 2,160 pixel canvas
// with wide empty padding) would be placed at the canvas's width, so the mark
// itself comes out small. When a design starts it reads the logo through
// here: a file that is not yet its ink alone is trimmed, the trimmed file is
// stored beside it, and the settings name it from then on, so every client's
// next design uses it with nobody doing anything. Nothing is made by a model
// and nothing is spent.
//
// A file looked at once is marked (derived.logo_checked names it), so the
// pixels are read once per logo, not once per design, and one client's logo
// is read at a time, inside that client's own design. The original stays in
// storage (a design in progress may hold it). Settings a person set are left
// exactly as they are, as the settings card says: the team chose that file
// and where it sits. updated_at is never written, so the card's date for
// what the team set does not move. Free of Deno and network imports: jobs.ts
// hands in the image work, loaded only when a file has to be looked at.

import type { Settings } from "../canva/jobs.ts";
import { placementFor, type Placement } from "../lifecycle/designSettings.ts";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface LogoFit { path: string; width: number; height: number }
/** The image work (imaging.refitStoredLogo): the trimmed file stored beside the original, or null when the file is already its ink alone. */
export type FitLogo = (db: Db, clientId: string, path: string) => Promise<LogoFit | null>;

export async function settleLogo(admin: Db, settings: Settings, load: () => Promise<FitLogo>, now: () => Date = () => new Date()): Promise<Settings> {
  if (settings.source === "person") return settings;
  if (settings.derived?.logo_checked === settings.logo_path) return settings;
  let fitted: LogoFit | null;
  try {
    fitted = await (await load())(admin, settings.client_id, settings.logo_path);
  } catch {
    // The file could not be read or the trimmed one stored right now: this design uses the logo as stored, and the next one looks again.
    return settings;
  }
  const derived = { ...(settings.derived ?? {}) };
  if (!fitted) {
    derived.logo_checked = settings.logo_path;
    await admin.from("design_brand_settings").update({ derived }).eq("client_id", settings.client_id).eq("logo_path", settings.logo_path).eq("source", "lifecycle");
    return { ...settings, derived };
  }
  // Where the logo sits was worked out for the old file's shape. Settings the lifecycle derived are worked out again, from the same read of the client's posts, for the trimmed file's.
  const placement: Placement | null = "placement_from" in derived ? placementFor(derived.logo_read ?? null, fitted.width / Math.max(1, fitted.height)).placement : null;
  derived.logo_checked = fitted.path;
  derived.logo_refit = { from: settings.logo_path, size: [fitted.width, fitted.height], at: now().toISOString() };
  // Only while the row still names the file that was read and is still the lifecycle's: a logo a person saved in between wins.
  await admin.from("design_brand_settings")
    .update({ logo_path: fitted.path, derived, ...(placement ? { placement } : {}) })
    .eq("client_id", settings.client_id).eq("logo_path", settings.logo_path).eq("source", "lifecycle");
  return { ...settings, logo_path: fitted.path, derived, ...(placement ? { placement } : {}) };
}
