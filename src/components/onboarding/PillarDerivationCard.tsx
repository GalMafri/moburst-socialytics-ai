import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DerivedPillar {
  name: string;
  description: string;
  rationale?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  strategy_doc: "the strategy document",
  social_posts: "the client's own posts",
  brief: "the brief",
};

/**
 * Reads the client's content pillars instead of asking someone to invent
 * them. Whatever comes back lands in the same editable pillar list, so it is
 * a starting point rather than an answer.
 */
export function PillarDerivationCard({
  clientId,
  hasStrategyDoc,
  hasBrief,
  derivedAt,
  source,
  onDerived,
}: {
  clientId?: string;
  hasStrategyDoc: boolean;
  hasBrief: boolean;
  derivedAt?: string | null;
  source?: string | null;
  onDerived: (pillars: DerivedPillar[], keywords: string[]) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  const run = async () => {
    if (!clientId) {
      toast.error("Save the client first, then read its pillars.");
      return;
    }
    setRunning(true);
    setError(null);
    setNotes(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("derive-content-pillars", {
        body: { client_id: clientId },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.error);
      const pillars: DerivedPillar[] = data?.pillars || [];
      if (pillars.length === 0) throw new Error("Nothing came back to work from.");
      onDerived(pillars, data?.keywords || []);
      setNotes(data?.notes || null);
      toast.success(`${pillars.length} pillars read from ${SOURCE_LABEL[data?.source] || "what is on file"}`);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setRunning(false);
    }
  };

  const ready = hasStrategyDoc || hasBrief;

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="t-body text-white">Read the pillars from what this client already has</p>
            <p className="t-secondary">
              {hasStrategyDoc
                ? "From the uploaded strategy, plus any posts and the brief."
                : hasBrief
                ? "From the brief and the client's own posts. Upload a social strategy for a client with no posting history yet."
                : "Upload a social strategy, or write the brief, and this can read the pillars from it."}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={run} disabled={running || !clientId || !ready} className="shrink-0">
            {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {derivedAt ? "Read again" : "Read pillars"}
          </Button>
        </div>

        {derivedAt && !running && (
          <p className="t-label text-muted-foreground inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            Read from {SOURCE_LABEL[source || ""] || "what was on file"} on {new Date(derivedAt).toLocaleDateString()}. Edit anything below.
          </p>
        )}
        {notes && <p className="t-secondary">{notes}</p>}
        {error && (
          <p className="t-label text-destructive inline-flex items-start gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
