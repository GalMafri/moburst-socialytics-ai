// The words and numbers of the Strategy page (spec: docs/superpowers/specs/
// 2026-11-03-strategy-v2-design.md, section 1), worked out once here so the
// page, its cards and its PDF say the same thing: the period, the one origin
// line, the data line, each figure, and what a person's version shows.

import { formatDate, NO_DATA } from "@/lib/display";
import { dataLine, type PlatformFigures } from "../../supabase/functions/_shared/strategy/basis";
import { dayWords, editShown, metricWords, type Goal } from "../../supabase/functions/_shared/strategy/sections";
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
  /** The phase of a write under way, or null; a text read from the stored write, never its evidence. */
  updating?: string | null;
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
  /** claude when the person saved it from Claude (two-way sync). */
  source?: string | null;
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
  competitors: "the competitors we chose",
  posts: "90 days of posts",
};

/** "the brief, the website and 90 days of posts". */
export function writtenFrom(sources: string[]): string {
  const words = sources.map((s) => SOURCE_WORDS[s]).filter(Boolean);
  if (words.length < 2) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The page's one origin line: "Written Nov 3 from the brief, the website and 90 days of posts". */
export function originLine(writtenAt: string, sources: string[]): string {
  const from = writtenFrom(sources);
  return `Written ${dayWords(isoDay(writtenAt), { year: false })}${from ? ` from ${from}` : ""}`;
}

/** The chip on a card a person changed: "Edited by Neria, Nov 4", or "From the connector, by Sinead, Nov 3" for a version saved from the connector. */
export function editedChip(edit: Pick<StrategyEdit, "editor_name" | "edited_at" | "source">): string {
  const first = String(edit.editor_name ?? "").trim().split(/\s+/)[0] || "your team";
  const by = edit.source === "claude" ? `From the connector, by ${first}` : `Edited by ${first}`;
  return `${by}, ${dayWords(isoDay(edit.edited_at), { year: false })}`;
}

/** The data line, from each platform's basis; "" for a strategy written before platforms had one. */
export function pageDataLine(platforms: PagePlatform[]): string {
  const figures = platforms.filter((p) => p.state !== "not_now" && p.figures).map((p) => p.figures as PlatformFigures);
  return dataLine(figures);
}

/** What a card shows: a person's version where there is one (their words over the latest write's numbers and dates, or 2 Nov text), else the product's. */
export function shownValue(product: unknown, edit: StrategyEdit | undefined): unknown {
  const mine = edit ? editShown(edit.section_key, edit, product) : null;
  return mine !== null && mine !== "" ? mine : product;
}

/** What the page prints for a number nobody has. */
export const NOT_AVAILABLE = NO_DATA;

/** A figure as the page prints it: "1,240", "4.2", or "No data". */
export function figure(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return NOT_AVAILABLE;
  return Math.abs(n) < 100 ? String(Math.round(n * 10) / 10) : Math.round(n).toLocaleString("en-US");
}

export const percentOf = (r: number | null | undefined) => (r === null || r === undefined || !Number.isFinite(r) ? NOT_AVAILABLE : `${Math.round(r * 1000) / 10}%`);

const BASIS_WORDS: Record<string, string> = { measured: "From connected accounts", public: "Public posts", thin: "Few public posts", none: "No public posts found" };
export const basisChip = (basis: string | null | undefined) => BASIS_WORDS[String(basis)] ?? "";

const STATE_WORDS: Record<string, string> = { posting: "Posting now", new: "New", not_now: "Not now" };
export const stateWords = (state: string) => STATE_WORDS[state] ?? "";

/**
 * The one definition of "planned": a rate this client's plan sets. A rate that
 * is the usual pace of other brands (all_tracked) is a guess about the category,
 * so it is not planned. The plan tile and every platform card read this.
 */
export function plannedRate(c: Cadence | null | undefined): number {
  return c && c.per_week > 0 && c.source !== "all_tracked" ? c.per_week : 0;
}

const oneDecimal = (n: number) => String(Math.round(n * 10) / 10);

/** A planned rate for a tile labeled "Planned a week": "2.4", or "" with no planned rate. */
export function plannedPerWeek(c: Cadence | null | undefined): string {
  const r = plannedRate(c);
  return r > 0 ? oneDecimal(r) : "";
}

/** The usual pace of other brands in the category, for its own tile; "" when the rate is a plan. */
export function usualPace(c: Cadence | null | undefined): string {
  return c && c.per_week > 0 && c.source === "all_tracked" ? oneDecimal(c.per_week) : "";
}

/** The plan's posts a week: the platforms' planned rates added up, so the tile equals its cards. */
export function plannedTotal(platforms: PagePlatform[]): number {
  const sum = platforms.filter((p) => p.state !== "not_now").reduce((s, p) => s + plannedRate(p.cadence), 0);
  return Math.round(sum * 10) / 10;
}

/** What the rate is per: impressions with Sprout, views in public. */
export const rateLabel = (kind: string | null | undefined) => (kind === "view" ? "per view" : "per impression");

/**
 * A goal as sentences: today's figure with what it measures ("0.5" and
 * "posts a week today") and the target ("Raise it above 0.5 by Feb 9, 2027").
 */
export function goalFigure(g: Goal): { figure: string; measure: string; target: string } {
  const by = dayWords(g.by);
  const unit = metricWords(g.metric);
  const verb = g.direction === "below" ? "Bring it below" : "Raise it above";
  if (g.baseline === null || g.baseline === undefined) return { figure: "", measure: `${capital(unit)} today: ${NOT_AVAILABLE}`, target: `${verb} today's level by ${by}` };
  const n = g.metric === "engagement_rate" ? percentOf(g.baseline) : figure(g.baseline);
  return { figure: n, measure: `${unit} today`, target: `${verb} ${n} by ${by}` };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Posts a competitor's read needs before its bars sit beside the brand's (the server's COMPETITOR_MIN_POSTS). */
export const COMPARABLE_MIN_POSTS = 8;

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
