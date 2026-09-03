import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders AI-written passages in full, structured for reading instead of
 * truncated: paragraphs split on blank lines, a short "Label:" lead-in is
 * bolded, and inline enumerations such as "(1) … (2) …" or "1) … 2) …"
 * become a list. Text is 16px/26px white at a 72ch measure (see .t-prose).
 */
export function Prose({ text, className, columns = true }: { text: string | null | undefined; className?: string; columns?: boolean }) {
  if (!text) return null;
  const flow = columns && String(text).length > 600;
  const paragraphs = String(text)
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[.)]))/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={cn("t-prose", flow ? "max-w-none columns-[38rem] gap-x-10 [&>*]:break-inside-avoid [&>*+*]:mt-3" : "space-y-3", className)}>
      {paragraphs.map((p, i) => (
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
