import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { reflowParagraph } from "@/lib/prose";

/**
 * Renders AI-written passages in full, structured for reading instead of
 * truncated: paragraphs split on blank lines, a short "Label:" lead-in is
 * bolded, and inline enumerations such as "(1) … (2) …" or "1) … 2) …"
 * become a list, and a long paragraph in a column flow is regrouped on sentence
 * boundaries so it can fill the columns. Text is 15px/25px white (see .t-prose).
 */
// A lead-in such as "Cadence:" or "Engagement efficiency (RivalIQ rate per
// post):". Long enough to keep the parenthetical some of these carry — a label
// that runs long simply wraps in its column.
const LEAD = /^([A-Z][^.:;!?]{1,64}):\s+(?=\S)/;

export function Prose({ text, className, columns = true, cards = true }: { text: string | null | undefined; className?: string; columns?: boolean; cards?: boolean }) {
  if (!text) return null;
  // Short passages used to sit at a capped measure on a full-width card, which
  // left a third of the card empty beside them. They flow into columns too now;
  // the floor is where a passage has enough lines to make a column worth having.
  const flow = columns && String(text).length > 280;
  const paragraphs = String(text)
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[.)]))/)
    .map((p) => p.trim())
    .filter(Boolean);
  // Labelled paragraphs ("Scope: …", "Cadence: …") are a briefing, so they are
  // laid out as one: the label in its own narrow column, the passage beside it,
  // a hairline between rows.
  //
  // They used to be a grid of cards, which is what a wall of text looks like
  // when you put boxes around it: the cards in a row all stretched to the
  // tallest, so a two-line note sat in a six-line box, and a passage whose
  // lead-in did not match came out untitled beside titled neighbours. A list
  // has no such rows to fill.
  const leads = paragraphs.map((p) => p.match(LEAD));
  if (cards && paragraphs.length >= 2 && leads.filter(Boolean).length >= Math.ceil(paragraphs.length * 0.75)) {
    return (
      <dl className={cn("divide-y divide-[rgba(255,255,255,0.06)]", className)}>
        {paragraphs.map((p, i) => {
          const m = leads[i];
          const title = m ? m[1] : null;
          const body = m ? p.slice(m[0].length) : p;
          return (
            <div key={i} className="grid gap-1 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)] md:gap-8">
              {title && <dt className="t-label uppercase tracking-wider md:pt-[3px]">{title}</dt>}
              {/* Capped so a long passage keeps a readable measure instead of
                  running the full width of the card. */}
              <dd className={cn("t-body min-w-0 max-w-[78ch]", !title && "md:col-span-2")}>
                {title ? body : <Paragraph text={p} />}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }
  // In a column flow a slab of prose has to be broken on sentence boundaries or
  // it cannot move between columns: it fills the first one and leaves the rest
  // of the card empty. No words change, only where the paragraphs fall.
  const blocks = flow ? paragraphs.flatMap((p) => reflowParagraph(p)) : paragraphs;
  return (
    <div className={cn("t-prose", flow ? cn("max-w-none columns-[21rem] gap-x-10 [&>*+*]:mt-3", blocks.length > 1 && "[&>*]:break-inside-avoid") : "space-y-3", className)}>
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

/** "Volume/cadence: the rest" → bold "Volume/cadence:" followed by the rest. */
function withLead(s: string): ReactNode {
  const m = s.match(/^([A-Z][^.:;!?]{1,42}):\s+(?=\S)/);
  if (!m) return s;
  return (
    <>
      <strong className="font-semibold text-white">{m[1]}:</strong> {s.slice(m[0].length)}
    </>
  );
}
