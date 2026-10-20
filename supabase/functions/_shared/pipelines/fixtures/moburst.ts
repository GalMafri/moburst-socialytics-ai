// The Moburst September 2026 replay fixture (competitive-replay-moburst-2026-09.json)
// for tests, with the provider answers rebuilt from it: the LinkedIn actor's
// dataset and the client's Sprout collection. Not imported by any function.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApifyClient, ApifyRunStatus } from "../../apify/client.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const here = dirname(fileURLToPath(import.meta.url));
export const FX: Any = JSON.parse(readFileSync(join(here, "competitive-replay-moburst-2026-09.json"), "utf8"));
export const snap = (endpoint: string) => FX.snapshots.find((s: Any) => s.endpoint === endpoint).payload;
export const POSTS = snap("socialposts");
export const CLIENT_COMPANY = "2006317";

/** The actor's dataset, rebuilt from the verified LinkedIn posts and the LinkedIn figures n8n saved (previous period and follower counts included). */
export function linkedInRows(): Any[] {
  const sources: Any[] = POSTS.linkedin_sources;
  const profileOf = (cid: string) => sources.find((s) => s.company_id === cid).profile_url;
  const followers = (cid: string) => POSTS.additional_metrics[cid]?.audience_snapshot?.followers;
  const author = (cid: string) => ({ type: "company", linkedinUrl: profileOf(cid), ...(followers(cid) != null ? { info: `${Number(followers(cid)).toLocaleString("en-US")} followers` } : {}) });
  const rows = POSTS.socialPosts.filter((p: Any) => p.source === "apify/harvestapi").map((p: Any) => {
    const media = p.type === "carousel" ? { document: { coverPages: [{ imageUrls: [p.image] }] } }
      : p.type === "video" ? { postVideo: { thumbnailUrl: p.image } }
      : p.type === "link" ? { article: { image: { url: p.image } } }
      : p.image ? { postImages: [{ url: p.image }] } : {};
    const collaboration = p.authorship === "collaboration";
    return {
      type: "post", id: String(p.postId).split(":").slice(2).join(":"), query: { targetUrl: profileOf(p.companyId) },
      author: collaboration ? { type: "company", linkedinUrl: "https://www.linkedin.com/company/a-partner" } : author(p.companyId),
      ...(collaboration ? { header: { imageLink: profileOf(p.companyId), text: "They collaborated on this" } } : {}),
      postedAt: { date: p.publishedAt }, linkedinUrl: p.postLink, content: p.message,
      engagement: { likes: p.applause, comments: p.conversation, shares: p.amplification }, ...media,
    };
  });
  // The previous period's posts are only counted, so they are rebuilt from the counts.
  for (const [cid, m] of Object.entries(POSTS.additional_metrics) as Array<[string, Any]>) {
    for (let i = 0; i < (m.previous?.posts ?? 0); i++) {
      rows.push({ type: "post", id: `prev-${cid}-${i}`, query: { targetUrl: profileOf(cid) }, author: author(cid), postedAt: { date: "2026-08-15T10:00:00.000Z" },
        linkedinUrl: `https://www.linkedin.com/posts/prev-${cid}-${i}`, content: "", engagement: { likes: i === 0 ? m.previous.engagement : 0, comments: 0, shares: 0 } });
    }
  }
  // A repost on a reviewed page is never counted.
  rows.push({ type: "post", id: "repost-1", query: { targetUrl: profileOf(sources[0].company_id) }, header: { imageLink: profileOf(sources[0].company_id), text: "Someone reposted this" },
    author: { type: "company", linkedinUrl: "https://www.linkedin.com/company/elsewhere" }, postedAt: { date: "2026-09-10T10:00:00.000Z" }, linkedinUrl: "https://www.linkedin.com/posts/repost-1", engagement: { likes: 500, comments: 0, shares: 0 } });
  return rows;
}

/** The client's Sprout collection as n8n's run saved it. */
export async function owned() {
  const s = POSTS.owned_source;
  return { provider: "sprout", coverage: s.coverage, period: s.period, collected_at: s.collected_at, profiles: s.profiles, posts: POSTS.socialPosts.filter((p: Any) => p.source === "sprout"), metrics: POSTS.owned_metrics[CLIENT_COMPANY] };
}

/** The LinkedIn actor: each look answers the next status (the last one repeats); the dataset is linkedInRows(). */
export function fakeActor(statuses: ApifyRunStatus[], calls: string[]) {
  let started = 0;
  let looks = 0;
  const client: ApifyClient = {
    async startRun(actorId, input, opts) { started += 1; calls.push(`start ${actorId} ${JSON.stringify(input)} ${opts.timeoutSecs}/${opts.memoryMbytes}`); return { id: `apify-${started}`, status: "READY", defaultDatasetId: `ds-${started}` }; },
    async getRun(runId) { const status = statuses[Math.min(looks++, statuses.length - 1)]; calls.push(`look ${runId} ${status}`); return { id: runId, status, defaultDatasetId: `ds-${runId.split("-")[1]}` }; },
    async datasetPage() { return []; },
    async datasetItems(id) { calls.push(`dataset ${id}`); return linkedInRows(); },
  };
  return () => client;
}
