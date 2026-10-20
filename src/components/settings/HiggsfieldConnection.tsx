import { useState } from "react";
import { formatDate } from "@/lib/display";
import { useQuery } from "@tanstack/react-query";
import { Section } from "@/components/ui/section";
import { Loading } from "@/components/ui/loading";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, LinkIcon, AlertTriangle } from "lucide-react";

/** The one account the team links, so a person can check they signed in as the right one. */
const EXPECTED_ACCOUNT = "social-team@moburst.com";

type Status = { linked: boolean; account_email: string | null; linked_at: string | null };

/**
 * Links the team's Higgsfield account.
 *
 * Higgsfield's MCP has no machine credential, so a person signs in once and
 * the refresh token that comes back is what the server uses from then on.
 * That token can stop working without warning — a password change or a
 * revoked session ends it — and when it does, generation stops until someone
 * signs in again. This is that door: without it the only way back is a
 * developer with a console.
 */
export function HiggsfieldConnection() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["higgsfield-status"],
    queryFn: async (): Promise<Status> => {
      const { data, error } = await supabase.functions.invoke("higgsfield-auth", { body: { action: "status" } });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      return data as Status;
    },
  });

  const connect = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("higgsfield-auth", { body: { action: "start" } });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      if (!data?.authorize_url) throw new Error("The server did not return a sign-in link.");
      // Leaves the app. Higgsfield sends the browser back to /settings.
      window.location.href = data.authorize_url as string;
    } catch (err) {
      setBusy(false);
      toast({
        title: "Could not start the sign-in",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const linked = !!data?.linked;
  const wrongAccount = linked && !!data?.account_email && data.account_email !== EXPECTED_ACCOUNT;

  return (
    <Section
      layout="split"
      eyebrow="Generation"
      title="Higgsfield"
      description="Image and video generation runs through the team's Higgsfield account."
      action={
        <Button onClick={connect} disabled={busy} variant={linked ? "outline" : "default"} size="sm">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LinkIcon aria-hidden="true" />}
          {linked ? "Sign in again" : "Connect Higgsfield"}
        </Button>
      }
    >
        {isLoading ? (
          <Loading label="Checking the saved connection" />
        ) : isError ? (
          // Not the same thing as "not connected": saying so would send
          // someone to re-link an account that is fine.
          <p className="t-body flex items-start gap-2 !text-[rgb(248,113,113)]">
            <AlertTriangle className="h-4 w-4 mt-1 shrink-0" aria-hidden="true" />
            Could not check the connection. Try again in a moment.
          </p>
        ) : linked ? (
          <div className="glass-inner p-inner space-y-1.5">
            <p className="t-h4 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#b9e045]" aria-hidden="true" />
              Account linked as {data?.account_email ?? "an unnamed account"}
            </p>
            <p className="t-secondary">This is the saved account link. If generation reports an expired session, sign in again.</p>
            {data?.linked_at && (
              <p className="t-label">Signed in on {formatDate(data.linked_at)}.</p>
            )}
            {wrongAccount && (
              <p className="t-secondary flex items-start gap-2 !text-[rgb(248,113,113)]">
                <AlertTriangle className="h-4 w-4 mt-1 shrink-0" aria-hidden="true" />
                Generation will be charged to this account rather than {EXPECTED_ACCOUNT}. Sign in again to change it.
              </p>
            )}
          </div>
        ) : (
          <div className="glass-inner p-inner">
            <p className="t-h4">Not connected</p>
            <p className="t-secondary">Generation cannot run until someone signs in as {EXPECTED_ACCOUNT}.</p>
          </div>
        )}
        <p className="t-label">
          Sign in to higgsfield.ai as {EXPECTED_ACCOUNT} first, in this browser. The sign-in link is good for 15
          minutes, and signing in again keeps the current connection working until the new one succeeds.
        </p>
    </Section>
  );
}
