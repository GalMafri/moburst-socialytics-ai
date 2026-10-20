// One item per weekly window comes in; one merged socialposts payload goes out,
// shaped like a single RivalIQ response so caching and aggregation are unchanged.
// pairedItem points at the first window so downstream $("Node").item lookups resolve
// (without it, multi-window runs failed at Cache Posts Snapshot).
// Each window asks RivalIQ for up to 500 posts (limit=500); a page that hits 500 is flagged truncated.
const PAGE_LIMIT = 500;
const items = $input.all();
// Landscape Social Posts runs once per window with continueErrorOutput, so a
// window that fails is routed away and simply never arrives here. Counting what
// Build Post Windows asked for is the only way to notice: without it the run
// completes on partial data and reports the period as fully covered.
const expected_windows = (() => {
  try { return $("Build Post Windows").all().length; } catch (e) { return items.length; }
})();
const failed_windows = Math.max(0, expected_windows - items.length);
const seen = new Set();
const socialPosts = [];
let truncated_pages = 0;
for (const item of items) {
  const list = item.json.socialPosts || item.json.posts || item.json.data || (Array.isArray(item.json) ? item.json : []);
  if (list.length >= PAGE_LIMIT) truncated_pages += 1;
  for (const p of list) {
    const key = String(p.postId ?? p.postLink ?? p.nativeId ?? JSON.stringify([p.companyId, p.publishedAt, p.message]));
    if (seen.has(key)) continue;
    seen.add(key);
    socialPosts.push(p);
  }
}
return [{ json: { socialPosts, pages: items.length, expected_windows, failed_windows, truncated_pages, page_limit: PAGE_LIMIT }, pairedItem: { item: 0 } }];

