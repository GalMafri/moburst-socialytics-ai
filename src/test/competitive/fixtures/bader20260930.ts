// Bader Law's competitive report for September 2026 (1c4f4805), as stored on
// 7 Oct 2026: every company's stored figures (RivalIQ's period totals without
// the daily series, the client's Sprout figures, the stored sample counts and
// rates), the client's stored Sprout posts (ad rows marked by their "fa:"
// guid), and the client's text as the model wrote it. Read from the live
// database on 20 Oct 2026; nothing here is invented.

const both = (current: number | null, previous: number | null) => ({ current, previous });
const rq = (rate: [number, number], posts: [number, number], engagement: [number, number], impressions: [number, number], extra: Record<string, unknown> = {}) => ({
  rate: both(...rate), posts: both(...posts), engagement: both(...engagement), impressions: both(...impressions), ...extra,
});
const sprout = (id: string, rate: [number, number], posts: [number, number], followers: [number, number], engagement: [number, number], impressions: [number | null, number | null]) => ({
  rate: both(...rate), posts: both(...posts), source: "sprout", profiles: [{ id, name: "Bader Law" }], followers: both(...followers), engagement: both(...engagement), impressions: both(...impressions), impressions_kind: "actual",
});
const period = { start: "2026-09-01", end: "2026-09-30" };
const channels = (rows: Record<string, [number, number]>) => Object.fromEntries(Object.entries(rows).map(([k, [count, rate]]) => [k, { post_count: count, observed_post_count: count, engagement_rate_avg: rate }]));

export const BADER_COMPANIES = [
  {
    name: "Bader Law", company_id: "1916178", is_client: true, post_count: 94, observed_post_count: 94, cadence_per_week: 21.9, engagement_rate_avg: 0.285752285271338,
    by_channel: channels({ tiktok: [12, 1.699472996515679], twitter: [0, 0], youtube: [19, 0.21079822421313402], facebook: [42, 0.002155298322424613], linkedin: [8, 0.00214800125568213], instagram: [13, 0.006563983504272368] }),
    owned_metrics: { period, coverage: "complete", provider: "sprout", by_network: {
      tiktok: sprout("7473315", [1.699472996515679, 0.032], [12, 5], [42, 25], [511, 4], [90167, 466]),
      youtube: sprout("7481075", [0.21079822421313402, 0.01931480083172267], [19, 12], [231, 221], [908, 51], [null, null]),
      facebook: sprout("7480884", [0.002155298322424613, 0.00015756001596295167], [42, 26], [8367, 8303], [755, 34], [235735, 3470]),
      linkedin: sprout("7480878", [0.00214800125568213, 0.0019942158190908326], [8, 8], [3646, 3557], [62, 56], [2705, 3598]),
      instagram: sprout("7480921", [0.006563983504272368, 0.0033787780865808716], [13, 8], [5169, 5086], [437, 137], [21477, 8369]),
    } },
    rivaliq_metrics: { period, posts: both(54, 31), audience: both(15056, 14901), engagement: both(2533, 207), estimated_impressions: both(2097537, 16280), engagement_rate_per_post: both(0.014159381079086823, 0.0015488794941823487), likely_boosted_facebook_posts: both(1, 0), by_network: {
      tiktok: rq([1.5391566265060241, 0.032], [12, 5], [511, 4], [90170, 465], { views: both(90170, 465), followers: both(42, 25) }),
      twitter: rq([0, 0], [0, 0], [0, 0], [0, 0]),
      youtube: rq([0.25055187637969095, 0.03313840155945419], [16, 7], [908, 51], [1759590, 6926], { views: both(1759590, 6926), followers: both(231, 221) }),
      facebook: rq([0.0062482694970004615, 0.00016397743670470944], [13, 11], [677, 15], [230566, 1808], { followers: both(8364, 8317), likely_boosted: both(1, 0) }),
      instagram: rq([0.00656294115880215, 0.0033822984816689297], [13, 8], [437, 137], [17211, 7081], { followers: both(5168, 5086) }),
    } },
    rivaliq_audience_snapshot: { as_of: "2026-10-06", source: "rivaliq", audience: 15108, by_network: { tiktok: 68, youtube: 235, facebook: 8375, instagram: 5179 } },
  },
  {
    name: "TopDog Law", company_id: "1916218", is_client: false, post_count: 50, observed_post_count: 50, cadence_per_week: 11.7, engagement_rate_avg: 0.0007411125269342183,
    by_channel: channels({ tiktok: [0, 0], twitter: [0, 0], youtube: [0, 0], facebook: [22, 0.0006884739274856624], instagram: [28, 0.0007466905963799536] }),
    rivaliq_metrics: { period, posts: both(50, 39), audience: both(683428, 682533), engagement: both(11538, 14601), estimated_impressions: both(900620, 627714), engagement_rate_per_post: both(0.0007411125269342183, 0.001241046062179799), likely_boosted_facebook_posts: both(0, 0), by_network: {
      tiktok: rq([0, 0], [0, 0], [0, 0], [0, 0], { views: both(0, 0), followers: both(88501, 88428) }),
      twitter: rq([0, 0], [0, 0], [0, 0], [0, 0]),
      youtube: rq([0, 0], [0, 0], [0, 0], [0, 0], { views: both(0, 0), followers: both(4180, 4110) }),
      facebook: rq([0.0006884739274856624, 0.00036526562974103247], [22, 18], [1027, 443], [302809, 51337], { followers: both(67933, 67653), likely_boosted: both(0, 0) }),
      instagram: rq([0.0007466905963799536, 0.0013417032315071115], [28, 21], [10511, 14158], [597811, 576377], { followers: both(503261, 502727) }),
    } },
    rivaliq_audience_snapshot: { as_of: "2026-10-06", source: "rivaliq", audience: 683859, by_network: { tiktok: 88509, youtube: 4190, facebook: 68006, instagram: 503643 } },
  },
  {
    name: "Morgan & Morgan P.A.", company_id: "1916221", is_client: false, post_count: 51, observed_post_count: 51, cadence_per_week: 11.9, engagement_rate_avg: 0.002308763408265893,
    by_channel: channels({ tiktok: [4, 0.00019292356368406837], twitter: [9, 0.00039582013932868906], youtube: [2, 0.0006818181818181819], facebook: [16, 0.00042507891984950815], instagram: [20, 0.005295032921829801] }),
    rivaliq_metrics: { period, posts: both(51, 49), audience: both(385867, 376954), engagement: both(11459, 39156), estimated_impressions: both(396194, 570667), engagement_rate_per_post: both(0.002308763408265893, 0.008959613095551358), likely_boosted_facebook_posts: both(0, 0), by_network: {
      tiktok: rq([0.00019292356368406837, 0.05760981427045661], [4, 5], [80, 29613], [4489, 218481], { views: both(4489, 218481), followers: both(104069, 102972) }),
      twitter: rq([0.00039582013932868906, 0.002878593379235228], [9, 10], [55, 444], [5270, 8498]),
      youtube: rq([0.0006818181818181819, 0.0014882506527415143], [2, 3], [18, 57], [750, 3429], { views: both(750, 3429), followers: both(13400, 13000) }),
      facebook: rq([0.00042507891984950815, 0.0007081903211447711], [16, 14], [1039, 1486], [96943, 124729], { followers: both(153724, 151410), likely_boosted: both(0, 0) }),
      instagram: rq([0.005295032921829801, 0.004826872057866249], [20, 17], [10267, 7556], [288742, 215530], { followers: both(99230, 94132) }),
    } },
    rivaliq_audience_snapshot: { as_of: "2026-10-06", source: "rivaliq", audience: 387847, by_network: { tiktok: 104400, youtube: 13400, facebook: 154190, instagram: 100411 } },
  },
  {
    name: "reyeslaw.com", company_id: "1955972", is_client: false, post_count: 33, observed_post_count: 33, cadence_per_week: 7.7, engagement_rate_avg: 0.001352588018785386,
    by_channel: channels({ tiktok: [5, 0.004195940671350508], youtube: [6, 0.0041081081081081085], facebook: [9, 0.0004823391150225666], instagram: [13, 0.0028283104476591672] }),
    rivaliq_metrics: { period, posts: both(33, 58), audience: both(41623, 41624), engagement: both(538, 615), estimated_impressions: both(33274, 47518), engagement_rate_per_post: both(0.001352588018785386, 0.000832673287434757), likely_boosted_facebook_posts: both(0, 0), by_network: {
      tiktok: rq([0.004195940671350508, 0.004488950276243094], [5, 10], [43, 91], [1116, 2996], { views: both(1116, 2996), followers: both(2060, 2041) }),
      youtube: rq([0.0041081081081081085, 0.003891820580474934], [6, 10], [38, 59], [530, 600], { views: both(530, 600), followers: both(1560, 1530) }),
      facebook: rq([0.0004823391150225666, 0.00041084163297128314], [9, 18], [126, 215], [11585, 20245], { followers: both(28999, 29058), likely_boosted: both(0, 0) }),
      instagram: rq([0.0028283104476591672, 0.0013901477449023282], [13, 20], [331, 250], [20043, 23677], { followers: both(9004, 8995) }),
    } },
    rivaliq_audience_snapshot: { as_of: "2026-10-06", source: "rivaliq", audience: 41611, by_network: { tiktok: 2063, youtube: 1560, facebook: 28993, instagram: 8995 } },
  },
];

// The client's stored Sprout posts: [ad row ("fa:" guid), channel, published, engagement, impressions, views].
const ROWS: Array<[0 | 1, string, string, number, number | null, number | null]> = [
  [0, "youtube", "2026-09-01T14:00:32", 6, null, 596533], [1, "facebook", "2026-09-03T09:45:06", 0, 0, 0], [1, "facebook", "2026-09-03T09:45:17", 0, 0, 0], [1, "facebook", "2026-09-03T09:45:18", 0, 0, 0], [1, "facebook", "2026-09-03T09:47:47", 0, 0, 0], [1, "facebook", "2026-09-03T09:47:48", 0, 0, 0],
  [0, "tiktok", "2026-09-03T19:00:15", 1, 97, 97], [0, "instagram", "2026-09-03T19:03:07", 12, 307, 307], [1, "facebook", "2026-09-04T13:55:37", 0, 0, null], [1, "facebook", "2026-09-04T13:58:34", 0, 0, null], [1, "facebook", "2026-09-07T14:07:42", 0, 0, 0], [0, "facebook", "2026-09-07T17:02:16", 2, 152, null],
  [0, "linkedin", "2026-09-07T17:04:08", 3, 244, null], [0, "instagram", "2026-09-07T17:06:35", 4, 576, null], [0, "facebook", "2026-09-08T18:30:38", 3, 130, 27], [0, "instagram", "2026-09-08T18:32:36", 3, 190, 190], [0, "youtube", "2026-09-08T18:34:26", 2, null, 43], [0, "tiktok", "2026-09-08T18:36:01", 0, 89, 89],
  [1, "facebook", "2026-09-09T13:46:57", 0, 0, null], [1, "facebook", "2026-09-09T13:46:57", 0, 0, null], [0, "youtube", "2026-09-09T15:16:31", 353, null, 277864], [0, "facebook", "2026-09-09T15:18:34", 46, 13341, 8670], [0, "instagram", "2026-09-09T15:22:36", 193, 11926, 11926], [0, "tiktok", "2026-09-09T15:37:01", 5, 142, 142],
  [0, "linkedin", "2026-09-09T15:37:27", 25, 904, 356], [1, "facebook", "2026-09-09T16:51:12", 0, 0, 0], [1, "facebook", "2026-09-11T14:23:07", 0, 0, 0], [0, "facebook", "2026-09-11T18:00:42", 4, 318, 63], [0, "instagram", "2026-09-11T18:04:07", 4, 547, 547], [0, "youtube", "2026-09-11T18:06:25", 2, null, 48],
  [0, "tiktok", "2026-09-11T18:09:01", 3, 61, 61], [0, "tiktok", "2026-09-12T15:42:01", 2, 85, 85], [0, "facebook", "2026-09-13T15:33:29", 2, 331, 72], [0, "instagram", "2026-09-13T15:36:35", 0, 280, 280], [0, "youtube", "2026-09-13T15:39:19", 2, null, 99], [0, "linkedin", "2026-09-14T14:30:50", 5, 287, 116],
  [0, "facebook", "2026-09-14T16:46:24", 3, 259, 48], [0, "instagram", "2026-09-14T17:27:10", 10, 1025, 1025], [0, "youtube", "2026-09-14T17:28:51", 1, null, 28], [0, "tiktok", "2026-09-14T17:32:01", 1, 70, 70], [1, "facebook", "2026-09-15T08:36:27", 0, 0, 0], [0, "youtube", "2026-09-15T14:00:15", 15, null, 510525],
  [0, "facebook", "2026-09-16T18:40:39", 10, 280, 63], [0, "linkedin", "2026-09-16T18:42:19", 15, 428, 174], [0, "instagram", "2026-09-16T18:45:37", 39, 1052, 1052], [0, "youtube", "2026-09-16T18:50:52", 2, null, 236], [0, "tiktok", "2026-09-16T18:52:01", 1, 99, 99], [1, "facebook", "2026-09-17T11:03:00", 0, 0, 0],
  [1, "facebook", "2026-09-17T11:03:11", 0, 0, 0], [1, "facebook", "2026-09-17T11:03:11", 0, 0, 0], [1, "facebook", "2026-09-17T11:03:11", 0, 0, 0], [1, "facebook", "2026-09-17T11:03:12", 0, 0, null], [1, "facebook", "2026-09-17T11:03:12", 0, 0, 0], [1, "facebook", "2026-09-17T11:05:01", 0, 0, 0],
  [1, "facebook", "2026-09-17T11:05:01", 0, 0, 0], [1, "facebook", "2026-09-17T11:05:01", 0, 0, 0], [1, "facebook", "2026-09-17T11:05:02", 0, 0, null], [1, "facebook", "2026-09-17T11:07:30", 0, 0, null], [1, "facebook", "2026-09-17T13:39:04", 0, 0, 0], [1, "facebook", "2026-09-17T13:39:57", 0, 0, 0],
  [0, "youtube", "2026-09-18T12:08:21", 0, null, null], [0, "youtube", "2026-09-18T12:28:57", 0, null, null], [0, "youtube", "2026-09-18T12:33:23", 0, null, null], [0, "facebook", "2026-09-19T15:47:29", 1, 97, 24], [0, "linkedin", "2026-09-19T17:21:07", 2, 229, 68], [0, "youtube", "2026-09-21T23:00:38", 1, null, 10],
  [1, "facebook", "2026-09-22T11:00:36", 0, 0, 0], [0, "youtube", "2026-09-22T16:09:28", 1, null, 29], [0, "instagram", "2026-09-22T16:09:38", 3, 230, 230], [0, "tiktok", "2026-09-22T17:51:10", 1, 110, 110], [0, "facebook", "2026-09-22T17:56:02", 1, 308, 103], [0, "facebook", "2026-09-23T17:23:45", 681, 220048, 164967],
  [0, "youtube", "2026-09-23T17:26:48", 515, null, 361634], [0, "instagram", "2026-09-23T17:31:10", 146, 3719, 3719], [0, "tiktok", "2026-09-23T17:34:01", 493, 89065, 89065], [1, "facebook", "2026-09-24T14:18:15", 0, 0, null], [1, "facebook", "2026-09-24T17:47:10", 0, 0, 0], [0, "facebook", "2026-09-25T15:36:33", 1, 140, 24],
  [0, "instagram", "2026-09-25T15:40:05", 3, 382, 382], [0, "youtube", "2026-09-25T15:41:35", 4, null, 87], [0, "tiktok", "2026-09-25T15:44:01", 1, 54, 54], [0, "linkedin", "2026-09-26T08:52:39", 5, 248, 104], [0, "youtube", "2026-09-26T16:58:38", 1, null, 113], [0, "facebook", "2026-09-26T17:52:12", 0, 70, 17],
  [0, "youtube", "2026-09-28T13:57:11", 1, null, 56], [0, "youtube", "2026-09-29T14:00:10", 1, null, 17], [0, "instagram", "2026-09-29T16:01:01", 16, 796, 796], [0, "youtube", "2026-09-29T17:34:33", 1, null, 34], [0, "tiktok", "2026-09-29T18:00:16", 1, 115, 115], [0, "linkedin", "2026-09-29T18:05:23", 5, 169, 64],
  [0, "facebook", "2026-09-29T18:10:45", 1, 261, 63], [0, "tiktok", "2026-09-30T18:05:02", 2, 180, 180], [0, "linkedin", "2026-09-30T18:05:21", 2, 196, 72], [0, "instagram", "2026-09-30T18:06:05", 4, 447, 447],
];

export const BADER_POSTS = ROWS.map(([ad, channel, at, engagement, impressions, views], i) => ({
  postId: `sprout:${ad ? "fa:62392002280_" : "p:"}${i}`, source: "sprout", companyId: "1916178", companyName: "Bader Law", channel, publishedAt: `${at}Z`,
  engagementTotal: engagement, ownedImpressions: impressions, views, message: "", type: "video",
}));

/** The stored report: its period, its companies, and the client's text as the model wrote it. */
export const BADER_REPORT = {
  period: { ...period, days: 30 },
  totals: { posts_analyzed: 228 },
  aggregates: { metric_semantics_version: 4, period: { ...period, days: 30 }, total_posts_analyzed: 228, companies: BADER_COMPANIES },
  ai_analysis: {
    executive_summary: "Publishing: 94 tracked posts from Bader Law in this period, compared with 59 in the previous equal-length period.\n\nEngagement: 28.58% is Bader Law's average engagement rate per post on RivalIQ-tracked networks (excluding LinkedIn), versus 0.83% previously.",
    competitor_breakdowns: [
      { name: "Bader Law", is_client: true,
        engagement_level: "Engagement rate per post at 28.6% is inflated by small-follower TikTok; Facebook and Instagram rates are much lower.",
        posting_frequency: "High-volume month at 94 posts, with the heaviest lift on Facebook and steady support from YouTube, Instagram, and TikTok.",
        platform_notes: [
          { platform: "facebook", note: "42 posts; video-first feed with some links, clustered Thu and 11:00–18:00 UTC." },
          { platform: "instagram", note: "13 posts; nearly all video, concentrated 15:00–19:00 UTC with recurring branded/local hashtags." },
          { platform: "tiktok", note: "12 posts; all video, mostly 15:00–19:00 UTC; follower base is tiny so rate swings are extreme." },
          { platform: "youtube", note: "19 posts; all video with high views totals, posted mainly 12:00–18:00 UTC." },
        ] },
      { name: "TopDog Law", is_client: false, engagement_level: "Engagement rate per post at 0.07% reflects huge audience scale; engagement volume stays high via frequent incident posts.", posting_frequency: "50 posts total, split mainly between Instagram and Facebook with consistent weekday publishing." },
      { name: "Morgan & Morgan P.A.", is_client: false, engagement_level: "Engagement rate per post at 0.23% is driven mainly by Instagram; TikTok rate is minimal this month." },
      { name: "Reyes Law", is_client: false, engagement_level: "Engagement rate per post at 0.14% with small-to-mid audience size; TikTok and YouTube rates are higher than Facebook." },
    ],
    gaps_for_client: [
      { gap: "Systematize a weekly “case story” series on Instagram", platform: "instagram", suggested_play: "Instagram: 2 Reels/week in a “Case in 30 Seconds” series with a 1-question comment CTA; target 0.8%+ rate per post and track comments per post.", why_it_matters: "TopDog Law’s repeatable incident framing and Morgan & Morgan P.A.’s campaign drops show how series packaging sustains attention at scale." },
      { gap: "Turn YouTube volume into a Shorts-first engine", platform: "youtube", suggested_play: "YouTube: 3 Shorts/week cut from existing videos + 1 longform/week; target 0.10%+ engagement rate per post and track 3-second view rate.", why_it_matters: "19 YouTube uploads in-period is high; without a Shorts system, learnings from hooks and retention won’t compound." },
      { gap: "Build a TikTok series that scales beyond giveaways", platform: "tiktok", suggested_play: "TikTok: 3 videos/week alternating “Myth vs Fact” and “Ask Seth” formats; target 200+ avg views per post and track completion rate trend.", why_it_matters: "TikTok rate is extremely high on a 42-follower base, so a single viral post can mislead; a series builds steadier signal." },
    ],
    recommended_schedule: { by_hour: { "12": 3, "18": 12, "22": 4 }, by_weekday: { Fri: 3, Mon: 3, Sat: 1, Sun: 1, Thu: 4, Tue: 4, Wed: 3 }, rationale: "Reduce from 94 posts to 19/week and concentrate into repeatable series, keeping Thu/Tue weight where the landscape is active. Test 12:00, 18:00, and 22:00 UTC for 4 weeks and compare engagement rate per post by network." },
  },
};
