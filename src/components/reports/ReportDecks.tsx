// The finished decks on a social or competitive report (report_decks), saved
// from Claude by Moburst staff (two-way sync with Claude, docs/superpowers/
// specs/2026-11-03-claude-sync-design.md). Anyone who can see the report sees
// its decks, the client included; row level security decides. Newest first.
// A deck file opens through a short-lived link made for the person; a
// Google Slides or Drive deck opens its own link. Shows nothing while a
// report has no decks, and a read that does not answer is tried again
// quietly.

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Presentation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { deckAddedLine } from "@/lib/display";
import { sendQuietly } from "@/lib/quietSend";

export interface ReportDeck {
  id: string;
  title: string;
  kind: string;
  file_path: string | null;
  link: string | null;
  source: string;
  added_by_name: string | null;
  created_at: string;
}

const BUCKET = "report-decks";
/** How long the link to a deck file lasts: long enough to open it. */
const FILE_LINK_SECONDS = 600;

/** Opens a deck in a new tab: its own link, or a short-lived link to its file. */
export async function openDeck(deck: ReportDeck): Promise<void> {
  if (deck.link) {
    window.open(deck.link, "_blank", "noopener,noreferrer");
    return;
  }
  if (!deck.file_path) return;
  // The tab opens on the click, so the browser lets it; the file's link follows.
  const tab = window.open("", "_blank");
  const { data, error } = await sendQuietly(() => supabase.storage.from(BUCKET).createSignedUrl(deck.file_path!, FILE_LINK_SECONDS), { again: () => true });
  if (error || !data?.signedUrl) {
    console.warn("[report decks] no link to the file yet", deck.id, error);
    tab?.close();
    return;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export function ReportDecks({ reportId, kind, timeZone }: { reportId: string; kind: "social" | "competitive"; timeZone?: string }) {
  const { isMoburstStaff } = useAuth();
  const { data: decks } = useQuery({
    queryKey: ["report-decks", kind, reportId],
    enabled: !!reportId,
    retry: 3,
    queryFn: async () => {
      const { data, error } = await supabase.from("report_decks")
        .select("id, title, kind, file_path, link, source, added_by_name, created_at")
        .eq(kind === "social" ? "report_id" : "competitive_report_id", reportId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReportDeck[];
    },
  });
  if (!decks?.length) return null;
  return (
    <section data-print="hide" aria-label="Decks" className="glass p-card space-y-3">
      <h2 className="t-h4 flex items-center gap-2"><Presentation className="h-4 w-4" aria-hidden /> {decks.length === 1 ? "Deck" : "Decks"}</h2>
      <ul className="space-y-2">
        {decks.map((d) => (
          <li key={d.id} className="glass-inner p-inner flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0 space-y-0.5">
              <p className="t-body truncate">{d.title}</p>
              <p className="t-label">{deckAddedLine(d, { staff: isMoburstStaff, timeZone })}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void openDeck(d)} aria-label={`Open ${d.title}`}>
              <ExternalLink aria-hidden /> Open
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
