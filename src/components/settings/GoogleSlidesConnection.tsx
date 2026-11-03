import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, LinkIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { formatDate } from "@/lib/display";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";

/** The one account strategy decks are made in and shared from. */
const DECK_ACCOUNT = "ai@moburst.com";

type Status = { ready: boolean; connected: boolean; account_email: string | null; connected_at: string | null };

/**
 * Connects Google Slides once, for the strategy decks (spec: docs/superpowers/
 * specs/2026-11-03-strategy-v2-design.md, section 4; the one-time Google
 * Cloud steps are in 2026-11-03-strategy-v2-google-setup.md). An admin signs
 * in as ai@moburst.com and allows access; each deck is then a new copy in
 * that account's Drive, shared with whoever asked. The sign-in is kept on the
 * server and is never shown here.
 */
export function GoogleSlidesConnection() {
  const [busy, setBusy] = useState(false);
  /** A sign-in that has not opened yet; the connection below is as it was. */
  const [notStarted, setNotStarted] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["google-status"],
    queryFn: async (): Promise<Status> => {
      const { data, error } = await supabase.functions.invoke("google-auth", { body: { action: "status" } });
      if (error || data?.error) throw error ?? new Error(String(data.error));
      return data as Status;
    },
  });

  const connect = async () => {
    setBusy(true);
    setNotStarted(false);
    // Each start replaces the one before, so asking again is harmless.
    const { data: started, error: startError } = await sendQuietly(
      () => supabase.functions.invoke("google-auth", { body: { action: "start" } }),
      { again: (e) => invokeResendable(e, { idempotent: true }) },
    );
    if (startError || !started?.authorize_url) {
      console.warn("[google sign-in] not started yet", startError ?? started);
      setBusy(false);
      setNotStarted(true);
      return;
    }
    // Leaves the app. Google sends the browser back to /settings.
    window.location.href = started.authorize_url as string;
  };

  const connected = !!data?.connected;
  return (
    <Section
      layout="split"
      eyebrow="Strategy decks"
      title="Google Slides"
      description="Each client's strategy can be made into a Moburst-branded Google Slides deck, a new copy in ai@moburst.com's Drive shared with the person who asks."
      action={data?.ready ? (
        <Button onClick={connect} disabled={busy} variant={connected ? "outline" : "default"} size="sm">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
          {connected ? "Sign in again" : "Connect Google Slides"}
        </Button>
      ) : undefined}
    >
      {isLoading ? (
        <Loading label="Checking the Google connection" />
      ) : isError ? (
        <LoadRetry context="google connection" error={error} label="Checking the Google connection" onRetry={() => refetch()} />
      ) : connected ? (
        <div className="glass-inner p-inner space-y-1.5">
          <p className="t-h4 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#b9e045]" aria-hidden="true" />
            Connected as {data?.account_email ?? DECK_ACCOUNT}
          </p>
          {data?.connected_at && <p className="t-label">Signed in on {formatDate(data.connected_at)}.</p>}
        </div>
      ) : (
        <div className="glass-inner p-inner space-y-1.5">
          <p className="t-h4">Not connected yet</p>
          <p className="t-secondary">
            {data?.ready
              ? `Connect, sign in as ${DECK_ACCOUNT} and allow access. Strategy PDFs work without it.`
              : "The one-time Google Cloud setup for ai@moburst.com comes first; Connect appears here once it is done. Strategy PDFs work without it."}
          </p>
        </div>
      )}
      {notStarted && <p role="status" className="t-secondary">The sign-in has not opened yet. The connection above is unchanged.</p>}
    </Section>
  );
}
