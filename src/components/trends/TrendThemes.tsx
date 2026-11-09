import { useMemo, useState, type ReactNode } from "react";
import { Eye, ExternalLink, Heart, MessageCircle, Share2 } from "lucide-react";
import { Card, CardContent, CardHeading } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segment, SegmentedGroup } from "@/components/ui/segmented";
import type { TrendPost, TrendTheme } from "@/hooks/useTrendThemes";
import { PLATFORM_NAMES, cleanText, formatDate, platformKey, platformName } from "@/lib/display";
import { clipText } from "@/lib/clipText";
import { measuredEngagements } from "@/lib/trendEngagement";

// The weekly industry themes as every screen shows them (Analytics' Trend
// insights, the monthly report's Industry trends): one card per theme, with
// what's happening, why it matters, the angle, its platforms and the example
// posts behind it, grouped by week and narrowed by a platform filter.

// The formats Trends sorts every post into (trends/types.ts TrendFormat).
const FORMAT_LABELS: Record<string, string> = {
  short_video: "Short video",
  long_video: "Long video",
  carousel: "Carousel",
  image: "Image",
  text: "Text post",
  pin: "Pin",
};

const EXCERPT_CHARS = 220;

/** Every network a theme shows up on: the ones it lists, and the ones its posts are on. */
function themePlatforms(theme: TrendTheme): string[] {
  return [...new Set([...theme.platforms, ...theme.posts.map((p) => p.platform)].map(platformKey).filter(Boolean))];
}

/** The networks in a set of themes, in the order the app lists networks. */
function platformsIn(themes: TrendTheme[]): string[] {
  const order = Object.keys(PLATFORM_NAMES);
  const rank = (p: string) => (order.includes(p) ? order.indexOf(p) : order.length);
  return [...new Set(themes.flatMap(themePlatforms))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The theme as seen through one network: its posts there only. Null when it is not on that network. */
function onNetwork(theme: TrendTheme, platform: string): TrendTheme | null {
  if (!themePlatforms(theme).includes(platform)) return null;
  return { ...theme, posts: theme.posts.filter((p) => platformKey(p.platform) === platform) };
}

/** The weeks the themes fall in, newest first. The themes arrive in that order already. */
function byWeek(themes: TrendTheme[]): Array<{ week: string; themes: TrendTheme[] }> {
  const weeks = new Map<string, TrendTheme[]>();
  for (const theme of themes) weeks.set(theme.week_start, [...(weeks.get(theme.week_start) ?? []), theme]);
  return [...weeks].map(([week, list]) => ({ week, themes: list }));
}

const count = (n: number | null | undefined) => Number(n ?? 0).toLocaleString();

function PostRow({ post, staff }: { post: TrendPost; staff: boolean }) {
  // A link comes from the post's own network; only a web address is made one.
  const link = /^https?:\/\//i.test(post.url) ? post.url : null;
  const text = cleanText(post.text).trim();
  const shown = clipText(text, EXCERPT_CHARS);
  const meta = [platformName(post.platform), post.author, post.format ? FORMAT_LABELS[post.format] : "", post.posted_at ? formatDate(post.posted_at, { year: false }) : ""].filter(Boolean);
  // Staff read the weighted score the ranking uses. A client reads what was measured: likes, comments and shares.
  const measured = staff ? null : measuredEngagements(post);
  const score = staff && post.engagement != null ? Number(post.engagement) : null;
  return (
    <li className="space-y-1.5">
      <p className="t-label">{meta.join(" · ")}</p>
      {shown && <p className="t-secondary line-clamp-3 whitespace-pre-line">{`"${shown}${shown.length < text.length ? "…" : ""}"`}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 t-secondary">
        {post.views > 0 && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden />{count(post.views)}</span>}
        {post.likes > 0 && <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" aria-hidden />{count(post.likes)}</span>}
        {post.comments > 0 && <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden />{count(post.comments)}</span>}
        {post.shares > 0 && <span className="flex items-center gap-1"><Share2 className="h-3.5 w-3.5" aria-hidden />{count(post.shares)}</span>}
        {measured != null && measured > 0 && <Badge variant="outline" className="t-label" title="Likes, comments and shares on this post">{count(measured)} engagements</Badge>}
        {/* The score is the team's, and stays out of a PDF exported for the client. */}
        {score != null && <Badge data-print="hide" variant="outline" className="t-label">Score: {count(score)}</Badge>}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto t-link flex items-center gap-1">
            View <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}

/** One theme. `onDismiss` is given where staff may dismiss a theme (Analytics, Client setup), never on a report. */
function ThemeCard({ theme, staff, onDismiss }: { theme: TrendTheme; staff: boolean; onDismiss?: () => void }) {
  const titleId = `trend-theme-${theme.id}`;
  return (
    <article aria-labelledby={titleId} className="glass-inner p-inner space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <h3 id={titleId} className="t-h4">{theme.title}</h3>
          <div className="flex gap-1.5 flex-wrap">
            {themePlatforms(theme).map((p) => <Badge key={p} variant="outline">{platformName(p)}</Badge>)}
          </div>
        </div>
        {staff && onDismiss && <Button size="sm" variant="ghost" className="shrink-0" onClick={onDismiss}>Dismiss</Button>}
      </div>
      {theme.happening && (
        <div className="space-y-0.5">
          <p className="t-label">What's happening</p>
          <p className="t-secondary">{theme.happening}</p>
        </div>
      )}
      {theme.why_it_matters && (
        <div className="space-y-0.5">
          <p className="t-label">Why it matters</p>
          <p className="t-secondary">{theme.why_it_matters}</p>
        </div>
      )}
      {theme.angle && (
        <div className="space-y-0.5">
          <p className="t-label">The angle</p>
          <p className="t-secondary">{theme.angle}</p>
        </div>
      )}
      {theme.posts.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-[rgba(255,255,255,0.06)]">
          <p className="t-label">Example posts</p>
          <ul className="space-y-3">
            {theme.posts.map((post) => <PostRow key={post.url} post={post} staff={staff} />)}
          </ul>
        </div>
      )}
    </article>
  );
}

/**
 * A platform filter over a list of themes: `filter` is the control (none when
 * the themes are on one network only), `shown` the themes on the chosen
 * network, each with its posts there only, and `note` the line that says so
 * (none for All). The control never prints; the note does, so a PDF says
 * which platform its list shows (src/lib/exportPdf.ts).
 */
export function useThemePlatformFilter(themes: TrendTheme[]): { filter: ReactNode; shown: TrendTheme[]; note: ReactNode } {
  const [platform, setPlatform] = useState("all");
  const platforms = useMemo(() => platformsIn(themes), [themes]);
  // A network that has no theme left (after a dismissal) is no longer a choice.
  const active = platforms.includes(platform) ? platform : "all";
  const shown = useMemo(
    () => (active === "all" ? themes : themes.flatMap((t) => onNetwork(t, active) ?? [])),
    [themes, active],
  );
  const filter = platforms.length > 1 ? (
    <div data-print="hide">
      <SegmentedGroup label="Platform">
        <Segment active={active === "all"} onClick={() => setPlatform("all")}>All</Segment>
        {platforms.map((p) => <Segment key={p} active={active === p} onClick={() => setPlatform(p)}>{platformName(p)}</Segment>)}
      </SegmentedGroup>
    </div>
  ) : null;
  const note = active !== "all" ? <p className="t-secondary">Showing {platformName(active)} only.</p> : null;
  return { filter, shown, note };
}

/** The themes, one card per week, newest week first. */
export function ThemeWeeks({ themes, staff, onDismiss }: { themes: TrendTheme[]; staff: boolean; onDismiss?: (theme: TrendTheme) => void }) {
  return (
    <>
      {byWeek(themes).map(({ week, themes: list }) => (
        <Card key={week}>
          <CardHeading title={`Week of ${formatDate(week)}`} />
          <CardContent className="grid gap-inner grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))]">
            {list.map((theme) => <ThemeCard key={theme.id} theme={theme} staff={staff} onDismiss={onDismiss ? () => onDismiss(theme) : undefined} />)}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
