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
 *     action={<Button onClick={...}>Run Analysis</Button>}
 *   />
 */
interface Props {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-10 px-6 rounded-lg border border-dashed border-white/10 bg-[rgba(255,255,255,0.02)]",
        className,
      )}
    >
      <div className="h-12 w-12 rounded-full bg-[rgba(255,255,255,0.04)] flex items-center justify-center mb-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
