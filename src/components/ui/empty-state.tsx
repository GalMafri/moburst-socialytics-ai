import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Standardized empty state: icon + heading + description + optional CTA.
 * Replaces "No data" plain-text placeholders.
 *
 * Usage:
 *   <EmptyState
 *     icon={Sparkles}
 *     title="No reports yet"
 *     description="Run your first analysis to see results here."
 *     action={<Button onClick={...}>Run analysis</Button>}
 *   />
 *
 * `compact` is the in-card form: a row with a small icon, for a list or a
 * tile that has nothing in it yet. On a page it stands framed on its own; as
 * the content of a card, pass `framed={false}` so it does not draw a second
 * frame inside the card's.
 */
interface Props {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  framed?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact = false, framed = true, className }: Props) {
  const frame = framed && "rounded-[12px] border border-dashed border-white/10 bg-[rgba(255,255,255,0.02)]";
  if (compact) {
    return (
      <div className={cn("flex items-start gap-3 text-left", framed ? "p-inner" : "", frame, className)}>
        <div className="h-9 w-9 shrink-0 rounded-full bg-[rgba(255,255,255,0.04)] flex items-center justify-center">
          <Icon className="h-4 w-4 text-[#b1b7c1]" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="t-h4">{title}</p>
          {description && <div className="t-secondary">{description}</div>}
          {action && <div className="pt-2 flex flex-wrap gap-2">{action}</div>}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-10 px-6", frame, className)}>
      <div className="h-12 w-12 rounded-full bg-[rgba(255,255,255,0.04)] flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-[#b1b7c1]" aria-hidden="true" />
      </div>
      <h3 className="t-h4">{title}</h3>
      {description && <div className="t-secondary mt-1.5 max-w-md">{description}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
