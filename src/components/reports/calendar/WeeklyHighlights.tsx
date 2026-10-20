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
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full p-card cursor-pointer flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-t-[20px]"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 text-[#b1b7c1]" /> : <ChevronRight className="h-4 w-4 text-[#b1b7c1]" />}
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="t-h4">Weekly highlights</span>
        {!open && underrepresented.length > 0 && (
          <span className="t-label ml-1">
            · {underrepresented.length} underrepresented pillar{underrepresented.length === 1 ? "" : "s"} this week
          </span>
        )}
      </button>

      <CardContent
        // The four blocks side by side on a wide screen rather than stacked
        // at the left of the card.
        className={`gap-5 lg:grid-cols-2 ${open ? "grid" : "hidden"} print:grid`}
      >
        {sproutMonthSummary && (
          <div>
            <p className="t-subhead mb-1.5">
              Month-over-month
            </p>
            <p className="t-secondary">{sproutMonthSummary}</p>
          </div>
        )}

        {underrepresented.length > 0 && (
          <div>
            <p className="t-subhead mb-1.5">
              Underrepresented pillars
            </p>
            <ul className="space-y-1">
              {underrepresented.map((p, i) => (
                <li key={i} className="t-secondary">
                  • {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tiktokOpps.length > 0 && (
          <div>
            <p className="t-subhead mb-1.5">
              TikTok opportunities
            </p>
            <ul className="space-y-1">
              {tiktokOpps.slice(0, 3).map((o, i) => (
                <li key={i} className="t-secondary">
                  • {o}
                </li>
              ))}
            </ul>
          </div>
        )}

        {igOpps.length > 0 && (
          <div>
            <p className="t-subhead mb-1.5">
              Instagram opportunities
            </p>
            <ul className="space-y-1">
              {igOpps.slice(0, 3).map((o, i) => (
                <li key={i} className="t-secondary">
                  • {o}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
