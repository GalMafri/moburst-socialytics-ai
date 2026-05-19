import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Consistent loading affordance with a labelled spinner. Use anywhere a
 * page or section is fetching data — replaces ad-hoc "Loading..." text
 * scattered across pages.
 *
 * The label is also announced to assistive tech via aria-live="polite".
 */
interface Props {
  label?: string;
  /** "page" centers in viewport; "inline" sits in flow. Default "inline". */
  variant?: "inline" | "page";
  className?: string;
}

export function Loading({ label = "Loading", variant = "inline", className }: Props) {
  if (variant === "page") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn("flex min-h-[40vh] items-center justify-center", className)}
      >
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{label}…</span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-muted-foreground", className)}
    >
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}…</span>
    </div>
  );
}
