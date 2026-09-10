import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  const { data, isLoading } = useQuery({
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
    <Card>
      <CardHeader>
        <CardTitle className="t-h3">Higgsfield</CardTitle>
        <CardDescription>
          Image and video generation runs through the team's Higgsfield account, not an API key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="t-secondary flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking the connection
          </p>
        ) : linked ? (
          <div className="space-y-2">
            <p className="t-body flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#b9e045]" aria-hidden="true" />
              Connected as {data?.account_email ?? "an unnamed account"}
            </p>
            {data?.linked_at && (
              <p className="t-secondary">Signed in on {new Date(data.linked_at).toLocaleDateString()}.</p>
            )}
            {wrongAccount && (
              <p className="t-secondary flex items-start gap-2 text-[rgb(248,113,113)]">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                Generation will be charged to this account rather than {EXPECTED_ACCOUNT}. Sign in again to change it.
              </p>
            )}
          </div>
        ) : (
          <p className="t-body">
            Not connected. Generation cannot run until someone signs in as {EXPECTED_ACCOUNT}.
          </p>
        )}

        <div className="space-y-2">
          <Button onClick={connect} disabled={busy} variant={linked ? "outline" : "default"}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
            ) : (
              <LinkIcon className="h-4 w-4 mr-2" aria-hidden="true" />
            )}
            {linked ? "Sign in again" : "Connect Higgsfield"}
          </Button>
          <p className="t-secondary">
            Sign in to higgsfield.ai as {EXPECTED_ACCOUNT} first, in this browser. The sign-in link is good for 15
            minutes, and signing in again keeps the current connection working until the new one succeeds.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
