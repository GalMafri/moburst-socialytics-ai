/**
 * What the brand's design memory learned (design_learnings), in Client setup
 * > Designs (notes on regenerate, Lital 3 Nov 2026): every rule with where it
 * came from (a design turned down with Not right, or a note left on
 * Regenerate), its date, and Remove. Every design for the client follows
 * these; a removed one stops reaching them.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { formatDate } from "@/lib/display";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DesignLearning { id: string; pattern_type: string; pattern_description: string; source: string | null; created_at: string }

/** Where a design rule came from, as people read it. */
export function designLearningSource(source: string | null | undefined): string {
  return source === "regenerate_note" ? "From a regenerate note" : "From Not right";
}

export function LearnedDesignPreferences({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data: learnings } = useQuery({
    queryKey: ["design-learnings", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("design_learnings")
        .select("id, pattern_type, pattern_description, source, created_at").eq("client_id", clientId)
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data || []) as DesignLearning[];
    },
  });
  if (!learnings?.length) return null;
  const remove = async (id: string) => {
    await sendQuietly(() => supabase.from("design_learnings").delete().eq("id", id), { again: writeResendable });
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
            </div>
            <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Remove this design preference" onClick={() => void remove(l.id)}>
              <X />
            </Button>
          </div>
        ))}
      </div>
    </Section>
  );
}
