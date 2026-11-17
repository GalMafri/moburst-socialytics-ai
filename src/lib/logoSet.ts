// What the design settings card shows of a settings row's logo set
// (design_brand_settings.logo_set, made by the lifecycle's design_settings
// step; spec: docs/superpowers/specs/2026-11-16-logo-tone-design.md, "What
// the settings card shows"). A client's logo is a set of up to three files:
// the client's logo file, a second file for the pictures that file was not
// made for, and the logo in white. Each design carries the one its picture
// calls for.
//
// The card speaks to staff about the client. A tile is shown only for
// pictures a file serves, so no tile is ever empty and nothing on the card
// reads as missing. Before a set exists there are no tiles. One quiet
// control lets the team choose a file of their own for the pictures the
// client's logo file was not made for; it is optional and nothing waits for
// it.

import type { LogoSet } from "../../supabase/functions/_shared/design/logoTone";
import { NEUTRAL_DARK, NEUTRAL_LIGHT, personOther } from "../../supabase/functions/_shared/lifecycle/designSettings";

export interface LogoTile {
  key: "light" | "dark" | "white";
  label: "Logo on light pictures" | "Logo on dark pictures" | "Logo in white";
  /** The file's path in generated-media. */
  path: string;
  /** The color the tile shows the file on. */
  ground: string;
  /** Where the file came from. */
  caption: string;
}

/** The tiles, and the one control beside them: its words, and whether a file of the team's own is there to remove. */
export interface LogoSetView {
  tiles: LogoTile[];
  control: { label: "Choose a file for light pictures" | "Choose a file for dark pictures"; removable: boolean } | null;
}

export type LogoSetRow = { logo_path: string; background: string; source?: string | null; logo_set?: unknown };

const STORED = "The client's logo file";

/**
 * The view for a row: no tiles and no control while the row has no set for
 * its logo (none made yet, or the main logo changed since).
 *
 * The client's logo file is shown on the pictures it was made for. For the
 * other pictures: a person's own file while the row names one for this logo
 * (shown from the moment it is saved), else the set's second file, else the
 * client's logo file when it shows on both, else no tile. The logo in white
 * has a tile when the set holds one. The view is the same for a row the
 * lifecycle wrote and a row a person set.
 */
export function logoSetView(row: LogoSetRow | null | undefined): LogoSetView {
  const set = row?.logo_set as Partial<LogoSet> | null | undefined;
  if (!row || !set || typeof set !== "object" || set.of !== row.logo_path || set.rule !== 1 || (set.own !== "light" && set.own !== "dark")) return { tiles: [], control: null };
  const own = set.own;
  const person = personOther(row);
  // A person's file the set still names after it was removed is no longer the client's second file.
  const second = set.other && !(set.other.from === "person" && set.other.path !== person?.path) ? set.other : null;

  const other: { path: string; caption: string } | null = person
    ? { path: person.path, caption: "Set by your team" }
    : second
      ? { path: second.path, caption: second.from === "site" ? "From the client's website" : own === "light" ? "A light version of it" : "A dark version of it" }
      : set.both === true
        ? { path: row.logo_path, caption: STORED }
        : null;
  const mine = { path: row.logo_path, caption: STORED };
  const light = own === "light" ? mine : other;
  const dark = own === "dark" ? mine : other;

  const tiles: LogoTile[] = [];
  if (light) tiles.push({ key: "light", label: "Logo on light pictures", ground: NEUTRAL_LIGHT, ...light });
  if (dark) tiles.push({ key: "dark", label: "Logo on dark pictures", ground: NEUTRAL_DARK, ...dark });
  if (set.white?.path) tiles.push({ key: "white", label: "Logo in white", path: set.white.path, ground: NEUTRAL_DARK, caption: "A white version of it" });
  return { tiles, control: { label: own === "light" ? "Choose a file for dark pictures" : "Choose a file for light pictures", removable: !!person } };
}

/** Where a second logo file chosen on the card is stored: the name set_design_logo_other accepts. */
export function logoOtherPath(clientId: string, fileKey: string): string {
  return `${clientId}/design-settings/logo-other-${fileKey.replace(/\.[^.]+$/, "")}.png`;
}
