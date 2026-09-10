import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, RotateCw } from "lucide-react";

const MONTHLY_KEYS = ["reports", "reports-history", "all-reports", "report"];
const COMPETITIVE_KEYS = [
  "all-competitive-reports",
  "competitive-reports-history",
  "competitive-reports",
  "competitive-report",
  "competitive-latest",
  "competitive-runs",
];

/**
 * Runs a failed report again.
 *
 * The same report row is reused rather than a new one created: a failed row
 * holds nothing but an error message, the workflow writes its result back to
 * that report id, and the run keeps its place in the client's history. The
 * payload is rebuilt server-side by run-report, which is the same builder
 * the original run and the scheduler use — so a retry sends what the first
 * attempt sent, with anything fixed in the meantime picked up.
 */
export function RetryReportButton({
  reportId,
  kind,
  size = "sm",
  variant = "ghost",
  label = "Retry",
  onStarted,
}: {
  reportId: string;
  kind: "monthly" | "competitive";
  size?: "sm" | "default";
  variant?: "ghost" | "outline" | "default";
  label?: string;
  onStarted?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canRunAnalysis } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canRunAnalysis) return null;

  const run = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-report", { body: { report_id: reportId } });
      // invoke() reports every non-2xx as "Edge Function returned a non-2xx
      // status code" and leaves the real reason on the response body.
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      toast({
        title: "Running again",
        description: "The workflow has taken the run. This page updates when it finishes.",
      });
      for (const key of kind === "competitive" ? COMPETITIVE_KEYS : MONTHLY_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onStarted?.();
    } catch (e: any) {
      toast({ title: "Could not start the run", description: e.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        size={size}
        variant={variant}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCw className="h-4 w-4 mr-1" />}
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Run this report again?"
        description={
          <>
            <p>
              The same period is analysed again and this row is reused, so the failed attempt is replaced rather than
              added to.
            </p>
            <p className="t-secondary">
              {kind === "competitive"
                ? "It reads the client's RivalIQ landscape and the confirmed competitor set as they stand now."
                : "It reads the client's Sprout profiles, brief and latest competitive analysis as they stand now."}
            </p>
          </>
        }
        confirmLabel="Run again"
        destructive={false}
        onConfirm={run}
      />
    </>
  );
}
