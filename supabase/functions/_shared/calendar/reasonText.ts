// supabase/functions/_shared/calendar/reasonText.ts
//
// How a planned post's reason reads (weekly calendar, Lital 19 Oct 2026).
// A plan stores what a reason is made of: its type, the evidence the post
// acts on with the real numbers, the sentence on why it fits, the moment for
// a seasonal post, and whether it is the week's test. The words are put
// together here when the reason is shown, so a change to how reasons read
// reaches every post without rewriting stored rows. The week planner and the
// app both import this file, so it imports nothing.

export type ReasonType = "performance" | "competitor" | "trend" | "seasonal" | "test";

/** A piece of evidence as a post's reason keeps it (the planner's EvidenceItem). */
export interface EvidenceRef {
  id: string;
  kind: "own" | "competitor" | "topic" | "trend" | "report";
  text: string;
  platform?: string;
  company?: string;
  format?: string;
  date?: string;
  link?: string | null;
  metric?: string;
  value?: number;
  median?: number;
  multiple?: number;
  sample?: number;
  thin?: boolean;
  companies?: number;
}

export interface Reason {
  type: ReasonType;
  /** The words when the post was planned; shown only for posts that don't carry their parts. */
  label: string;
  fit?: string;
  evidence?: EvidenceRef[];
  thin?: boolean;
  /** A seasonal post's moment and its date ("Halloween on Oct 31"). */
  moment?: string;
  /** The week's one test. Stored on every planned post since 19 Oct 2026, so its reason can be worded when shown. */
  test?: boolean;
}

export function fmtMultiple(m: number): string {
  return `${Number.isInteger(m) ? m : m.toFixed(1)}x`;
}

const FORMAT_WORDS: Record<string, string> = {
  photo: "image post", image: "image post", single_image: "image post", "single image": "image post", video: "video", reel: "reel", "reel/video": "reel",
  carousel: "carousel", album: "carousel", document: "document post", link: "link post", status: "text post", text: "text post", short: "short",
};

function formatWord(f?: string): string {
  const key = String(f || "").toLowerCase().trim();
  return FORMAT_WORDS[key] ?? (key && key !== "unknown" ? key : "post");
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A report finding's headline. The report writes findings as "claim: evidence";
 * a short label before the colon (such as "TikTok") is not a claim, so the
 * first sentence is used instead.
 */
export function headline(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "").trim();
  const [claim, rest] = [first.split(":")[0].trim(), first.includes(":")];
  return rest && claim.split(/\s+/).length >= 3 ? claim : first;
}

/**
 * The model's "why it fits", as a client reads it: its first sentence, kept
 * only when it names no evidence id and is short. Planner notes ("doesn't
 * repeat this week's topics") don't survive the first-sentence rule.
 */
export function clientFit(fit: string | undefined): string | undefined {
  const first = String(fit ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (!first || /\b[PCTNR]\d{1,2}\b/.test(first) || first.length > 180) return undefined;
  return first;
}

/** The first sentence of a reason, from the first piece of evidence it cites. */
export function evidenceSentence(e: EvidenceRef): string {
  const when = shortDate(e.date);
  switch (e.kind) {
    case "own":
      return `Your ${e.platform} ${formatWord(e.format)}${when ? ` from ${when}` : ""} got ${fmtMultiple(e.multiple ?? 0)} your usual ${e.metric}`;
    case "competitor":
      return `${e.company}'s ${e.platform} ${formatWord(e.format)}${when ? ` from ${when}` : ""} got ${fmtMultiple(e.multiple ?? 0)} their usual ${e.metric}`;
    case "topic": {
      const topic = e.text.split(":")[0].trim();
      return e.companies && e.companies > 1 ? `${e.companies} competitors posted about ${topic} this week` : `Competitors posted about ${topic} this week`;
    }
    case "trend":
      return `Trend from the monthly report: ${headline(e.text)}`;
    case "report":
      return `From the monthly report: ${headline(e.text)}`;
    default:
      return "";
  }
}

/** What a reason's words are made from. */
export interface ReasonParts {
  type?: string;
  evidence?: EvidenceRef[];
  fit?: string;
  moment?: string;
  test?: boolean;
}

/** A reason in words: the evidence with its real numbers (or the moment), then why it fits. */
export function reasonLabel(parts: ReasonParts): string {
  const evidence = parts.evidence ?? [];
  const first = evidence[0];
  const base = (first && evidenceSentence(first)) || parts.moment?.trim() || (parts.type === "seasonal" ? "A dated moment this week" : "Planned from your content pillars");
  const fit = clientFit(parts.fit);
  return [
    parts.test ? "Test: " : "",
    base.replace(/[.\s]+$/, ""),
    ".",
    fit ? ` ${fit.replace(/[.\s]+$/, "")}.` : "",
    evidence.some((e) => e.thin) ? " Early signal." : "",
  ].join("").slice(0, 400);
}

/** A reason as stored on a calendar post, by the planner or by a person. */
export interface StoredReason {
  type?: string;
  label?: string;
  fit?: string;
  evidence?: EvidenceRef[];
  moment?: string;
  test?: boolean;
}

/**
 * The words a stored reason shows. A reason that carries its parts (a week
 * plan's post) is worded from them now; anything else (a post someone added,
 * an idea from the competitor feed, a plan written before its parts were
 * kept) shows the label it was saved with.
 */
export function wordReason(r: StoredReason | null | undefined): string {
  if (!r) return "";
  const evidence = Array.isArray(r.evidence) ? r.evidence : [];
  if (!evidence.length && typeof r.test !== "boolean") return String(r.label ?? "");
  return reasonLabel({ type: r.type, evidence, fit: r.fit, moment: r.moment, test: r.test ?? r.type === "test" });
}
