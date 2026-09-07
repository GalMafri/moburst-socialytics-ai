import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Change } from "@/lib/competitiveChanges";

/** Movements since the previous period, one card each: who, what moved, by how much. */
export function ChangeCards({ changes, className }: { changes: Change[]; className?: string }) {
  if (!changes.length) return null;
  return (
    <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-3", className)}>
      {changes.map((c, i) => {
        const Icon = c.direction === "up" ? ArrowUpRight : c.direction === "down" ? ArrowDownRight : Minus;
        const colour = c.tone === "good" ? "text-success" : c.tone === "bad" ? "text-destructive" : "text-[#b1b7c1]";
        return (
          <article key={i} className={cn("glass-inner p-4 flex items-start gap-3 min-w-0", c.is_client && "border-[rgba(185,224,69,0.35)]")}>
            <Icon className={cn("h-5 w-5 flex-shrink-0 mt-0.5", colour)} aria-hidden />
            <div className="min-w-0 space-y-1.5">
              <p className="t-subhead">
                {c.company}
                {c.is_client && <span className="text-[#b9e045]"> · client</span>}
              </p>
              <h3 className="t-body font-semibold text-white leading-snug">{c.headline}</h3>
              <p className="t-body">{c.detail}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
