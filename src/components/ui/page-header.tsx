import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The intro block every page opens with: title (24px), one line of context,
 * optional meta chips (platforms, period) and the page's actions on the right.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 space-y-1.5">
        {back}
        <h1 className="t-h1">{title}</h1>
        {description && <p className="t-secondary max-w-3xl">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
