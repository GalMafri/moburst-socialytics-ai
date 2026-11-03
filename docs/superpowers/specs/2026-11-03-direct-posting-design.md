# Direct posting to social networks

Status: design, 3 Nov 2026. Nothing is built. Every API fact below comes from the network's own documentation, read on 3 Nov 2026 and listed under Sources. Where a page did not say something, or two official pages disagree, the note says so.

## Decisions for Lital

1. **Create the Meta app** (Business type, Facebook Login for Business) under Moburst's business portfolio, and complete Business Verification for that portfolio if it is not verified yet. Meta requires Advanced Access "to serve businesses that you do not own or manage", and Advanced Access requires both App Review and Business Verification. After the pilot on Moburst's own Page and Instagram works, approve the App Review submission.
2. **Create the LinkedIn developer app**, have a super admin of Moburst's LinkedIn Page verify it, and request Community Management API Development tier. After the LinkedIn pilot works, approve the Standard tier request.
3. **Give the reviewers a Socialytics login.** Meta rejects the whole submission if its reviewers cannot get into the app, and LinkedIn asks for test credentials. I propose a reviewer account with staff access to the Moburst client only.
4. **Who connects client accounts.** I propose the social team member who already holds a role on the client's Facebook Page or LinkedIn Page. Each account is connected once. LinkedIn is the exception: its refresh tokens last 365 days from the first login and then "the member must reauthorize", so whoever connected LinkedIn signs in again once a year. One sign-in covers every client Page that person administers. No documented method avoids this. Accept it, or keep LinkedIn on Sprout.
5. **TikTok and YouTube come after Meta and LinkedIn.** TikTok has an audit and per-post consent rules that our queue may not meet. YouTube has no blocker in its docs and waits only on priority.
6. **Client go-live:** approve each client before its first direct post. Until then, nothing changes for that client.

## Why

Sprout's Publishing API says "Only posts created in draft status are supported at this time" and "story posts cannot be created directly" ([Sprout API docs](https://api.sproutsocial.com/docs/), Publishing, Limitations). Every post sent from Socialytics therefore waits for someone to approve it in Sprout, and Stories cannot be sent at all. With the networks' own publishing APIs, a post goes out at its time (or now) with nobody approving it in Sprout. The Stories that Socialytics now designs (`2026-11-02-stories-design.md` on `feat/stories`) can be posted too.

## What the code does today

- `schedule-sprout-post` is staff only (`staffGate`, then `requireStaff` with `writeClientId`). It checks that the profile belongs to the client, refuses a Story by its stored format (`story.ts`), applies `publishRules.ts`, skips a second send for the same calendar post and minute, and writes `scheduled_posts`. The `feat/sprout-publish` branch adds Publish now (the earliest minute Sprout accepts, still a draft) and moves the send into `send.ts`.
- App credentials live in edge function env (`SPROUT_CLIENT_SECRET`, `CANVA_CLIENT_SECRET`). The Canva and Higgsfield sign-ins keep their refresh tokens in `integration_tokens` (RLS on, no policies). Vault holds the operational secret that the crons send.
- The scheduled-jobs worker runs every minute from pg_cron. It has one main loop and a pipeline lane that runs up to 4 jobs at once. Jobs carry `phase` (`prepared`, `posting`, `sent`), so a dispatch is never sent twice.
- `requireStaff` refuses any token from Supabase's OAuth server (the Claude connector) with `OAUTH_READ_ONLY`.
- Finished designs are PNG files 1440 px wide (`canva-finish`, `outputSize`).

## What each network allows

### Instagram

- API: Instagram API with Facebook Login for Business, for professional accounts linked to a Facebook Page. One sign-in covers the Page and its Instagram account. (My call.) An Instagram account with no linked Page would need the separate Instagram Login API, so it stays on Sprout until one exists ([Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview)).
- Permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`. If the person's Page role comes through Business Manager, also `ads_management` or `ads_read`; we ask for `ads_read`. (My call.) The person must be able to do `MANAGE` or `CREATE_CONTENT` on the linked Page. If the Page requires Page Publishing Authorization or two-factor login, those must be complete ([content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [media_publish](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish)).
- Formats ([IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)):
  - Image: JPEG only, up to 8 MB, aspect 4:5 to 1.91:1, width 320 to 1440, sRGB.
  - Carousel: up to 20 images or videos, and no Reels inside one.
  - Reel: MOV or MP4, H264 or HEVC, AAC up to 48 kHz, 23 to 60 fps, 3 seconds to 15 minutes, up to 300 MB, 9:16 recommended.
  - Story: `media_type=STORIES`, an image (JPEG, 8 MB, 9:16 recommended) or a video (3 to 60 seconds, 100 MB). Link, poll and location stickers are not supported.
- Flow: create a container from a public URL, read `status_code` "once per minute, for no more than 5 minutes" until `FINISHED`, then call `media_publish`, which returns the media id. Containers expire after 24 hours, and an account can create 400 in 24 hours. `permalink` on the media gives the link ([IG Container](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container), [IG Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media)).
- Limit: the publishing guide says 100 API-published posts in 24 hours, but the `media_publish` reference says 50. We read `content_publishing_limit` before each publish and trust neither number.
- Scheduling: `media_publish` takes no time parameter, so our queue publishes at the time.
- Our PNG designs become a JPEG copy in storage before the container is made. `canva-finish` already imports imagescript 1.3.0, which has `encodeJPEG` ([source](https://deno.land/x/imagescript@1.3.0/ImageScript.js)).

### Facebook Pages

- API: the Pages API with a Page access token ([Pages API posts](https://developers.facebook.com/docs/pages-api/posts)). Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and `publish_video` for video. The person needs `CREATE_CONTENT` ([Page feed reference](https://developers.facebook.com/docs/graph-api/reference/page/feed)). The posts guide also lists engagement permissions for the rest of that guide. We ask only for what publishing uses. (My call.)
- Formats:
  - Text or link posts go to `/{page-id}/feed`. A single photo goes to `/{page-id}/photos` with a URL and returns a post id.
  - Reels go to `/{page-id}/video_reels` (start, upload, then finish with `PUBLISHED`). Specs: 9:16, 3 to 90 seconds, 1080x1920 recommended. Pages may publish 30 Reels in 24 hours, and Meta requires a disclosure to users about how their Reels are used ([Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing)).
  - Stories go to `/{page-id}/photo_stories` (a photo uploaded with `published=false`) and `/{page-id}/video_stories`. Photos can be up to 10 MB. Videos are 9:16, 3 to 60 seconds for a Story. A Story's media cannot have been used in an earlier post, and Meta's CDN URLs are refused ([Page Stories](https://developers.facebook.com/docs/page-stories-api)).
- Posts with several images: none of the official pages I read gives the parameter that joins uploaded photos into one post. Only a forum thread shows it. Facebook multi-image posts stay on Sprout until the build finds that parameter in Meta's reference. (My call.)
- Scheduling: Facebook has its own (`scheduled_publish_time`), but the posts guide gives a 10-minute to 30-day window and the feed reference says 75 days. We use our queue, the same as every other network. (My call.)
- Limits: Pages calls are capped at 4800 times the number of engaged users per 24 hours. Throttling comes back as codes 4, 17, 32, 613 or 80001 ([rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)). `permalink_url` on the post gives the link ([Page Post](https://developers.facebook.com/docs/graph-api/reference/pagepost)).

### LinkedIn organization pages

- API: the Posts API, part of the Community Management API, with the `Linkedin-Version` header (we pin 202610; 202511 sunsets on 16 Nov 2026) ([Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)). Permission: `w_organization_social`, for members whose Page role is `ADMINISTRATOR`, `DIRECT_SPONSORED_CONTENT_POSTER` or `CONTENT_ADMIN`. We also ask for `r_organization_social` so we can find our own post again (see "Never twice" below).
- Media: images (JPG, PNG or GIF, under 36,152,320 pixels) through `initializeUpload`. Videos are MP4, 3 seconds to 30 minutes, 75 KB to 500 MB, uploaded in 4 MB parts and finalized. Their status must reach `AVAILABLE` ([Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), [Videos API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)). Multi-image posts take 2 to 20 images ([MultiImage API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api)).
- No Stories: the Posts API's content table has no Story type. No scheduling: "PUBLISHED is the only accepted field during creation". The post id comes back in `x-restli-id`, and the link is `https://www.linkedin.com/feed/update/{urn}/`.
- Limits: the Development tier allows 500 calls per app and 100 per member in 24 hours. The Standard tier has "No restrictions" ([Increasing access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access)).

### TikTok (later)

- The Content Posting API needs `video.publish` and an audit. Until the audit passes, "All content posted by unaudited clients will be restricted to private viewing mode" ([get started](https://developers.tiktok.com/doc/content-posting-api-get-started)).
- Each post must show the creator's nickname and a privacy level the person picks "with no default value", leave interaction settings unchecked, and include the commercial content disclosure. Also, "API Clients must only start sending content materials to TikTok after the user has expressly consent to the upload" ([sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines)). The docs do not say whether consent given at scheduling time covers a send hours later. Only the audit can answer that.
- Limits: 6 requests a minute per token, and an undisclosed daily cap (`spam_risk_too_many_posts`). Pulling media from a URL needs a verified domain, so we would upload the file ([Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)). Access tokens last 2 hours. Refresh tokens last 180 days and rotate on each refresh, and the docs do not say whether the 180 days restart ([token management](https://developers.tiktok.com/doc/oauth-user-access-token-management)).
- Whoever connects must hold the client's TikTok login.

### YouTube (later)

- `videos.insert` with `youtube.upload` allows 100 calls a day in its own quota bucket. The page now says "Videos uploaded from unverified API projects are not restricted to private viewing mode" ([videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [revision history](https://developers.google.com/youtube/v3/revision_history)).
- Native scheduling exists: `status.publishAt`, which works only on a private video ([videos resource](https://developers.google.com/youtube/v3/docs/videos)). Square or vertical videos up to 3 minutes count as Shorts ([YouTube Help](https://support.google.com/youtube/answer/15424877)).
- A public app must pass Google's verification: a demo video, a privacy policy and verified domains ([YouTube OAuth](https://developers.google.com/youtube/data/guides/auth/server-side-web-apps), [verification requirements](https://support.google.com/cloud/answer/13464321)). A project left in Testing gets refresh tokens that expire in 7 days, and refresh tokens unused for six months stop working ([Google OAuth](https://developers.google.com/identity/protocols/oauth2)).

## Connecting an account once

- **Who:** a Moburst staff member with write access to the client, from a new "Publishing accounts" section on Client setup.
  - Meta: the person needs a content role on the client's Page.
  - LinkedIn: the person needs one of the three Page roles above.
  - They sign in with their own account in the network's own window. Socialytics never sees a password.
- **Meta flow:** Facebook Login for Business, with a configuration that requests user tokens ([Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business)). The server exchanges the code for a long-lived user token and asks `/{user-id}/accounts` for Page tokens. Long-lived Page tokens "do not have an expiration date" ([long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived)). We keep only the Page token and drop the user token. (My call.)
- **Meta conflict:** the IG User Media reference names a user token, but the platform overview says Facebook Login apps use a "Facebook User or Page access token". The pilot proves the Page token publishes to Instagram before App Review is submitted. If it does not, the documented token that never expires is the business system user token, which Meta offers to tech providers. A client admin grants that one, so that client's admin would connect instead.
- **LinkedIn flow:** a standard authorization code flow. Access tokens last 60 days and refresh tokens 365 days, fixed from the first login ([refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)). The server refreshes the access token on its own.
- **Choosing accounts:** the connect step lists the accounts the person can post to. Accounts whose link matches one of the client's `sprout_profiles` are ticked already. The person confirms which accounts belong to the client.
- **Callback and state:** the callback goes to the edge function, so either app address works. It returns the browser only to socialytics.moburst.ai or socialytics.moburst.com. The OAuth state is single use, tied to the person and the client, kept on the server, and valid for 10 minutes.
- **Storage:**
  - Tokens go into Vault, which keeps them encrypted on disk with a key held outside the database ([Supabase Vault](https://supabase.com/docs/guides/database/vault)).
  - `social_connections` holds the account, the person who connected it, the dates and the Vault secret id. Staff read it through a view that leaves out the secret id.
  - Two security-definer functions, executable by `service_role` only, write and read the secret.
  - No function ever returns a token. (My call.) The Canva and Higgsfield tokens stay where they are, a separate change.
- **Daily check:** a new `social_connection_check` job reads each account once a day with a cheap call and refreshes LinkedIn access tokens before they expire. Meta's error guide lists a password change (460) and a lost Page role (492) among the reasons a token stops working ([error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling)). The daily check finds these days before a post is due.
- **What staff see** (facts, never error styling):
  - "Instagram posts directly. Connected by Dana on 4 Nov 2026."
  - When a connection has stopped: "Posts to this Instagram go to Sprout as drafts until it is connected again." with a Connect button.
  - From 30 days before LinkedIn's date: "LinkedIn asks for this connection to be renewed by 4 Nov 2027." with a Renew button.

## Publishing now and scheduling

- **One queue for every network.** Each direct post is a `direct_publish` row in `scheduled_jobs`. The worker gets a publish lane beside the pipeline lane, up to 4 at once, so a post due at 9:00 never waits behind a feed refresh. (My call.) Publish now queues the job for the current minute.
- **Prepare, then publish.** Every API above works in two steps: send the media, then make the post. The job prepares 15 minutes ahead for images and 60 minutes ahead for video (My call):
  - Instagram: make the JPEG and the containers, and wait for `FINISHED`.
  - LinkedIn: upload the media and wait for `AVAILABLE`.
  - Facebook: upload the unpublished photo, or start and upload the Reel.
  - At the time, only the short publish call is left.
  - The job reads the post's current copy and design when it prepares. If someone edits after that, it prepares again before the publish. (My call.)
- **Rules first.** A new `directRules.ts` holds the limits above (JPEG and ratio for Instagram, Story 9:16, LinkedIn pixel cap, video lengths). The dialog and the server check the same rules, as they already share `publishRules.ts`.
- **Never twice.**
  - A unique index allows one live direct post per calendar post and account, so a second press returns the existing state.
  - The job saves `phase = posting` before the publish call. An attempt that finds `posting` checks the network before calling again:
    - Instagram: the container's `PUBLISHED` status.
    - LinkedIn: the organization's newest posts (`r_organization_social`).
    - Facebook: the Page's newest posts.
  - The job publishes again only if the post is not there. A Facebook 506 "Duplicate Post" is recorded and never retried.
- **Quiet retries.**
  - Throttling and outages are retried after 1, 2, 5 and 10 minutes, for up to 2 hours past the time. These are Meta codes 1, 2, 4, 17, 341, 368 and 80001, LinkedIn 409, 429, 500 and 503, and network timeouts. (My call.)
  - The card reads "Publishing" during retries. If the 2 hours run out, or the connection has stopped, a feed post goes to Sprout as a draft for the earliest minute, the path that exists today. The card then says so in Sprout's existing words.
  - A Story has no Sprout path. Its card reads "Not posted. Instagram didn't take this Story by 11:00."
  - When the network refuses the content (container `ERROR`, LinkedIn 422), retrying won't help. The card names the fix in plain words, for example "Instagram couldn't use this video file."
- **After publishing.**
  - The `scheduled_posts` row gets `status = 'published'`, the network's post id, the permalink and `published_at`. The card reads "Published 9:00", with "View on Instagram".
  - Analytics keep coming from Sprout. Sprout's help center says its calendar shows posts "posted natively on the social network or through another social media management tool", and that a post ingested into Sprout stays in Post Performance reporting ([Sprout calendar help](https://support.sproutsocial.com/hc/en-us/articles/38373940164877-Troubleshooting-Sprout-Social-Publishing-Calendar-Issues), read through search results because the page refused a direct fetch). Sprout's API docs do not say this.
  - The reports read Sprout's `analytics/posts` (`_shared/sprout/posts.ts`), so nothing changes there as long as the profile stays connected in Sprout. The pilot confirms it the next day by matching the permalink.

## Next to Sprout

Sprout stays for analytics, which every report, reference and onboarding job reads. It also stays for every account that is not connected directly, and as the fallback above. For such a client nothing changes.

In the dialog, each of the client's accounts shows one line: "Posts directly" or "Goes to Sprout as a draft". The line is decided by whether a working connection exists, with no setting. (My call.) A post that is already in Sprout as a draft is not offered direct posting, so it can never go out both ways.

Stories get the Schedule tab only when the client's Facebook or Instagram account is connected directly. Otherwise the Stories design's "post by hand" line stays.

## Security

- **Who can act:**
  - Connect, publish, schedule and cancel are open to Moburst staff with write access to the client (`requireStaff` with `writeClientId`). Company-scoped staff act only for their companies. Client users cannot do any of these.
  - The worker publishes as the system and records who asked.
  - The public API gets no publishing route. (My call.)
- **The Claude connector can never publish.** `requireStaff` already refuses its tokens. The `mcp` server gets no publishing tool. The new tables get the same restrictive "OAuth sessions cannot" policies as the other tables. A test pins each of the three.
- **Audit:** `social_publish_log` is append-only, written by the service role, with no update or delete grant. It records who connected, renewed or disconnected an account, and who scheduled, published now, cancelled or edited a scheduled post. It also records what happened: published, sent to Sprout, not posted, the network post id and the time. Staff can read it.
- **Secrets:** app secrets (`META_APP_SECRET`, `LINKEDIN_CLIENT_SECRET`) go in edge function env, like Sprout's. Logs and stored reasons strip tokens, as `posts.ts` already strips Bearer values.

## Costs

- **API fees:** none of the network pages I read lists a price for these APIs. They set quotas. Sprout seats stay as they are.
- **Running cost:** one JPEG copy per image post in storage, and one job per post. That is small next to design generation. I will give a [figure] after the pilot.
- **Review effort:**
  - Meta: a screencast showing each permission in use, plus test instructions and the reviewer login.
  - LinkedIn: a narrated screencast of the OAuth flow and a post, a company and product overview, a privacy policy and test credentials.
  - Business Verification documents, if Moburst's portfolio isn't verified.
- **Upkeep:** a yearly LinkedIn version bump, and Graph API version bumps (Instagram's reference is on v26.0).

## Approvals and timelines, as the docs state them

- **Meta:** permissions needing review "are generally reviewed within 3 business days", some take up to 7 days, and the same page warns "it may take several weeks" ([permissions review](https://developers.facebook.com/docs/facebook-login/guides/permissions/review)). The Meta pages I read give no duration for Business Verification. Standard Access works only for people with a role on the app, so the pilot on Moburst's own accounts needs no review ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels), [Business Verification](https://developers.facebook.com/docs/development/release/business-verification)).
- **LinkedIn:** the pages give no duration. Development tier is checked for the use case, business email, organization and Page verification. Standard tier needs a working integration and a screencast, and LinkedIn "reserves the right" not to upgrade ([Community Management review](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review)).
- **TikTok and Google:** the pages I read give no duration for the audit or for verification.

## Risks

- **Instagram token:** the Page token may not publish to Instagram (the docs conflict). The pilot settles it before review.
- **Meta fetching our files:** Meta must reach our storage URLs, and Reels require a robots.txt that lets `facebookexternalhit` fetch. The pilot proves it. Where Meta takes a direct upload, we upload the bytes instead.
- **Our videos:** Higgsfield output may not meet Instagram's codec rules. The pilot runs a sample, and the container status says so plainly.
- **Review outcomes:** Meta App Review or LinkedIn Standard tier could be refused. Sprout keeps working throughout.
- **Who connected:** a staff member who leaves takes their Meta and LinkedIn connections with them. The daily check shows this the same day.
- **LinkedIn refresh tokens:** the refresh token page names approved Marketing Developer Platform partners. If our app gets no refresh token, LinkedIn renewal comes every 60 days.

## Rollout

0. **Lital, now:** create the Meta and LinkedIn apps, Business Verification, the reviewer login (decisions 1 to 3).
1. **Meta build:** connections, Vault, publish lane, rules, dialog and audit. Facebook text, single image, Reel and Story; Instagram image, carousel, Reel and Story. Pilot on Moburst's own Page and Instagram under Standard Access, Lital reviews it, then App Review is submitted.
2. **LinkedIn:** pilot on Moburst's Page in Development tier, then the Standard tier request.
3. **Clients:** client by client after Lital approves each one. The social team connects each account once.
4. **TikTok and YouTube**, if Lital wants them.

## Tests

- `directRules.test.ts`: each network's limits, Stories only on Facebook and Instagram, JPEG required for Instagram.
- `publishJob.test.ts`: prepare and publish against the documented answers:
  - container `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED` and `PUBLISHED`;
  - Meta 190 with 460 and 492, 506, 4, 17 and 80001;
  - LinkedIn 201 with `x-restli-id`, 401, 422 and 429;
  - an answer lost after `posting` is found again and never sent twice;
  - an edit after preparing is prepared again;
  - after 2 hours, the post falls back to Sprout.
- `connections.test.ts`: a token is never in any response or log; staff without write access, client users and OAuth tokens are refused; the state is single use and expires.
- Migration test: authenticated users cannot read Vault, the secret id or the log's write path; the OAuth-session policies are on the new tables.
- `mcp` tools test: no tool publishes, schedules or connects.
- Worker test: the publish lane runs 4 at once and does not block the main loop.
- App tests: the dialog's route line comes from the data; Stories get Schedule only when connected; Published and Sprout states read in plain words.
- Live pilot checklist: each format once, now and scheduled, edit, cancel, reconnect, and the post seen in Sprout analytics the next day.

## Files

Create:
- `supabase/migrations/20261104120000_direct_posting.sql`: `social_connections` and its staff view, `social_publish_log`, new `scheduled_posts` columns (`route`, `connection_id`, `network_post_id`, `permalink`, `published_at`), the Vault functions, the new job kinds, the publish lane lease and the OAuth policies.
- `supabase/functions/social-connect/index.ts`.
- `supabase/functions/publish-post/index.ts`: the dialog's single entry point. It routes direct or to Sprout by the data.
- `supabase/functions/_shared/social/`: `connections.ts`, `meta.ts`, `linkedin.ts`, `directRules.ts`, `media.ts`, `publishJob.ts` and `log.ts`, each with a test.
- `supabase/functions/run-scheduled-jobs/publishLane.ts`.
- `src/components/clients/PublishingAccounts.tsx`.

Change:
- `run-scheduled-jobs/index.ts`, `worker.ts` and `store.ts`.
- `_shared/scheduled-jobs/types.ts`.
- `_shared/sprout/publishRules.ts`: the Story sentence applies to Sprout only.
- `send.ts` moves to `_shared/sprout/send.ts`, so `publish-post` can import it (a function imports only its own folder and `_shared`).
- `schedule-sprout-post/index.ts`.
- `mcp/tools.test.ts`.
- `src/pages/ClientSetup.tsx`, `src/components/reports/SchedulePostModal.tsx`, `src/components/reports/calendar/PostPanel.tsx`, `postStatus.ts` and `PostStatusChip.tsx`.

## Sources

Read 3 Nov 2026.

- Sprout: https://api.sproutsocial.com/docs/ ; https://support.sproutsocial.com/hc/en-us/articles/38373940164877-Troubleshooting-Sprout-Social-Publishing-Calendar-Issues (through search results)
- Meta, Instagram: https://developers.facebook.com/docs/instagram-platform/content-publishing/ ; https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media ; https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish ; https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-container ; https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media ; https://developers.facebook.com/docs/instagram-platform/overview ; https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token
- Meta, Pages: https://developers.facebook.com/docs/pages-api/posts ; https://developers.facebook.com/docs/graph-api/reference/page/feed ; https://developers.facebook.com/docs/graph-api/reference/pagepost ; https://developers.facebook.com/docs/page-stories-api ; https://developers.facebook.com/docs/video-api/guides/reels-publishing
- Meta, access and review: https://developers.facebook.com/docs/graph-api/overview/access-levels ; https://developers.facebook.com/docs/app-review ; https://developers.facebook.com/docs/development/release/business-verification ; https://developers.facebook.com/docs/facebook-login/guides/permissions/review ; https://developers.facebook.com/docs/facebook-login/facebook-login-for-business ; https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived ; https://developers.facebook.com/docs/marketing-api/system-users/overview ; https://developers.facebook.com/docs/graph-api/overview/rate-limiting ; https://developers.facebook.com/docs/graph-api/guides/error-handling
- LinkedIn: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api ; https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review ; https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api ; https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/multiimage-post-api (through search results)
- TikTok: https://developers.tiktok.com/doc/content-posting-api-get-started ; https://developers.tiktok.com/doc/content-sharing-guidelines ; https://developers.tiktok.com/doc/content-posting-api-reference-direct-post ; https://developers.tiktok.com/doc/oauth-user-access-token-management
- YouTube and Google: https://developers.google.com/youtube/v3/docs/videos/insert ; https://developers.google.com/youtube/v3/docs/videos ; https://developers.google.com/youtube/v3/revision_history ; https://developers.google.com/youtube/data/guides/auth/server-side-web-apps ; https://developers.google.com/identity/protocols/oauth2 ; https://support.google.com/cloud/answer/13464321 ; https://support.google.com/youtube/answer/15424877
- Supabase and libraries: https://supabase.com/docs/guides/database/vault ; https://deno.land/x/imagescript@1.3.0/ImageScript.js

Not reachable: Meta's token debugging page (404) and Meta's Business Verification help article (no text came back).
