import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { reflowParagraph, withoutUrls } from "@/lib/prose";

/**
 * Renders AI-written passages in full, structured for reading instead of
 * truncated: paragraphs split on blank lines, a short "Label:" lead-in is
 * bolded, and inline enumerations such as "(1) … (2) …" or "1) … 2) …"
 * become a list, and a slab of a paragraph is regrouped on sentence boundaries
 * so it has somewhere to breathe. Text is 15px/25px white (see .t-prose).
 */
// A lead-in such as "Cadence:" or "Engagement efficiency (RivalIQ rate per
// post):". Long enough to keep the parenthetical some of these carry — a label
// that runs long simply wraps in its column.
const LEAD = /^([A-Z][^.:;!?]{1,64}):\s+(?=\S)/;

export function Prose({ text, className, cards = true }: { text: string | null | undefined; className?: string; cards?: boolean }) {
  if (!text) return null;
  // Cited links are dropped: nothing here renders a URL as a link, so they sit
  // in the middle of a sentence as a line of unreadable characters, and where a
  // passage cites posts the page shows those posts as tiles anyway.
  const paragraphs = withoutUrls(String(text))
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[.)]))/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Labelled paragraphs ("Scope: …", "Cadence: …") are a briefing, so they are
  // laid out as one: the figure the passage turns on pulled out at stat size
  // with its label under it, the passage beside it, a hairline between rows.
  //
  // They used to be a grid of cards, which is what a wall of text looks like
  // when you put boxes around it: the cards in a row all stretched to the
  // tallest, so a two-line note sat in a six-line box. Then a plain label
  // column, which still read as a slab, because these passages are numbers
  // carried in sentences and nothing in them stood up.
  const leads = paragraphs.map((p) => p.match(LEAD));
  if (cards && paragraphs.length >= 2 && leads.filter(Boolean).length >= Math.ceil(paragraphs.length * 0.75)) {
    return (
      <dl className={cn("divide-y divide-[rgba(255,255,255,0.06)]", className)}>
        {paragraphs.map((p, i) => {
          const m = leads[i];
          // A parenthetical belongs under the label, not in it, where
          // "Engagement efficiency (RivalIQ engagement rate per post)" wraps to
          // four lines beside two lines of text.
          const full = m ? m[1] : null;
          const cut = full ? full.indexOf(" (") : -1;
          const title = full ? (cut > 0 ? full.slice(0, cut) : full) : null;
          const aside = full && cut > 0 ? full.slice(cut + 2).replace(/\)\s*$/, "") : "";
          const body = m ? p.slice(m[0].length) : p;
          const lead = title ? leadFigure(body) : null;
          return (
            <div key={i} className="grid gap-2 py-5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,150px)_minmax(0,1fr)] md:gap-8">
              {title && (
                <dt className="min-w-0">
                  {lead && (
                    // The unit sits on its own line rather than beside the
                    // number: "30 days" fits in the column and "41,317
                    // engagements" does not, and a unit that wraps on some rows
                    // and not others is what makes a column look accidental.
                    <p className="text-[28px] leading-[32px] font-bold tracking-[-0.5px] tabular-nums text-white">
                      {lead.value}
                      {lead.unit && (
                        <span className="block text-[13px] leading-[18px] font-normal tracking-normal text-[#9ca3af]">
                          {lead.unit}
                        </span>
                      )}
                    </p>
                  )}
                  <p className={cn("t-subhead", lead ? "mt-2" : "md:pt-[3px]")}>
                    {title}
                  </p>
                  {aside && <p className="t-label !text-[#6b7280]">{aside}</p>}
                </dt>
              )}
              {/* Capped so a long passage keeps a readable measure instead of
                  running the full width of the card. 66ch measures ~88 real
                  characters a line here, since `ch` is the width of a zero and
                  Geist's average glyph is narrower than that. */}
              <dd className={cn("t-body min-w-0 max-w-[66ch] leading-[1.65]", !title && "md:col-span-2")}>
                {title ? body : <Paragraph text={p} />}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }
  // One column, at a measure you can read. These passages used to flow into
  // CSS columns to fill the width of the card, but a paragraph cut into three
  // equal stacks is not a layout — you read down, up, down, up, for what was
  // written as one thought. A slab is still broken on sentence boundaries, so
  // it arrives as paragraphs rather than a block: no words change, only where
  // the breaks fall.
  const blocks = paragraphs.flatMap((p) => reflowParagraph(p));
  return (
    <div className={cn("t-prose space-y-3", className)}>
      {blocks.map((p, i) => (
        <Paragraph key={i} text={p} />
      ))}
    </div>
  );
}

// Enumerator candidates: "(1) ", "1) " or "1. " at the start or after whitespace, never
// glued to a time or number such as "18:00)" or "3.5".
const ENUM_CANDIDATE = /(^|\s)(?:\((\d{1,2})\)|(\d{1,2})\)|(\d{1,2})\.)(?=\s+\S)/g;

/** Splits "intro (1) a (2) b" into { intro, items } only when the markers run 1, 2, 3… in order. */
function splitEnumeration(text: string): { intro: string; items: string[] } | null {
  const marks: { index: number; end: number; n: number }[] = [];
  for (const m of text.matchAll(ENUM_CANDIDATE)) {
    const n = Number(m[2] ?? m[3] ?? m[4]);
    marks.push({ index: m.index! + m[1].length, end: m.index! + m[0].length, n });
  }
  const seq = marks.filter((m, i) => m.n === i + 1);
  if (seq.length < 2 || seq.length !== marks.length) return null;
  const intro = text.slice(0, seq[0].index).trim();
  const items = seq.map((m, i) => text.slice(m.end, i + 1 < seq.length ? seq[i + 1].index : undefined).trim()).filter(Boolean);
  return items.length >= 2 ? { intro, items } : null;
}

function Paragraph({ text }: { text: string }) {
  // Inline enumeration: "(1) … (2) …" / "1) … 2) …" / "1. … 2. …" with at least two items in order.
  const enumerated = splitEnumeration(text);
  const items = enumerated?.items ?? [];
  const intro = enumerated?.intro ?? "";
  if (items.length >= 2) {
    return (
      <div className="space-y-2">
        {intro.trim() && <p>{withLead(intro.trim())}</p>}
        <ol className="space-y-2 pl-1">
          {items.map((it, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-[rgba(185,224,69,0.15)] text-[#b9e045] t-label font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <span className="min-w-0">{withLead(it)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  // Bullet lines pasted as one paragraph
  const bullet = text.match(/^[-•*]\s+/);
  if (bullet) {
    return (
      <p className="flex gap-3">
        <span className="text-[#b9e045] mt-[2px]">•</span>
        <span className="min-w-0">{withLead(text.replace(/^[-•*]\s+/, ""))}</span>
      </p>
    );
  }
  return <p>{withLead(text)}</p>;
}

/**
 * A figure inside a passage: a whole date, or a number with its sign, decimals
 * and any %/K/M/B suffix. Dates are matched whole so a day does not come apart
 * into three pieces.
 */
const FIGURE = /(\d{4}-\d{2}-\d{2}|[+\-−]?\d[\d,]*(?:\.\d+)?\s?(?:%|[KMB]\b)?)/g;

/**
 * The figure a passage turns on, for the stat beside it.
 *
 * The first one that is neither a date nor a bare year, since these passages
 * open on the period they cover ("2026-07-01 to 2026-07-31 (30 days), 226
 * posts…") and the date is never the point. The word after it comes along when
 * it reads as a unit, so "30" arrives as "30 days".
 */
const UNIT_STOPWORDS = new Set([
  "to", "of", "vs", "and", "in", "on", "at", "from", "the", "a", "per", "with", "for", "by",
  "is", "was", "across", "over", "under", "than", "up", "down", "while", "but", "against",
]);
/** Words that describe the count rather than name it: the unit is the next one. */
const UNIT_QUALIFIERS = new Set(["total", "overall", "average", "avg", "combined", "net", "new"]);

export function leadFigure(text: string): { value: string; unit: string } | null {
  for (const m of text.matchAll(FIGURE)) {
    const value = m[1].trim();
    if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    if (/^\d{4}$/.test(value) && Number(value) > 1900 && Number(value) < 2100) continue;
    const after = text
      .slice((m.index ?? 0) + m[1].length)
      .match(/^\s*([A-Za-z][A-Za-z/-]{1,11})(?:\s+([A-Za-z][A-Za-z/-]{1,11}))?\b/);
    let word = after?.[1] ?? "";
    if (UNIT_QUALIFIERS.has(word.toLowerCase())) word = after?.[2] ?? "";
    const unit = word && !UNIT_STOPWORDS.has(word.toLowerCase()) ? word : "";
    return { value, unit };
  }
  return null;
}

/**
 * Figures set in white so the eye can land on them.
 *
 * These passages are numbers carried in sentences — "30/54 posts (56%) across
 * channels, and on Instagram 9/17 (53%)" — and at one weight and one colour
 * the whole thing is a grey slab whatever the measure.
 */
function Figures({ text }: { text: string }): ReactNode {
  const parts = text.split(FIGURE);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-white font-medium tabular-nums">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** "Volume/cadence: the rest" → bold "Volume/cadence:" followed by the rest. */
function withLead(s: string): ReactNode {
  const m = s.match(/^([A-Z][^.:;!?]{1,42}):\s+(?=\S)/);
  if (!m) return <Figures text={s} />;
  return (
    <>
      <strong className="font-semibold text-white">{m[1]}:</strong> <Figures text={s.slice(m[0].length)} />
    </>
  );
}
