// The words and numbers of the Strategy page (spec: docs/superpowers/specs/
// 2026-11-03-strategy-v2-design.md, section 1), worked out once here so the
// page, its cards and its PDF say the same thing: the period, the one origin
// line, the data line, each figure, and what a person's version shows.

import { formatDate } from "@/lib/display";
import { dataLine, type PlatformFigures } from "../../supabase/functions/_shared/strategy/basis";
import { dayWords, editShown, type Goal } from "../../supabase/functions/_shared/strategy/sections";
import type { Cadence, WrittenState } from "../../supabase/functions/_shared/strategy/platforms";

/** A competitor's figures on a platform, as the strategy stores them. */
export interface CompetitorFigures {
  company: string;
  platform: string;
  posts: number;
  posts_per_week: number;
  median_engagement: number | null;
  rate_per_view?: number | null;
  followers: number | null;
}

/** A platform as the strategy stores it. Rows written on 2 Nov have no figures. */
export interface PagePlatform {
  platform: string;
  key: string;
  state: WrittenState;
  handle: string | null;
  reason: string | null;
  cadence: Cadence | null;
  baseline?: { posts: number; posts_per_week: number; median_engagement: number | null; engagement_rate: number | null } | null;
  figures?: PlatformFigures | null;
  competitors?: CompetitorFigures[];
}

export interface PageStrategy {
  shape?: number | null;
  sections: Record<string, unknown>;
  platforms: PagePlatform[];
  pillars: Array<{ name: string; share: number | null }>;
  sources: string[];
  written_at: string;
}

/** A person's version of a section (content_strategy_edits). */
export interface StrategyEdit {
  section_key: string;
  text: string;
  value?: unknown;
  editor_name: string;
  edited_at: string;
}

const DAY = 86_400_000;
const isoDay = (iso: string) => String(iso ?? "").slice(0, 10);

/** The 90 days the strategy is for. */
export function periodOf(writtenAt: string): { from: string; to: string } {
  const from = isoDay(writtenAt);
  return { from, to: new Date(Date.parse(`${from}T00:00:00Z`) + 90 * DAY).toISOString().slice(0, 10) };
}

/** "Social strategy, 3 Nov 2026 to 1 Feb 2027". */
export function periodLine(writtenAt: string): string {
  const p = periodOf(writtenAt);
  return `Social strategy, ${dayWords(p.from)} to ${dayWords(p.to)}`;
}

const SOURCE_WORDS: Record<string, string> = {
  brief: "the brief",
  strategy_doc: "the strategy document",
  website: "the website",
  brand_book: "the brand book",
  competitors: "the tracked competitors",
  posts: "90 days of posts",
};

/** "the brief, the website and 90 days of posts". */
export function writtenFrom(sources: string[]): string {
  const words = sources.map((s) => SOURCE_WORDS[s]).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The page's one origin line: "Written 3 Nov from the brief, the website and 90 days of posts". */
export function originLine(writtenAt: string, sources: string[]): string {
  const from = writtenFrom(sources);
  return `Written ${dayWords(isoDay(writtenAt)).replace(/ \d{4}$/, "")}${from ? ` from ${from}` : ""}`;
}

/** "Edited by Neria, 4 Nov": the chip on a card a person changed. */
export function editedChip(edit: Pick<StrategyEdit, "editor_name" | "edited_at">): string {
  const first = String(edit.editor_name ?? "").trim().split(/\s+/)[0] || "your team";
  return `Edited by ${first}, ${dayWords(isoDay(edit.edited_at)).replace(/ \d{4}$/, "")}`;
}

/** The data line, from each platform's basis; "" for a strategy written before platforms had one. */
export function pageDataLine(platforms: PagePlatform[]): string {
  const figures = platforms.filter((p) => p.state !== "not_now" && p.figures).map((p) => p.figures as PlatformFigures);
  return dataLine(figures);
}

/** What a card shows: a person's version where there is one (fields, or 2 Nov text), else the product's. */
export function shownValue(product: unknown, edit: StrategyEdit | undefined): unknown {
  const mine = editShown(edit ?? null);
  return mine !== null && mine !== "" ? mine : product;
}

/** A figure as the page prints it: "1,240", "4.2", or "None yet". */
export function figure(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "None yet";
  return Math.abs(n) < 100 ? String(Math.round(n * 10) / 10) : Math.round(n).toLocaleString("en-US");
}

export const percentOf = (r: number | null | undefined) => (r === null || r === undefined || !Number.isFinite(r) ? "None yet" : `${Math.round(r * 1000) / 10}%`);

const BASIS_WORDS: Record<string, string> = { measured: "From Sprout", public: "Public posts", thin: "Few public posts", none: "No public posts found" };
export const basisChip = (basis: string | null | undefined) => BASIS_WORDS[String(basis)] ?? "";

const STATE_WORDS: Record<string, string> = { posting: "Posting now", new: "New", not_now: "Not now" };
export const stateWords = (state: string) => STATE_WORDS[state] ?? "";

/** "2.4 a week", or "" with no rate. */
export function cadenceWords(c: Cadence | null | undefined): string {
  if (!c || !(c.per_week > 0)) return "";
  const n = Math.round(c.per_week * 10) / 10;
  return n >= 1 ? `${n} a week` : `1 every ${Math.round(1 / n)} weeks`;
}

/** What the rate is per: impressions with Sprout, views in public. */
export const rateLabel = (kind: string | null | undefined) => (kind === "view" ? "per view" : "per impression");

/** A goal's figure today and its line: "42" and "today, above it by 1 Feb 2027". */
export function goalFigure(g: Goal): { figure: string; line: string } {
  const by = dayWords(g.by);
  if (g.baseline === null || g.baseline === undefined) return { figure: "", line: `${g.direction === "below" ? "Below" : "Above"} today's by ${by}` };
  const n = g.metric === "engagement_rate" ? percentOf(g.baseline) : figure(g.baseline);
  return { figure: n, line: `today, ${g.direction} it by ${by}` };
}

/** A 2 Nov text as short lines: its own lines, "- " bullets taken off. */
export function textLines(text: string): string[] {
  return String(text ?? "").split(/\n+/).map((l) => l.trim().replace(/^[-•*]\s+/, "")).filter(Boolean);
}

/** The newest person's version, for "the page changed since the deck". */
export function newestEdit(edits: StrategyEdit[]): string | null {
  return edits.reduce<string | null>((max, e) => (!max || e.edited_at > max ? e.edited_at : max), null);
}

/** "made 3 Nov". */
export const madeOn = (iso: string | null | undefined) => (iso ? `made ${formatDate(iso, { year: false })}` : "");
