/**
 * How many posts a week each platform gets on the calendar. By default the
 * weekly plan follows what the client actually published over the last eight
 * weeks; a number here overrides it for that platform (0 leaves the platform
 * out). Lital, 19 Oct 2026.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LearnedRhythm {
  platform: string;
  perWeek: number;
}

export function PostingRhythmField({ platforms, value, learned, onChange }: {
  platforms: string[];
  /** Platform to posts per week, as typed ("" follows what the client publishes). */
  value: Record<string, string>;
  /** What the client published, as last measured; null when nothing has been measured yet. */
  learned: LearnedRhythm[] | null;
  onChange: (next: Record<string, string>) => void;
}) {
  const names = [...new Map([...platforms, ...(learned ?? []).map((l) => l.platform), ...Object.keys(value)].map((n) => [n.toLowerCase(), n])).values()];
  const published = new Map((learned ?? []).map((l) => [l.platform.toLowerCase(), l.perWeek]));
  return (
    <div className="space-y-2">
      <Label>Posts per week</Label>
      <p className="t-secondary">
        Each week's plan follows how often the client actually publishes on each platform. Enter a number to plan a different amount, or 0 to leave a platform out.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {names.map((platform) => {
          const usual = published.get(platform.toLowerCase());
          return (
            <div key={platform} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.06] px-3 py-2">
              <div className="min-w-0">
                <p className="t-body">{platform}</p>
                <p className="t-secondary">{usual !== undefined ? `Publishes about ${usual} a week` : learned ? "Not planned unless you set a number" : "Measured from published posts at the next plan"}</p>
              </div>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={7}
                className="w-20 text-right"
                aria-label={`${platform} posts per week`}
                placeholder={usual !== undefined ? String(usual) : "0"}
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
