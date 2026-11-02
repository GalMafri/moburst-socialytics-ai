/**
 * The strategy's platforms (spec: docs/superpowers/specs/2026-11-02-content-
 * strategy-tab-design.md, "The tab"): a card per platform that is posting now
 * or new, with its badge, its state, the cadence code worked out and its text,
 * and the platforms marked not now as a short list below. Each card is edited
 * on its own; a platform's key carries its state, so an edited launch plan
 * stops showing once the platform is posting.
 */

import { Badge } from "@/components/ui/badge";
import { Prose } from "@/components/ui/prose";
import { PlatformBadge } from "@/lib/platform-config";
import { platformSectionKey, type Cadence, type WrittenPlatform } from "../../../supabase/functions/_shared/strategy/platforms";
import { StrategyCard, type StrategyEdit, type Written } from "./StrategySection";

const STATE_NAMES: Record<WrittenPlatform["state"], string> = { posting: "Posting now", new: "New", not_now: "Not now" };

const CADENCE_FROM: Record<Cadence["source"], string> = {
  setting: "as the team set it",
  published_8w: "the client's pace over the last 8 weeks",
  published_90d: "the client's pace over the last 90 days",
  competitors: "its tracked competitors' median",
  all_tracked: "the median across every company we track",
};

/** "2.4 posts a week, the client's pace over the last 8 weeks." Empty with no rate. */
export function cadenceLine(c: Cadence | null | undefined): string {
  if (!c || !(c.per_week > 0)) return "";
  const n = Math.round(c.per_week * 100) / 100;
  const rate = n >= 1 ? `${n} post${n === 1 ? "" : "s"} a week` : `1 post every ${Math.round(1 / n)} weeks`;
  return `${rate}, ${CADENCE_FROM[c.source] ?? "the calendar's rhythm"}.`;
}

/** The not now list as bullet lines, however a person wrote it. */
function asList(text: string): string {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => (/^[-•*]\s/.test(l) ? l : `- ${l}`)).join("\n");
}

export function StrategyPlatforms({ clientId, platforms, sections, edits, written, onSaved }: {
  clientId: string;
  platforms: WrittenPlatform[];
  sections: Record<string, string>;
  edits: Map<string, StrategyEdit>;
  written: Written;
  onSaved: () => unknown;
}) {
  const live = platforms.filter((p) => p.state !== "not_now");
  const notNow = platforms.some((p) => p.state === "not_now") || edits.has("not_now");
  const common = { clientId, written, onSaved };
  return (
    <div className="space-y-inner">
      {live.length > 0 && (
        <div className="grid gap-inner lg:grid-cols-2">
          {live.map((p) => {
            const key = platformSectionKey(p.platform, p.state === "posting" ? "posting" : "new");
            const cadence = cadenceLine(p.cadence);
            return (
              <StrategyCard
                key={key}
                {...common}
                sectionKey={key}
                product={sections[key] ?? ""}
                edit={edits.get(key)}
                label={p.platform}
                title={<><PlatformBadge platform={p.platform} /><Badge variant="outline">{STATE_NAMES[p.state]}</Badge></>}
                facts={(cadence || p.handle) ? (
                  <div className="space-y-0.5">
                    {cadence && <p className="t-label">{cadence}</p>}
                    {p.handle && <p className="t-label">Account: @{p.handle.replace(/^@/, "")}</p>}
                  </div>
                ) : undefined}
              />
            );
          })}
        </div>
      )}
      {notNow && (
        <StrategyCard
          {...common}
          sectionKey="not_now"
          product={sections.not_now ?? ""}
          edit={edits.get("not_now")}
          label="Not now"
          title="Not now"
          render={(text) => <Prose text={asList(text)} cards={false} />}
        />
      )}
    </div>
  );
}
