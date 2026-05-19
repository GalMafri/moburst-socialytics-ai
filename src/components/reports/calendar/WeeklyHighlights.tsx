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
        className="w-full p-5 cursor-pointer flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-t-[20px]"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-[15px] font-semibold tracking-[-0.5px]">Weekly highlights</span>
        {!open && underrepresented.length > 0 && (
          <span className="text-sm text-muted-foreground tracking-[-0.5px] ml-1">
            · {underrepresented.length} underrepresented pillar{underrepresented.length === 1 ? "" : "s"} this week
          </span>
        )}
      </button>

      <CardContent
        className={`pt-0 pb-5 px-5 space-y-5 ${open ? "block" : "hidden"} print:block`}
      >
        {sproutMonthSummary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground tracking-[0.1px] uppercase mb-1.5">
              Month-over-month
            </p>
            <p className="text-[15px] leading-relaxed tracking-[-0.5px]">{sproutMonthSummary}</p>
          </div>
        )}

        {underrepresented.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground tracking-[0.1px] uppercase mb-1.5">
              Underrepresented pillars
            </p>
            <ul className="space-y-1">
              {underrepresented.map((p, i) => (
                <li key={i} className="text-[15px] leading-relaxed tracking-[-0.5px]">
                  • {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tiktokOpps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground tracking-[0.1px] uppercase mb-1.5">
              TikTok opportunities
            </p>
            <ul className="space-y-1">
              {tiktokOpps.slice(0, 3).map((o, i) => (
                <li key={i} className="text-[15px] leading-relaxed tracking-[-0.5px]">
                  • {o}
                </li>
              ))}
            </ul>
          </div>
        )}

        {igOpps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground tracking-[0.1px] uppercase mb-1.5">
              Instagram opportunities
            </p>
            <ul className="space-y-1">
              {igOpps.slice(0, 3).map((o, i) => (
                <li key={i} className="text-[15px] leading-relaxed tracking-[-0.5px]">
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
