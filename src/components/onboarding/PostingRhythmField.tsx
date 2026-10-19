/**
 * How many posts a week each platform gets on the calendar. The weekly plan
 * works this out on its own for every client: from the client's own posts,
 * else its competitors', else the companies the app tracks. The field shows
 * what the latest plan followed and where it came from; a number here
 * overrides it for that platform (0 leaves the platform out). Lital, 19 Oct
 * 2026.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rateWords, sourceWords, type ResolvedRhythmLine, type RhythmSourcesSummary } from "@/lib/postingRhythm";

export function PostingRhythmField({ platforms, value, resolved, sources, onChange }: {
  platforms: string[];
  /** Platform to posts per week, as typed ("" follows the plan's own rhythm). */
  value: Record<string, string>;
  /** What the latest plan resolved per platform; null before the client's first plan. */
  resolved: ResolvedRhythmLine[] | null;
  /** Where the latest plan's platforms came from. */
  sources?: RhythmSourcesSummary | null;
  onChange: (next: Record<string, string>) => void;
}) {
  const names = [...new Map([...platforms, ...(resolved ?? []).map((l) => l.platform), ...Object.keys(value)].map((n) => [n.toLowerCase(), n])).values()];
  const byPlatform = new Map((resolved ?? []).map((l) => [l.platform.toLowerCase(), l]));
  const unrated = new Set((sources?.unrated ?? []).map((p) => p.toLowerCase()));
  const outside = (platform: string) => (unrated.has(platform.toLowerCase())
    ? "Not in the plan: there are no posting numbers for it yet"
    : sources?.platforms === "published_90d" ? "Not in the plan: no posts here in the last 90 days" : "Not in the plan");
  return (
    <div className="space-y-2">
      <Label>Posts per week</Label>
      <p className="t-secondary">
        Each week's plan follows how often the client posts on each platform. A platform with no posts of its own follows its competitors, or the companies the app tracks. Enter a number to plan a different amount, or 0 to leave a platform out.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {names.map((platform) => {
          const line = byPlatform.get(platform.toLowerCase());
          return (
            <div key={platform} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] px-3 py-2">
              <div className="min-w-0">
                <p className="t-body">{platform}</p>
                {line ? (
                  <>
                    <p className="t-secondary">{rateWords(line.average)}</p>
                    {sourceWords(line.source) && <p className="t-secondary">{sourceWords(line.source)}</p>}
                  </>
                ) : (
                  <p className="t-secondary">{resolved ? outside(platform) : "Worked out when its first week is planned"}</p>
                )}
              </div>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={7}
                className="w-20 text-right"
                aria-label={`${platform} posts per week`}
                placeholder={line && line.average >= 1 ? String(Math.min(7, Math.round(line.average))) : ""}
                value={value[platform] ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 1);
                  const next = { ...value };
                  if (raw === "") delete next[platform];
                  else next[platform] = String(Math.min(7, Number(raw)));
                  onChange(next);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
