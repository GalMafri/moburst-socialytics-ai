import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PlatformIcon } from "@/lib/platform-config";
import { Button } from "@/components/ui/button";
import { Segment, SegmentedGroup } from "@/components/ui/segmented";
import type { TrendPost, TrendTheme } from "@/hooks/useTrendThemes";
import { PLATFORM_NAMES, cleanText, formatDate, platformKey, platformName } from "@/lib/display";
import { clipText } from "@/lib/clipText";
import { measuredEngagements } from "@/lib/trendEngagement";

// The weekly industry themes as every screen shows them (Analytics' Trend
// insights, the monthly report's Industry trends): per week a plain heading over
// one panel, each theme a ranked row with what's happening, why it matters, the
// angle (set off by a lime rule), its platforms as icons and the example posts
// as an aligned table, narrowed by a platform filter.

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
/** Example posts listed before "Show all". */
const POSTS_SHOWN = 5;

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
/** A count in a narrow column: 482K, 61.2K, 812. The full figure stays in the cell's title. */
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Past these lengths a line is set short (clamped) with one Read more for the theme.
const LONG = { happening: 170, body: 210 };

function Figure({ value, label }: { value: number; label: string }) {
  return value > 0
    ? <span title={`${count(value)} ${label}`}>{compact(value)}</span>
    : <span title={`${label[0].toUpperCase()}${label.slice(1)} not available for this post`} aria-label={`${label} not available`} />;
}

// Post table columns: the post, views, likes, comments, shares, the key figure, the link.
const POST_GRID = "grid items-center gap-x-4 grid-cols-[minmax(0,1fr)_72px_20px] md:grid-cols-[minmax(0,1fr)_repeat(4,64px)_96px_20px]";

function PostRow({ post, staff, folded = false }: { post: TrendPost; staff: boolean; folded?: boolean }) {
  // A link comes from the post's own network; only a web address is made one.
  const link = /^https?:\/\//i.test(post.url) ? post.url : null;
  const text = cleanText(post.text).trim();
  const shown = clipText(text, EXCERPT_CHARS);
  const meta = [post.format ? FORMAT_LABELS[post.format] : "", post.posted_at ? formatDate(post.posted_at, { year: false }) : ""].filter(Boolean);
  // Staff read the weighted score the ranking uses. A client reads what was measured: likes, comments and shares.
  const measured = staff ? null : measuredEngagements(post);
  const score = staff && post.engagement != null ? Math.round(Number(post.engagement)) : null;
  return (
    <li data-print-show={folded ? "true" : undefined} className={`${POST_GRID} py-2.5 -mx-2 px-2 rounded-[8px] hover:bg-[rgba(255,255,255,0.03)] transition-colors${folded ? " hidden" : ""}`}>
      <div className="min-w-0 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-[#b1b7c1]" title={platformName(post.platform)} role="img" aria-label={platformName(post.platform)}>
          <PlatformIcon platform={post.platform} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="t-label truncate">
            <span className="text-white font-medium">{post.author}</span>
            {meta.length > 0 && <span> · {meta.join(" · ")}</span>}
          </p>
          {shown && <p className="t-label !text-[#b1b7c1] truncate" title={text}>{`"${shown}${shown.length < text.length ? "…" : ""}"`}</p>}
        </div>
      </div>
      <span className="hidden md:block t-label !text-white text-right tabular-nums"><Figure value={post.views} label="views" /></span>
      <span className="hidden md:block t-label !text-white text-right tabular-nums"><Figure value={post.likes} label="likes" /></span>
      <span className="hidden md:block t-label !text-white text-right tabular-nums"><Figure value={post.comments} label="comments" /></span>
      <span className="hidden md:block t-label !text-white text-right tabular-nums"><Figure value={post.shares} label="shares" /></span>
      <span className="t-h4 text-right tabular-nums">
        {measured != null && measured > 0 && (
          <span title="Likes, comments and shares on this post">
            <span aria-hidden>{compact(measured)}</span>
            <span className="sr-only">{`${count(measured)} engagements`}</span>
          </span>
        )}
        {/* The score is the team's, and stays out of a PDF exported for the client. */}
        {score != null && (
          <span data-print="hide" title={`Score: ${count(score)}`}>
            <span aria-hidden>{compact(score)}</span>
            <span className="sr-only">{`Score: ${count(score)}`}</span>
          </span>
        )}
      </span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" aria-label="View original" title="View original" className="justify-self-end text-[#b1b7c1] hover:text-[#b9e045] transition-colors">
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      ) : <span />}
    </li>
  );
}

/** One theme as a ranked row. `onDismiss` is given only on Analytics, where staff may dismiss a theme; a report and a client never see it. */
function ThemeRow({ theme, rank, staff, onDismiss }: { theme: TrendTheme; rank: number; staff: boolean; onDismiss?: () => void }) {
  const [open, setOpen] = useState(false);
  const [allPosts, setAllPosts] = useState(false);
  const titleId = `trend-theme-${theme.id}`;
  const formats = [...new Set(theme.posts.map((p) => (p.format ? FORMAT_LABELS[p.format] : "")).filter(Boolean))];
  const long = (theme.happening?.length ?? 0) > LONG.happening || (theme.why_it_matters?.length ?? 0) > LONG.body || (theme.angle?.length ?? 0) > LONG.body;
  const clamp = (lines: string) => (long && !open ? lines : "");
  return (
    <article aria-labelledby={titleId} className="grid grid-cols-[28px_minmax(0,1fr)] md:grid-cols-[48px_minmax(0,1fr)] gap-x-3 md:gap-x-5 p-card md:px-6 md:py-6">
      <span className="t-h3 md:t-h2 !text-[#b1b7c1]/60 tabular-nums leading-[24px] md:leading-[26px]" aria-hidden>{String(rank).padStart(2, "0")}</span>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 id={titleId} className="t-h3">{theme.title}</h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 t-label">
              <span className="flex items-center gap-2 text-[#b1b7c1]">
                {themePlatforms(theme).map((p) => (
                  <span key={p} title={platformName(p)} className="inline-flex">
                    <PlatformIcon platform={p} className="h-3.5 w-3.5" />
                    <span className="sr-only">{platformName(p)}</span>
                  </span>
                ))}
              </span>
              {formats.length > 0 && <span>{formats.join(", ")}</span>}
            </div>
          </div>
          {staff && onDismiss && <Button size="sm" variant="ghost" className="shrink-0 -mr-2 -mt-1" onClick={onDismiss}>Dismiss</Button>}
        </div>

        {theme.happening && <p className={`t-read mt-3 ${clamp("line-clamp-2")}`}>{theme.happening}</p>}

        {(theme.why_it_matters || theme.angle) && (
          <div className="mt-4 grid gap-x-8 gap-y-4 lg:grid-cols-2">
            {theme.why_it_matters && (
              <div>
                <p className="t-label mb-1">Why it matters</p>
                <p className={`t-secondary ${clamp("line-clamp-3")}`}>{theme.why_it_matters}</p>
              </div>
            )}
            {theme.angle && (
              <div className="border-l-2 border-[#b9e045] pl-4">
                <p className="t-label !text-[#b9e045] font-medium mb-1">The angle</p>
                <p className={`t-secondary font-medium ${clamp("line-clamp-3")}`}>{theme.angle}</p>
              </div>
            )}
          </div>
        )}

        {long && (
          <button type="button" data-print="hide" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="t-link mt-3">
            {open ? "Show less" : "Read more"}
          </button>
        )}

        {theme.posts.length > 0 && (
          <div className="mt-5">
            <div className={`${POST_GRID} pb-1.5 t-label !text-[#b1b7c1]/60 border-b border-[rgba(255,255,255,0.06)]`}>
              <span>Example posts</span>
              <span className="hidden md:block text-right">Views</span>
              <span className="hidden md:block text-right">Likes</span>
              <span className="hidden md:block text-right">Comments</span>
              <span className="hidden md:block text-right">Shares</span>
              <span className="text-right">{staff ? <span data-print="hide">Score</span> : "Engagements"}</span>
              <span />
            </div>
            <ul className="divide-y divide-[rgba(255,255,255,0.04)]">
              {theme.posts.map((post, i) => (
                // Past the first few, a post stays in the PDF but waits for "Show all" on screen.
                <PostRow key={post.url} post={post} staff={staff} folded={i >= POSTS_SHOWN && !allPosts} />
              ))}
            </ul>
            {theme.posts.length > POSTS_SHOWN && (
              <button type="button" data-print="hide" aria-expanded={allPosts} onClick={() => setAllPosts((v) => !v)} className="t-link mt-2">
                {allPosts ? "Show fewer posts" : `Show all ${theme.posts.length} posts`}
              </button>
            )}
          </div>
        )}
      </div>
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

/** The themes, newest week first: a plain heading per week over one panel of ranked rows. */
export function ThemeWeeks({ themes, staff, onDismiss }: { themes: TrendTheme[]; staff: boolean; onDismiss?: (theme: TrendTheme) => void }) {
  return (
    <>
      {byWeek(themes).map(({ week, themes: list }) => {
        const posts = list.reduce((n, t) => n + t.posts.length, 0);
        const headingId = `trend-week-${week}`;
        return (
          <section key={week} aria-labelledby={headingId} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
              <h3 id={headingId} className="t-h3">Week of {formatDate(week)}</h3>
              <p className="t-label">{[plural(list.length, "theme"), plural(posts, "example post")].join(" · ")}</p>
            </div>
            <Card className="divide-y divide-[rgba(255,255,255,0.06)]">
              {list.map((theme, i) => <ThemeRow key={theme.id} theme={theme} rank={i + 1} staff={staff} onDismiss={onDismiss ? () => onDismiss(theme) : undefined} />)}
            </Card>
          </section>
        );
      })}
    </>
  );
}
