import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders AI-written passages in full, structured for reading instead of
 * truncated: paragraphs split on blank lines, a short "Label:" lead-in is
 * bolded, and inline enumerations such as "(1) … (2) …" or "1) … 2) …"
 * become a list. Text is 16px/26px white at a 72ch measure (see .t-prose).
 */
export function Prose({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  const paragraphs = String(text)
    .split(/\n{2,}|\n(?=\s*(?:[-•*]|\d+[.)]))/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={cn("t-prose space-y-3", className)}>
      {paragraphs.map((p, i) => (
        <Paragraph key={i} text={p} />
      ))}
    </div>
  );
}

const ENUM_SPLIT = /\s*(?:\((\d{1,2})\)|(?<![\d.])(\d{1,2})\)|(?<![\w])(\d{1,2})\.(?=\s[A-Z]))\s+/;

function Paragraph({ text }: { text: string }) {
  // Inline enumeration: "(1) … (2) …" / "1) … 2) …" / "1. … 2. …" with at least two items.
  const parts = text.split(ENUM_SPLIT).filter((s) => s !== undefined);
  const items: string[] = [];
  let intro = "";
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (/^\d{1,2}$/.test(s)) {
      const body = (parts[i + 1] || "").trim();
      if (body) items.push(body);
      i++;
    } else if (items.length === 0 && s.trim()) {
      intro += s;
    }
  }
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
