/**
 * Every client's posts for one week, side by side (staff). Each card shows the
 * client, platform, time, the post's design and its opening line; opening a
 * card takes you to that client's board with the post open.
 */

import { useMemo } from "react";
import { isVideoMedia } from "@/lib/designRequests";
import { isTextOnlyFormat } from "@/lib/platform";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PlatformBadge } from "@/lib/platform-config";
import { DAYS, addDays, shortDate, type CalendarPostRow } from "@/lib/calendarPosts";

export type ClientPost = CalendarPostRow & { client_name: string };

export function AllClientsWeek({ posts, week }: { posts: ClientPost[]; week: string }) {
  const navigate = useNavigate();
  const keys = useMemo(() => new Set(posts.map((p) => p.post_key)), [posts]);
  const clientIds = useMemo(() => [...new Set(posts.map((p) => p.client_id))], [posts]);
  // The design shown on each card: the one in use, else the newest. Matched
  // by key in code: a report post's key is JSON text, which an in() filter
  // on the key does not survive.
  const { data: designs = {} } = useQuery({
    queryKey: ["calendar-week-designs", week, keys.size, clientIds.join(",")],
    enabled: keys.size > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("post_iterations")
        .select("calendar_post_key, media_urls, is_selected, created_at")
        .in("client_id", clientIds)
        .not("calendar_post_key", "is", null)
        .not("media_urls", "is", null)
        .is("rejected_at", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const r of data || []) {
        // A still if the post has one, else its video (whose first frame is the cover card).
        const media: string[] = r.media_urls || [];
        const url = media.find((u) => !isVideoMedia(u)) ?? media[0];
        if (!url || !r.calendar_post_key || !keys.has(r.calendar_post_key)) continue;
        if (r.is_selected || !out[r.calendar_post_key]) out[r.calendar_post_key] = url;
      }
      return out;
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
      {DAYS.map((day, i) => {
        const date = addDays(week, i);
        const dayPosts = posts.filter((p) => p.post_date === date).sort((a, b) => a.client_name.localeCompare(b.client_name) || (a.posting_time || "").localeCompare(b.posting_time || ""));
        return (
          <section key={day} className="space-y-2 min-w-0" aria-label={`${day} ${shortDate(date)}`}>
            <header className="flex items-baseline justify-between gap-1 px-1">
              <span className="text-sm font-semibold text-white">{day.slice(0, 3)}</span>
              <span className="t-label">{shortDate(date)}</span>
            </header>
            {dayPosts.length === 0 ? (
              <p className="t-label px-1">No posts</p>
            ) : dayPosts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => navigate(`/clients/${p.client_id}/calendar?week=${week}&post=${encodeURIComponent(p.id)}`)}
                className="w-full text-left glass-inner p-2 space-y-2 border border-white/5 hover:border-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Open ${p.client_name}'s ${p.platform} post`}
              >
                {designs[p.post_key] ? (
                  <div className="aspect-[4/5] rounded-[8px] overflow-hidden bg-black/60">
                    {isVideoMedia(designs[p.post_key])
                      ? <video src={designs[p.post_key]} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                      : <img src={designs[p.post_key]} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                ) : isTextOnlyFormat(p.format) ? (
                  <p className="t-label">Text post</p>
                ) : (
                  <p className="t-label inline-flex items-center gap-1"><ImageOff className="h-3 w-3" aria-hidden />No design yet</p>
                )}
                <p className="text-xs font-semibold text-white truncate">{p.client_name}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <PlatformBadge platform={p.platform} size="sm" />
                  {p.posting_time && <span className="t-label inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{p.posting_time}</span>}
                </div>
                <p className="t-label line-clamp-2 !text-[#b1b7c1]">{p.copy.split("\n")[0]}</p>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
