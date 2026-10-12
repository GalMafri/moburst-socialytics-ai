// A docked panel at the side of the calendar: every design or video run in progress with its stage, and every finished run
// with what came of it, each with an Open button. It stays while runs are going; nothing to scroll for.
//
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, section 13.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { stageLabel, useDesignRuns, type DesignRunSummary } from "./DesignRunsContext";

interface Props {
  // the post a run belongs to, for its title; undefined when the calendar no longer has it
  titleFor: (postKey: string) => string | undefined;
  onOpen: (postKey: string) => void;
}

const RECENT_MS = 6 * 60 * 60 * 1000; // finished runs stay listed for six hours

function titleOf(run: DesignRunSummary, titleFor: Props["titleFor"]): string {
  const t = titleFor(run.postKey);
  if (t) return t;
  try {
    const parts = JSON.parse(run.postKey) as unknown[];
    return `${parts[5] || ""} · ${parts[3] || ""}`.trim();
  } catch {
    return "Post";
  }
}

export function DesignRunsDock({ titleFor, onOpen }: Props) {
  const { runs } = useDesignRuns();
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState<Record<string, true>>({});
  const items = useMemo(() => {
    const now = Date.now();
    return Object.values(runs)
      .filter((r) => !hidden[r.id])
      .filter((r) => r.status === "queued" || r.status === "running" || now - new Date(r.createdAt).getTime() < RECENT_MS)
      .sort((a, b) => {
        const live = (r: DesignRunSummary) => (r.status === "queued" || r.status === "running" ? 0 : 1);
        return live(a) - live(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [runs, hidden]);
  if (!items.length) return null;
  const active = items.filter((r) => r.status === "queued" || r.status === "running").length;

  return (
    <aside className="fixed right-4 bottom-4 z-40 w-[320px] max-w-[calc(100vw-2rem)] glass rounded-[16px] shadow-xl border border-white/10" aria-live="polite" aria-label="Design progress">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {active > 0 ? <Loader2 className="h-4 w-4 animate-spin text-[#b9e045]" /> : <Check className="h-4 w-4 text-[#b9e045]" />}
          <p className="text-sm font-semibold">{active > 0 ? `${active} in progress` : "Designs ready"}</p>
        </div>
        <button type="button" className="text-muted-foreground hover:text-white" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-[50vh] overflow-y-auto px-2 pb-2 space-y-1">
          {items.map((r) => {
            const live = r.status === "queued" || r.status === "running";
            const ready = (r.status === "offered" || r.status === "picked") && r.offered > 0;
            const what = r.kind === "video" ? "video" : "design";
            return (
              <li key={r.id} className="glass-inner rounded-[12px] px-3 py-2 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{titleOf(r, titleFor)}</p>
                  <p className="t-secondary truncate">
                    {live ? `${what === "video" ? "Video" : "Designs"} · ${stageLabel(r)}` : ready ? `${r.offered} ${what}${r.offered === 1 ? "" : "s"} ready` : `No ${what} met the checks`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant={ready ? "default" : "outline"} onClick={() => onOpen(r.postKey)}>Open</Button>
                  {!live && (
                    <button type="button" className="text-muted-foreground hover:text-white" onClick={() => setHidden((h) => ({ ...h, [r.id]: true }))} aria-label="Dismiss">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
