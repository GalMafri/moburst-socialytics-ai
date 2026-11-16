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
import { openSignIn } from "@/lib/signInTab";
import { useAuth } from "@/hooks/useAuth";

/** The one account strategy decks are made in and shared from. */
const DECK_ACCOUNT = "ai@moburst.com";

/** Why a sign-in that came back did not connect, in words (the short reason google-auth puts on the way back). */
const SIGN_IN_WORDS: Record<string, string> = {
  refused: "Google did not allow the sign-in.",
  bad_state: "A newer sign-in replaced this one.",
  expired: "The sign-in took too long to finish.",
  no_refresh_token: "Google did not give lasting access.",
  wrong_account: `That was not ${DECK_ACCOUNT}.`,
};
const SIGN_IN_UNFINISHED = "The sign-in did not finish.";

/** A sign-in that came back without connecting; a new object each time, so a later one shows again. */
export type SignInResult = { reason: string };

type Status = { ready: boolean; connected: boolean; account_email: string | null; connected_at: string | null };

/**
 * Connects Google Slides once, for the strategy decks (spec: docs/superpowers/
 * specs/2026-11-03-strategy-v2-design.md, section 4; the one-time Google
 * Cloud steps are in 2026-11-03-strategy-v2-google-setup.md). An admin signs
 * in as ai@moburst.com and allows access; each deck is then a new copy in
 * that account's Drive, shared with whoever asked. The sign-in is kept on the
 * server and is never shown here. Only an admin sees Connect; everyone else
 * is told Slides is unavailable. When a sign-in comes back without
 * connecting, Settings passes why and this card says it in words.
 */
export function GoogleSlidesConnection({ signInResult = null }: { signInResult?: SignInResult | null }) {
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState(false);
  /** The failed sign-in line is hidden once a new sign-in is started. */
  const [hiddenResult, setHiddenResult] = useState<SignInResult | null>(null);
  /** A sign-in that has not opened yet; the connection below is as it was. */
  const [notStarted, setNotStarted] = useState(false);
  /** The sign-in is open in its own tab (signInTab.ts). */
  const [opened, setOpened] = useState(false);
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
    setHiddenResult(signInResult);
    setNotStarted(false);
    setOpened(false);
    // Each start replaces the one before, so asking again is harmless.
    const ok = await openSignIn(async () => {
      const { data: started, error: startError } = await sendQuietly(
        () => supabase.functions.invoke("google-auth", { body: { action: "start" } }),
        { again: (e) => invokeResendable(e, { idempotent: true }) },
      );
      if (startError || !started?.authorize_url) {
        console.warn("[google sign-in] not started yet", startError ?? started);
        return null;
      }
      return started.authorize_url as string;
    });
    setBusy(false);
    // Google sends the new tab back to /settings; this panel checks again when the person comes back.
    if (ok) setOpened(true);
    else setNotStarted(true);
  };

  const connected = !!data?.connected;
  return (
    <Section
      layout="split"
      eyebrow="Strategy decks"
      title="Google Slides"
      description="Each client's strategy can be made into a Moburst-branded Google Slides deck, a new copy in ai@moburst.com's Drive shared with the person who asks."
      action={isAdmin && data?.ready ? (
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
            {!isAdmin
              ? "Slides is unavailable right now. Strategy PDFs work without it."
              : data?.ready
                ? `Sign in as ${DECK_ACCOUNT} to make Slides decks. Strategy PDFs work without them.`
                : "Slides decks are not available yet. Strategy PDFs work without them."}
          </p>
        </div>
      )}
      {notStarted && <p role="status" className="t-secondary">The sign-in has not opened yet. The connection above is unchanged.</p>}
      {signInResult && signInResult !== hiddenResult && !opened && (
        <p role="status" className="t-secondary">
          {SIGN_IN_WORDS[signInResult.reason] ?? SIGN_IN_UNFINISHED}
          {connected && " The connection above is unchanged."}
        </p>
      )}
      {opened && !connected && <p role="status" className="t-secondary">Google's sign-in is open in a new tab. Sign in as {DECK_ACCOUNT} there; this panel updates when you come back.</p>}
    </Section>
  );
}
