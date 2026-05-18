import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";

interface Props {
  aiAnalysis: any;
  sproutMonthSummary?: string | null;
}

export function WeeklyHighlights({ aiAnalysis, sproutMonthSummary }: Props) {
  const [open, setOpen] = useState(false);

  // Pull the highest-value insights for collapsed peek.
  const tiktokOpps: string[] = aiAnalysis?.tiktok_trends_analysis?.opportunities_for_client || [];
  const igOpps: string[] = aiAnalysis?.instagram_trends_analysis?.opportunities_for_client || [];
  const underrepresented: string[] = aiAnalysis?.sprout_performance_analysis?.pillar_alignment?.underrepresented || [];

  const hasAnyContent = sproutMonthSummary || tiktokOpps.length > 0 || igOpps.length > 0 || underrepresented.length > 0;
  if (!hasAnyContent) return null;

  return (
    <Card className="glass-inner">
      <CardContent
        className="py-3 cursor-pointer flex items-center gap-2"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Weekly highlights</span>
        {!open && underrepresented.length > 0 && (
          <span className="text-xs text-muted-foreground ml-2">
            · {underrepresented.length} underrepresented pillar{underrepresented.length === 1 ? "" : "s"} this week
          </span>
        )}
      </CardContent>

      {open && (
        <CardContent className="pt-0 space-y-4 text-sm">
          {sproutMonthSummary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Month-over-month</p>
              <p className="leading-relaxed">{sproutMonthSummary}</p>
            </div>
          )}

          {underrepresented.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Underrepresented pillars</p>
              <ul className="list-disc list-inside space-y-0.5">
                {underrepresented.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {tiktokOpps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">TikTok opportunities</p>
              <ul className="list-disc list-inside space-y-0.5">
                {tiktokOpps.slice(0, 3).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {igOpps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Instagram opportunities</p>
              <ul className="list-disc list-inside space-y-0.5">
                {igOpps.slice(0, 3).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
