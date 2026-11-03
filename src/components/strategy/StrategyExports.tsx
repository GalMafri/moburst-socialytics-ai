/**
 * The strategy's exports (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
 * design.md, section 4): the PDF, from the page itself, which works whatever
 * Google's state; and a Google Slides deck, a new copy in ai@moburst.com's
 * Drive shared with whoever asks. The deck button says what is true: the
 * deck being made, the deck made on a date with Open, "Make a new deck" when
 * the strategy or a person's version changed since, or, until an admin
 * connects Google once in Settings, that Google Slides is not connected yet.
 * A request that does not get through is sent again quietly.
 */

import { useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Presentation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ExportPdfButton } from "@/components/reports/ExportPdfButton";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { madeOn } from "@/lib/strategyView";

export interface DeckExport {
  id: string;
  status: string;
  url: string | null;
  strategy_written_at: string;
  edits_at: string | null;
  made_at: string | null;
  created_at: string;
}

/** What the deck button says and does, from Google's state, the exports and the strategy. */
export function deckState(a: { connected: boolean | null; exports: DeckExport[]; writtenAt: string; newestEdit: string | null }):
  | { kind: "not_connected" } | { kind: "making" } | { kind: "made"; url: string; on: string } | { kind: "stale"; url: string; on: string } | { kind: "none" } {
  const latest = a.exports[0];
  if (latest && (latest.status === "queued" || latest.status === "making")) return { kind: "making" };
  if (a.connected === false) return { kind: "not_connected" };
  const done = a.exports.find((e) => e.status === "done" && e.url);
  if (!done) return { kind: "none" };
  const changed = Date.parse(done.strategy_written_at) !== Date.parse(a.writtenAt) || (!!a.newestEdit && (!done.edits_at || Date.parse(a.newestEdit) > Date.parse(done.edits_at)));
  return { kind: changed ? "stale" : "made", url: done.url as string, on: madeOn(done.made_at ?? done.created_at) };
}

export function StrategyExports({ clientId, client, writtenAt, newestEdit, contentRef }: {
  clientId: string;
  client: string;
  writtenAt: string;
  newestEdit: string | null;
  contentRef: RefObject<HTMLDivElement>;
}) {
  const [asking, setAsking] = useState(false);
  const google = useQuery({
    queryKey: ["google-status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-auth", { body: { action: "status" } });
      if (error || data?.error) throw error ?? new Error(String(data.error));
      return data as { ready: boolean; connected: boolean };
    },
    staleTime: 60_000,
  });
  const exports = useQuery({
    queryKey: ["strategy-exports", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategy_exports")
        .select("id, status, url, strategy_written_at, edits_at, made_at, created_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as DeckExport[];
    },
    // While a deck is being made, look again every few seconds.
    refetchInterval: (q) => ((q.state.data ?? []).some((e: DeckExport) => e.status === "queued" || e.status === "making") ? 5000 : false),
  });

  const state = deckState({ connected: google.data ? google.data.connected : null, exports: exports.data ?? [], writtenAt, newestEdit });
  const ask = async () => {
    setAsking(true);
    const { error } = await sendQuietly(() => supabase.rpc("strategy_deck_request", { p_client: clientId }), { again: writeResendable });
    if (error) console.warn("[strategy deck] not asked yet", error);
    await exports.refetch();
    setAsking(false);
  };

  return (
    <div className="flex flex-col items-start gap-1.5 lg:items-end" data-print="hide">
      <div className="flex flex-wrap items-center gap-2">
        <ExportPdfButton contentRef={contentRef} filename={`${client} Social Strategy`} title={`${client} | Social Strategy`} />
        {state.kind === "making" || asking ? (
          <Button size="sm" disabled><Loader2 className="animate-spin" /> Making the deck</Button>
        ) : state.kind === "made" ? (
          <Button size="sm" variant="outline" asChild>
            <a href={state.url} target="_blank" rel="noopener noreferrer"><Presentation /> Open the Google Slides deck</a>
          </Button>
        ) : state.kind === "stale" ? (
          <>
            <Button size="sm" onClick={() => void ask()}><Presentation /> Make a new deck</Button>
            <a className="t-link inline-flex items-center gap-1" href={state.url} target="_blank" rel="noopener noreferrer">Open the deck {state.on} <ExternalLink className="h-3 w-3" aria-hidden /></a>
          </>
        ) : (
          <Button size="sm" onClick={() => void ask()} disabled={state.kind === "not_connected"}><Presentation /> Google Slides deck</Button>
        )}
      </div>
      {state.kind === "made" && <p className="t-label">Google Slides deck, {state.on}</p>}
      {state.kind === "not_connected" && <p className="t-label">Google Slides is not connected yet. An admin connects it once in Settings. The PDF works now.</p>}
    </div>
  );
}
