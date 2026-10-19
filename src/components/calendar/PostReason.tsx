/**
 * Why a post is on the calendar, with the evidence behind it: the real post
 * it builds on, its date and its numbers, and a link to it. Weeks planned
 * from the latest results say so; thin evidence says "early signal".
 */

import { ExternalLink } from "lucide-react";
import type { PostEvidence, PostReason as Reason } from "@/lib/calendarPosts";

const shortDate = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
const times = (m?: number) => (m === undefined ? "" : `${Number.isInteger(m) ? m : m.toFixed(1)}x`);

function evidenceLine(e: PostEvidence): string {
  const where = [e.company, e.platform, e.format && e.format !== "unknown" ? e.format : ""].filter(Boolean).join(" · ");
  const parts = [where, shortDate(e.date)];
  if (e.multiple !== undefined) parts.push(`${times(e.multiple)} ${e.kind === "own" ? "your" : "their"} usual ${e.metric}${e.sample ? ` (median of ${e.sample} posts)` : ""}`);
  if (e.companies) parts.push(`${e.companies} companies`);
  return parts.filter(Boolean).join(" · ");
}

export function PostReason({ reasons }: { reasons: Reason[] | null | undefined }) {
  const reason = reasons?.[0];
  if (!reason?.label) return null;
  const evidence = reason.evidence ?? [];
  return (
    <div className="bg-[rgba(255,255,255,0.03)] p-3.5 rounded-md space-y-2">
      <p className="t-label">Why this post</p>
      <p className="t-body text-foreground">{reason.label}</p>
      {evidence.length > 0 && (
        <ul className="space-y-1.5">
          {evidence.map((e) => (
            <li key={e.id} className="t-secondary">
              <span>{evidenceLine(e)}</span>
              {e.text && <span className="block text-muted-foreground line-clamp-2">"{e.text}"</span>}
              {e.link && (
                <a href={e.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white">
                  View the post <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
