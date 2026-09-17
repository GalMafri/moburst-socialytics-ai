const client = $input.first().json;
const list = value => (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
  .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean);
const keywords = [...new Set([...list(client.social_keywords), ...list(client.trends_keywords)])]
  .filter(keyword => /[\p{L}\p{N}]/u.test(keyword));
const regions = list(client.geo || ['US']);
const skipped = client.skip_trends === true;
const queries = [...new Set([...keywords.slice(0, 5), ...keywords.slice(0, 3).flatMap(keyword => regions.slice(0, 2).map(region => keyword + ' ' + region))])].slice(0, 8);
const nonLatin = /[\u0590-\u05FF\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F\u0900-\u097F\u0400-\u04FF]/;
const cleanTag = value => value.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase();
const baseTags = keywords.flatMap(keyword => nonLatin.test(keyword)
  ? keyword.split(/\s+/).map(cleanTag).filter(tag => tag.length > 1)
  : [cleanTag(keyword)]).filter(Boolean);
const regionalTags = keywords.filter(keyword => !nonLatin.test(keyword)).slice(0, 2)
  .flatMap(keyword => regions.slice(0, 2).map(region => cleanTag(keyword + region))).filter(Boolean);
const hashtags = [...new Set([...baseTags, ...regionalTags])].slice(0, 12);
let searchDatePosted = '2';
const start = client.date_ranges?.current_month?.start;
const end = client.date_ranges?.current_month?.end;
if (start && end) {
  const days = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  if (Number.isFinite(days)) searchDatePosted = days <= 1 ? '1' : days <= 7 ? '2' : days <= 30 ? '3' : days <= 90 ? '4' : '5';
}
return [{ json: { ...client,
  trend_status: {
    tiktok: skipped ? 'skipped' : queries.length ? 'requested' : 'missing_keywords',
    instagram: skipped ? 'skipped' : hashtags.length ? 'requested' : 'missing_keywords',
  },
  trend_inputs: {
    tiktok: !skipped && queries.length ? {searchQueries:queries,resultsPerPage:50,searchSection:'/video',searchSorting:'1',searchDatePosted,excludePinnedPosts:true,excludeVideosWithoutText:true,shouldDownloadVideos:false,shouldDownloadCovers:false,shouldDownloadSubtitles:false} : null,
    instagram: !skipped && hashtags.length ? {hashtags,keywordSearch:false,resultsLimit:80,resultsType:'posts'} : null,
  },
} }];
