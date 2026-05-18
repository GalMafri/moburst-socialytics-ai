import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  clientId?: string;
  designReferencesCount: number;
  hasBrandBook: boolean;
  existingSynthesis: any | null;
  onSynthesized: (s: any) => void;
  /**
   * If true, schedules a debounced auto-trigger when inputs change.
   * Default true. Pass false from forms that aren't saved yet (e.g., new client).
   */
  autoTrigger?: boolean;
}

export function DesignSynthesisCard({
  clientId,
  designReferencesCount,
  hasBrandBook,
  existingSynthesis,
  onSynthesized,
  autoTrigger = true,
}: Props) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const hasInputs = designReferencesCount > 0 || hasBrandBook;
  const synthesizedAt = existingSynthesis?.synthesized_at
    ? new Date(existingSynthesis.synthesized_at)
    : null;
  const sourceCount = existingSynthesis?.source_count ?? 0;

  const run = async () => {
    if (!clientId) {
      toast.error("Save the client first, then synthesize.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        "synthesize-design-language",
        { body: { client_id: clientId } },
      );
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      if (data?.design_style_synthesis) {
        onSynthesized(data.design_style_synthesis);
        toast.success("Design language synthesized");
      }
    } catch (e: any) {
      setError(e.message || String(e));
      toast.error("Synthesis failed");
    } finally {
      setRunning(false);
    }
  };

  // Debounced auto-trigger when inputs change
  useEffect(() => {
    if (!autoTrigger || !clientId || !hasInputs) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      run();
    }, 10_000);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // designReferencesCount + hasBrandBook + clientId + autoTrigger drive the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designReferencesCount, hasBrandBook, clientId, autoTrigger]);

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Brand design language
          </Label>
          <Button
            variant="outline"
            size="sm"
            disabled={running || !hasInputs || !clientId}
            onClick={run}
          >
            {running ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1" />
            )}
            {existingSynthesis ? "Re-run" : "Synthesize"}
          </Button>
        </div>

        {!hasInputs && (
          <p className="text-xs text-muted-foreground">
            Upload design references or a brand book above, then synthesize. The
            result is used to guide every generated design.
          </p>
        )}

        {hasInputs && !existingSynthesis && !running && !error && (
          <p className="text-xs text-muted-foreground">
            No synthesis yet. Auto-runs ~10s after upload, or click Synthesize.
          </p>
        )}

        {running && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Synthesizing brand
            design language…
          </p>
        )}

        {error && !running && (
          <div className="text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-3 w-3" /> Synthesis failed — re-run. ({error})
          </div>
        )}

        {existingSynthesis && !running && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-success" />
            Synthesized{" "}
            {synthesizedAt ? synthesizedAt.toLocaleString() : "(unknown)"} from{" "}
            {sourceCount} sources.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
