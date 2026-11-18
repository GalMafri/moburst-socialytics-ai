/**
 * "Sync from Sprout" on the staff dashboard, beside "Add client" (the owner,
 * 18 Nov 2026). Pressing it starts the run the weekly sync does, now. The
 * run is queued on the server and never two at once, so a press while one
 * is under way (the weekly one, or one another staff member started) starts
 * nothing and shows that run.
 *
 * The button is busy for as long as the server says a run is under way: it
 * is read when the dashboard opens and every ten seconds while a run is on,
 * so it stays across reloads and for everyone on staff. When the run this
 * page watched is over, one line says what it did, the client list is read
 * again, and the line stays until it is dismissed or the page is left.
 */

import { Link } from "react-router-dom";
import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SproutSync } from "@/hooks/useSproutSync";
import { addedLead, SYNC_BUSY, SYNC_LABEL, SYNC_SLOW } from "@/lib/sproutSync";

/** The button itself: busy while a run is under way. */
export function SproutSyncButton({ sync }: { sync: SproutSync }) {
  return (
    <Button variant="outline" onClick={sync.start} disabled={sync.busy} aria-busy={sync.busy}>
      {sync.busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      {sync.busy ? SYNC_BUSY : SYNC_LABEL}
    </Button>
  );
}

/** Under the page header: that a run is taking its time, or the one line a finished run leaves. */
export function SproutSyncLine({ sync }: { sync: SproutSync }) {
  if (sync.line) {
    const { added, text } = sync.line;
    return (
      <div role="status" className="glass-inner p-inner flex flex-wrap items-center justify-between gap-3">
        <p className="t-body">
          {added.length > 0 && (
            <>
              {addedLead(added.length)}{" "}
              {added.map((client, i) => (
                <span key={client.id}>
                  {i > 0 && ", "}
                  <Link
                    to={`/clients/${client.id}/setup`}
                    className="underline underline-offset-4 decoration-[rgba(255,255,255,0.35)] hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-[8px]"
                  >
                    {client.name}
                  </Link>
                </span>
              ))}
              .{text && " "}
            </>
          )}
          {text}
        </p>
        <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={sync.dismiss} aria-label="Dismiss"><X /></Button>
      </div>
    );
  }
  if (sync.slow) return <p role="status" className="t-secondary">{SYNC_SLOW}</p>;
  return null;
}
