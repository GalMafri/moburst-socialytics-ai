import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PLAIN_MESSAGE = "The request did not complete. Your connection or the server may be having a moment.";

/**
 * A query that failed, said so.
 *
 * Pages used to render a failed load as an empty state, which asserts
 * something true of the data on the strength of a request that never
 * answered. Kept separate from EmptyState so the two can never be confused at
 * a call site: this one carries a way to try again, and an empty state never
 * should.
 *
 * A thrown error's own text (a raw Supabase or network message) goes to the
 * console for the team and is never shown: everyone reads the plain
 * sentence. A string passed as `error` is copy written for the reader and is
 * shown as it is.
 */
export function LoadError({
  title = "That did not load",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const raw =
    error instanceof Error && error.message
      ? error.message
      : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "";
  if (raw) console.error("[load failed]", raw);
  const message = typeof error === "string" && error ? error : PLAIN_MESSAGE;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center text-center py-10 px-6 rounded-lg border border-dashed border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.06)]",
        className,
      )}
    >
      <div className="h-12 w-12 rounded-full bg-[rgba(239,68,68,0.10)] flex items-center justify-center mb-3">
        <AlertTriangle className="h-6 w-6 text-[rgb(248,113,113)]" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}
