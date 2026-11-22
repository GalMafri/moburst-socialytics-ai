/**
 * What the brand's design memory learned (design_learnings), in Client setup
 * > Designs (notes on regenerate, Lital 3 Nov 2026): every rule with where it
 * came from (a design turned down with Not right, or a note left on
 * Regenerate), its date, and Remove. Every design for the client follows
 * these; a removed one stops reaching them.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { formatDate } from "@/lib/display";
import { DESIGN_LEARNINGS_LIMIT } from "../../../supabase/functions/_shared/design-prompts/learnings";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NOT_YET, NotYet } from "@/components/ui/not-yet";

interface DesignLearning { id: string; pattern_type: string; pattern_description: string; source: string | null; created_at: string }

/** Where a design rule came from, as people read it. */
export function designLearningSource(source: string | null | undefined): string {
  return source === "regenerate_note" ? "From a regenerate note" : "From a design marked not right";
}

export function LearnedDesignPreferences({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data: learnings } = useQuery({
    queryKey: ["design-learnings", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("design_learnings")
        .select("id, pattern_type, pattern_description, source, created_at").eq("client_id", clientId)
        .order("created_at", { ascending: false }).limit(DESIGN_LEARNINGS_LIMIT);
      if (error) throw error;
      return (data || []) as DesignLearning[];
    },
  });
  // QA 22 Nov 2026: a remove is resent quietly for up to 13 s, so its button is busy meanwhile, and one that
  // still did not get through says the preference is not removed yet. Before, nothing changed on screen.
  const [removing, setRemoving] = useState<string | null>(null);
  const [notRemoved, setNotRemoved] = useState<string | null>(null);
  if (!learnings?.length) return null;
  const remove = async (id: string) => {
    setRemoving(id);
    setNotRemoved(null);
    const { error } = await sendQuietly(() => supabase.from("design_learnings").delete().eq("id", id), { again: writeResendable });
    setRemoving(null);
    if (error) {
      console.warn("[design preferences] not removed yet", error);
      setNotRemoved(id);
    }
    // The list shows what the database has.
    void qc.invalidateQueries({ queryKey: ["design-learnings", clientId] });
  };
  return (
    <Section
      layout="split"
      eyebrow="Designs"
      title="Learned design preferences"
      description="Learned from designs turned down with Not right, and from notes left on Regenerate that say something lasting. Every design for this client follows these."
    >
      <div className="space-y-3">
        {learnings.map((l) => (
          <div key={l.id} className="glass-inner flex items-start justify-between gap-3 p-inner">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{l.pattern_type === "prefer" ? "Prefer" : "Avoid"}</Badge>
                <span className="t-secondary">{designLearningSource(l.source)} · {formatDate(l.created_at)}</span>
              </div>
              <p className="t-body">{l.pattern_description}</p>
              {notRemoved === l.id && <NotYet>{NOT_YET.remove}</NotYet>}
            </div>
            <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Remove this design preference" onClick={() => void remove(l.id)} disabled={removing === l.id}>
              {removing === l.id ? <Loader2 className="animate-spin" aria-hidden /> : <X />}
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}
