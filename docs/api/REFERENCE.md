# Socialytics API reference

<!-- Generated from the route table by `npm run api:gen`. Do not edit by hand: change the routes and regenerate. -->

Everything Socialytics holds for the clients a key may see (clients with their brand, pillars and design, social and competitive reports with their decks, competitor sets, generated posts and media, schedules, scheduled posts, competitive alerts, design systems, Sprout performance, health), plus the ad-hoc demo job that onboards any brand from a name and a website and runs every feature for it, and what Socialytics' paid providers cost per client, service and period (the costs scope). Authenticate with `Authorization: Bearer <key>`. The personal key routes under /v1/me take a Socialytics sign-in session instead, for Moburst staff only. Lists are paginated with `limit` and `cursor`.

Version 1. The live copy of this document is `GET /v1/openapi.json` on the deployed API.

## Operations

### Admin

#### `DELETE /v1/admin/keys/{id}`

Revoke an API key. Admin only.

Returns: [Empty](#empty)

#### `GET /v1/admin/keys`

List API keys. Admin only.

Returns: [ApiKeyList](#apikeylist)

#### `POST /v1/admin/keys`

Create an API key (the key is returned once). Admin only.

Body: [ApiKeyCreate](#apikeycreate)

Returns: [ApiKeyCreated](#apikeycreated)

### Clients

#### `GET /v1/clients`

List clients. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `q` | string | Part of the client name. |
| `company_slug` | string |  |
| `include_archived` | boolean |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [ClientList](#clientlist)

#### `GET /v1/clients/{id}`

One client with its profiles, competitor sets and schedules. Scope: `read`.

Returns: [Client](#client)

#### `GET /v1/clients/{id}/analytics`

Sprout performance for a client over a window (default: the last 30 days). Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `start` | string | yyyy-mm-dd |
| `end` | string | yyyy-mm-dd |

Returns: [Analytics](#analytics)

#### `GET /v1/clients/{id}/setup`

Readiness of a client (brand, pillars, keywords, Sprout, competitors, design, schedule). Scope: `read`.

Returns: [Setup](#setup)

### Competitive

#### `GET /v1/alerts`

List competitive alerts. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [AlertList](#alertlist)

#### `GET /v1/competitive-reports`

List competitive reports. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | "running" \| "complete" \| "failed" |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [CompetitiveReportList](#competitivereportlist)

#### `GET /v1/competitive-reports/{id}`

One competitive report with its analysis and per-company aggregates. Scope: `read`.

Returns: [CompetitiveReport](#competitivereport)

#### `GET /v1/competitor-sets`

List competitor sets with their competitors and handles. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | "draft" \| "confirmed" \| "analyzing" \| "complete" \| "failed" |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [CompetitorSetList](#competitorsetlist)

#### `GET /v1/competitor-sets/{id}`

One competitor set. Scope: `read`.

Returns: [CompetitorSet](#competitorset)

### Costs

#### `GET /v1/cost-events`

Individual charges, newest first. Scope: `costs`.

| Query | Type | Description |
|---|---|---|
| `from` | string |  |
| `to` | string |  |
| `client_id` | string |  |
| `company_slug` | string |  |
| `provider` | "anthropic" \| "openai" \| "gemini" \| "lovable_ai" \| "apify" \| "gamma" \| "higgsfield" \| "firecrawl" \| "tribe" \| "snowflake" \| "jina" |  |
| `resource` | string |  |
| `feature` | string |  |
| `bucket` | "client" \| "shared" \| "dev_qa" |  |
| `env` | string |  |
| `execution_id` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [CostEventList](#costeventlist)

#### `GET /v1/cost-pricing`

The price list in force on a date. Scope: `costs`.

| Query | Type | Description |
|---|---|---|
| `at` | string | ISO date. Default: today. |

Returns: [CostPricing](#costpricing)

#### `GET /v1/costs`

What this tool's paid providers cost, per client, service and period. Scope: `costs`.

| Query | Type | Description |
|---|---|---|
| `from` | string | Start, inclusive (ISO date or date-time). Default: 30 days before to. |
| `to` | string | End, exclusive. Default: now. |
| `group_by` | string | Comma list of day, week, month, client, provider, resource, feature, bucket, env. Empty: one total. |
| `client_id` | string |  |
| `company_slug` | string |  |
| `provider` | "anthropic" \| "openai" \| "gemini" \| "lovable_ai" \| "apify" \| "gamma" \| "higgsfield" \| "firecrawl" \| "tribe" \| "snowflake" \| "jina" |  |
| `resource` | string | A model or actor id. |
| `feature` | string |  |
| `bucket` | "client" \| "shared" \| "dev_qa" |  |
| `env` | string |  |
| `execution_id` | string |  |

Returns: [CostSummary](#costsummary)

### Demo

#### `GET /v1/demo-jobs`

List demo jobs. Scope: `demo`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [DemoJobList](#demojoblist)

#### `GET /v1/demo-jobs/{id}`

Progress and outputs of a demo job. Scope: `demo`.

Returns: [DemoJob](#demojob)

#### `POST /v1/demo-jobs`

Onboard a client and run every feature for it. Scope: `demo`.

Body: [DemoInput](#demoinput)

Returns: [DemoJob](#demojob)

#### `POST /v1/demo-jobs/{id}/cancel`

Cancel a queued or running demo job. Scope: `demo`.

Returns: [DemoJob](#demojob)

#### `POST /v1/demo-jobs/{id}/discard`

Remove what a finished demo job created. Scope: `demo`.

Returns: [Discarded](#discarded)

### Design

#### `GET /v1/design-systems`

List design systems. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [DesignSystemList](#designsystemlist)

### Personal keys

#### `DELETE /v1/me/keys/{id}`

Revoke one of your personal API keys (needs your signed-in Socialytics session).

Returns: [PersonalKeyRevoked](#personalkeyrevoked)

#### `GET /v1/me/keys`

List your personal API keys (needs your signed-in Socialytics session).

Returns: [PersonalKeyList](#personalkeylist)

#### `POST /v1/me/keys`

Make a personal API key, read only for 90 days (the key is returned once; needs your signed-in Socialytics session).

Body: [PersonalKeyCreate](#personalkeycreate)

Returns: [PersonalKeyCreated](#personalkeycreated)

### Posts

#### `GET /v1/media-jobs`

List media generation jobs. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [MediaJobList](#mediajoblist)

#### `GET /v1/posts`

List generated posts. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `report_id` | string |  |
| `source` | "calendar" \| "ad_hoc" \| "recommendation" |  |
| `approved` | boolean |  |
| `include_archived` | boolean |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [PostList](#postlist)

#### `GET /v1/posts/{id}`

One generated post. Scope: `read`.

Returns: [Post](#post)

### Reports

#### `GET /v1/reports`

List social reports. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | "running" \| "completed" \| "failed" |  |
| `from` | string |  |
| `to` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [ReportList](#reportlist)

#### `GET /v1/reports/{id}`

One social report with its analysis, calendar, performance, trends and the industry trends stored for its period. Scope: `read`.

Returns: [Report](#report)

### Schedules

#### `GET /v1/scheduled-posts`

List posts scheduled to Sprout. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `status` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [ScheduledPostList](#scheduledpostlist)

#### `GET /v1/schedules`

List report schedules. Scope: `read`.

| Query | Type | Description |
|---|---|---|
| `client_id` | string |  |
| `limit` | integer |  |
| `cursor` | string | The next_cursor of the previous page. |

Returns: [ScheduleList](#schedulelist)

### System

#### `GET /v1/health`

Liveness, and the build of the API function that answered. No key needed.

Returns: [Health](#health)

#### `GET /v1/openapi.json`

This API's OpenAPI document. No key needed.

Returns: [Empty](#empty)

#### `GET /v1/status`

Pipeline health and demo job status (a company-scoped key sees its own clients' findings only). Scope: `read`.

Returns: [Status](#status)

## Schemas

### AlertList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].client_id` |  |  |
| `data[].companies` |  |  |
| `data[].confidence` |  |  |
| `data[].created_at` |  |  |
| `data[].id` |  |  |
| `data[].platforms` |  |  |
| `data[].post_count` |  |  |
| `data[].post_urls` |  |  |
| `data[].status` |  |  |
| `data[].summary` |  |  |
| `data[].topic` |  |  |
| `data[].window` |  |  |
| `data[].window.end` |  |  |
| `data[].window.start` |  |  |
| `next_cursor` | yes |  |

### AlertObject

| Field | Required | Values |
|---|---|---|
| `client_id` |  |  |
| `companies` |  |  |
| `confidence` |  |  |
| `created_at` |  |  |
| `id` |  |  |
| `platforms` |  |  |
| `post_count` |  |  |
| `post_urls` |  |  |
| `status` |  |  |
| `summary` |  |  |
| `topic` |  |  |
| `window` |  |  |
| `window.end` |  |  |
| `window.start` |  |  |

### Analytics

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.by_profile` |  |  |
| `data.changes` |  |  |
| `data.client` |  |  |
| `data.client.id` |  |  |
| `data.client.name` |  |  |
| `data.daily` |  |  |
| `data.fetched_at` |  |  |
| `data.previous_range` |  |  |
| `data.previous_range.days` |  |  |
| `data.previous_range.end` |  |  |
| `data.previous_range.start` |  |  |
| `data.previous_totals` |  |  |
| `data.previous_totals.comments` |  |  |
| `data.previous_totals.impressions` |  |  |
| `data.previous_totals.post_link_clicks` |  |  |
| `data.previous_totals.reactions` |  |  |
| `data.previous_totals.shares` |  |  |
| `data.previous_totals.video_views` |  |  |
| `data.profiles` |  |  |
| `data.profiles[].name` |  |  |
| `data.profiles[].network` |  |  |
| `data.range` |  |  |
| `data.range.days` |  |  |
| `data.range.end` |  |  |
| `data.range.start` |  |  |
| `data.top_posts` |  |  |
| `data.totals` |  |  |
| `data.totals.comments` |  |  |
| `data.totals.impressions` |  |  |
| `data.totals.post_link_clicks` |  |  |
| `data.totals.reactions` |  |  |
| `data.totals.shares` |  |  |
| `data.totals.video_views` |  |  |

### AnalyticsObject

| Field | Required | Values |
|---|---|---|
| `by_profile` |  |  |
| `changes` |  |  |
| `client` |  |  |
| `client.id` |  |  |
| `client.name` |  |  |
| `daily` |  |  |
| `fetched_at` |  |  |
| `previous_range` |  |  |
| `previous_range.days` |  |  |
| `previous_range.end` |  |  |
| `previous_range.start` |  |  |
| `previous_totals` |  |  |
| `previous_totals.comments` |  |  |
| `previous_totals.impressions` |  |  |
| `previous_totals.post_link_clicks` |  |  |
| `previous_totals.reactions` |  |  |
| `previous_totals.shares` |  |  |
| `previous_totals.video_views` |  |  |
| `profiles` |  |  |
| `profiles[].name` |  |  |
| `profiles[].network` |  |  |
| `range` |  |  |
| `range.days` |  |  |
| `range.end` |  |  |
| `range.start` |  |  |
| `top_posts` |  |  |
| `totals` |  |  |
| `totals.comments` |  |  |
| `totals.impressions` |  |  |
| `totals.post_link_clicks` |  |  |
| `totals.reactions` |  |  |
| `totals.shares` |  |  |
| `totals.video_views` |  |  |

### ApiKeyCreate

| Field | Required | Values |
|---|---|---|
| `client_ids` |  |  |
| `company_slugs` |  |  |
| `expires_at` |  |  |
| `name` | yes |  |
| `note` |  |  |
| `rate_limit_per_minute` |  |  |
| `scopes` | yes | `read`, `demo`, `run`, `costs`, `admin` |

### ApiKeyCreated

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.client_ids` |  |  |
| `data.company_slugs` |  |  |
| `data.created_at` |  |  |
| `data.expires_at` |  |  |
| `data.id` |  |  |
| `data.key` |  |  |
| `data.key_prefix` |  |  |
| `data.last_used_at` |  |  |
| `data.name` |  |  |
| `data.note` |  |  |
| `data.owner_email` |  |  |
| `data.owner_user_id` |  |  |
| `data.rate_limit_per_minute` |  |  |
| `data.revoked_at` |  |  |
| `data.scopes` |  | `read`, `demo`, `run`, `costs`, `admin` |
| `data.warning` |  |  |

### ApiKeyCreatedObject

| Field | Required | Values |
|---|---|---|
| `client_ids` |  |  |
| `company_slugs` |  |  |
| `created_at` |  |  |
| `expires_at` |  |  |
| `id` |  |  |
| `key` |  |  |
| `key_prefix` |  |  |
| `last_used_at` |  |  |
| `name` |  |  |
| `note` |  |  |
| `owner_email` |  |  |
| `owner_user_id` |  |  |
| `rate_limit_per_minute` |  |  |
| `revoked_at` |  |  |
| `scopes` |  | `read`, `demo`, `run`, `costs`, `admin` |
| `warning` |  |  |

### ApiKeyList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].client_ids` |  |  |
| `data[].company_slugs` |  |  |
| `data[].created_at` |  |  |
| `data[].expires_at` |  |  |
| `data[].id` |  |  |
| `data[].key_prefix` |  |  |
| `data[].last_used_at` |  |  |
| `data[].name` |  |  |
| `data[].note` |  |  |
| `data[].owner_email` |  |  |
| `data[].owner_user_id` |  |  |
| `data[].rate_limit_per_minute` |  |  |
| `data[].revoked_at` |  |  |
| `data[].scopes` |  | `read`, `demo`, `run`, `costs`, `admin` |
| `next_cursor` | yes |  |

### ApiKeyObject

| Field | Required | Values |
|---|---|---|
| `client_ids` |  |  |
| `company_slugs` |  |  |
| `created_at` |  |  |
| `expires_at` |  |  |
| `id` |  |  |
| `key_prefix` |  |  |
| `last_used_at` |  |  |
| `name` |  |  |
| `note` |  |  |
| `owner_email` |  |  |
| `owner_user_id` |  |  |
| `rate_limit_per_minute` |  |  |
| `revoked_at` |  |  |
| `scopes` |  | `read`, `demo`, `run`, `costs`, `admin` |

### Client

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.archived` |  |  |
| `data.brand_identity` |  |  |
| `data.brief` |  |  |
| `data.company_slug` |  |  |
| `data.competitor_sets` |  |  |
| `data.competitor_sets[].client_id` |  |  |
| `data.competitor_sets[].competitors` |  |  |
| `data.competitor_sets[].competitors[].detection` |  |  |
| `data.competitor_sets[].competitors[].handles` |  |  |
| `data.competitor_sets[].competitors[].handles[].active` |  |  |
| `data.competitor_sets[].competitors[].handles[].confidence` |  |  |
| `data.competitor_sets[].competitors[].handles[].followers` |  |  |
| `data.competitor_sets[].competitors[].handles[].handle` |  |  |
| `data.competitor_sets[].competitors[].handles[].platform` |  |  |
| `data.competitor_sets[].competitors[].handles[].source` |  |  |
| `data.competitor_sets[].competitors[].handles[].url` |  |  |
| `data.competitor_sets[].competitors[].id` |  |  |
| `data.competitor_sets[].competitors[].name` |  |  |
| `data.competitor_sets[].competitors[].rank` |  |  |
| `data.competitor_sets[].competitors[].rationale` |  |  |
| `data.competitor_sets[].competitors[].selected` |  |  |
| `data.competitor_sets[].competitors[].similarity_score` |  |  |
| `data.competitor_sets[].competitors[].website` |  |  |
| `data.competitor_sets[].confirmed_at` |  |  |
| `data.competitor_sets[].created_at` |  |  |
| `data.competitor_sets[].demo_job_id` |  |  |
| `data.competitor_sets[].id` |  |  |
| `data.competitor_sets[].links` |  |  |
| `data.competitor_sets[].links.api` |  |  |
| `data.competitor_sets[].links.app` |  |  |
| `data.competitor_sets[].notes` |  |  |
| `data.competitor_sets[].source` |  |  |
| `data.competitor_sets[].status` |  |  |
| `data.competitor_sets[].tracked` |  |  |
| `data.competitors` |  |  |
| `data.competitors.selected` |  |  |
| `data.competitors.set_status` |  |  |
| `data.competitors.tracked` |  |  |
| `data.counts` |  |  |
| `data.counts.competitive_reports` |  |  |
| `data.counts.posts` |  |  |
| `data.counts.reports` |  |  |
| `data.counts.schedules` |  |  |
| `data.created_at` |  |  |
| `data.demo_job_id` |  |  |
| `data.design` |  |  |
| `data.design.ready` |  |  |
| `data.design.references` |  |  |
| `data.design.synthesis_at` |  |  |
| `data.design.system` |  |  |
| `data.design.waiting_for` |  | `look`, `designed_posts`, `social_accounts`, `logo_file`, `null` |
| `data.geo` |  |  |
| `data.id` |  |  |
| `data.keywords` |  |  |
| `data.language` |  |  |
| `data.last_report` |  |  |
| `data.links` |  |  |
| `data.links.api` |  |  |
| `data.links.app` |  |  |
| `data.logo_url` |  |  |
| `data.name` |  |  |
| `data.pillars` |  |  |
| `data.pillars[].description` |  |  |
| `data.pillars[].name` |  |  |
| `data.platforms` |  |  |
| `data.schedules` |  |  |
| `data.schedules[].active` |  |  |
| `data.schedules[].client_id` |  |  |
| `data.schedules[].created_at` |  |  |
| `data.schedules[].frequency` |  |  |
| `data.schedules[].id` |  |  |
| `data.schedules[].kind` |  |  |
| `data.schedules[].last_result` |  |  |
| `data.schedules[].last_run_at` |  |  |
| `data.schedules[].next_run_at` |  |  |
| `data.schedules[].range_mode` |  |  |
| `data.schedules[].run_day_of_month` |  |  |
| `data.setup` |  |  |
| `data.setup.issues` | yes |  |
| `data.setup.issues[].fix` |  | `setup`, `competitive` |
| `data.setup.issues[].kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `data.setup.issues[].text` |  |  |
| `data.setup.ready` | yes |  |
| `data.sprout` |  |  |
| `data.sprout.networks` |  |  |
| `data.sprout.profiles` |  |  |
| `data.sprout_profiles` |  |  |
| `data.sprout_profiles[].handle` |  |  |
| `data.sprout_profiles[].name` |  |  |
| `data.sprout_profiles[].network` |  |  |
| `data.sprout_profiles[].url` |  |  |
| `data.timezone` |  |  |
| `data.website` |  |  |

### ClientList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].archived` |  |  |
| `data[].brand_identity` |  |  |
| `data[].brief` |  |  |
| `data[].company_slug` |  |  |
| `data[].competitor_sets` |  |  |
| `data[].competitor_sets[].client_id` |  |  |
| `data[].competitor_sets[].competitors` |  |  |
| `data[].competitor_sets[].competitors[].detection` |  |  |
| `data[].competitor_sets[].competitors[].handles` |  |  |
| `data[].competitor_sets[].competitors[].handles[].active` |  |  |
| `data[].competitor_sets[].competitors[].handles[].confidence` |  |  |
| `data[].competitor_sets[].competitors[].handles[].followers` |  |  |
| `data[].competitor_sets[].competitors[].handles[].handle` |  |  |
| `data[].competitor_sets[].competitors[].handles[].platform` |  |  |
| `data[].competitor_sets[].competitors[].handles[].source` |  |  |
| `data[].competitor_sets[].competitors[].handles[].url` |  |  |
| `data[].competitor_sets[].competitors[].id` |  |  |
| `data[].competitor_sets[].competitors[].name` |  |  |
| `data[].competitor_sets[].competitors[].rank` |  |  |
| `data[].competitor_sets[].competitors[].rationale` |  |  |
| `data[].competitor_sets[].competitors[].selected` |  |  |
| `data[].competitor_sets[].competitors[].similarity_score` |  |  |
| `data[].competitor_sets[].competitors[].website` |  |  |
| `data[].competitor_sets[].confirmed_at` |  |  |
| `data[].competitor_sets[].created_at` |  |  |
| `data[].competitor_sets[].demo_job_id` |  |  |
| `data[].competitor_sets[].id` |  |  |
| `data[].competitor_sets[].links` |  |  |
| `data[].competitor_sets[].links.api` |  |  |
| `data[].competitor_sets[].links.app` |  |  |
| `data[].competitor_sets[].notes` |  |  |
| `data[].competitor_sets[].source` |  |  |
| `data[].competitor_sets[].status` |  |  |
| `data[].competitor_sets[].tracked` |  |  |
| `data[].competitors` |  |  |
| `data[].competitors.selected` |  |  |
| `data[].competitors.set_status` |  |  |
| `data[].competitors.tracked` |  |  |
| `data[].counts` |  |  |
| `data[].counts.competitive_reports` |  |  |
| `data[].counts.posts` |  |  |
| `data[].counts.reports` |  |  |
| `data[].counts.schedules` |  |  |
| `data[].created_at` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].design` |  |  |
| `data[].design.ready` |  |  |
| `data[].design.references` |  |  |
| `data[].design.synthesis_at` |  |  |
| `data[].design.system` |  |  |
| `data[].design.waiting_for` |  | `look`, `designed_posts`, `social_accounts`, `logo_file`, `null` |
| `data[].geo` |  |  |
| `data[].id` |  |  |
| `data[].keywords` |  |  |
| `data[].language` |  |  |
| `data[].last_report` |  |  |
| `data[].links` |  |  |
| `data[].links.api` |  |  |
| `data[].links.app` |  |  |
| `data[].logo_url` |  |  |
| `data[].name` |  |  |
| `data[].pillars` |  |  |
| `data[].pillars[].description` |  |  |
| `data[].pillars[].name` |  |  |
| `data[].platforms` |  |  |
| `data[].schedules` |  |  |
| `data[].schedules[].active` |  |  |
| `data[].schedules[].client_id` |  |  |
| `data[].schedules[].created_at` |  |  |
| `data[].schedules[].frequency` |  |  |
| `data[].schedules[].id` |  |  |
| `data[].schedules[].kind` |  |  |
| `data[].schedules[].last_result` |  |  |
| `data[].schedules[].last_run_at` |  |  |
| `data[].schedules[].next_run_at` |  |  |
| `data[].schedules[].range_mode` |  |  |
| `data[].schedules[].run_day_of_month` |  |  |
| `data[].setup` |  |  |
| `data[].setup.issues` | yes |  |
| `data[].setup.issues[].fix` |  | `setup`, `competitive` |
| `data[].setup.issues[].kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `data[].setup.issues[].text` |  |  |
| `data[].setup.ready` | yes |  |
| `data[].sprout` |  |  |
| `data[].sprout.networks` |  |  |
| `data[].sprout.profiles` |  |  |
| `data[].sprout_profiles` |  |  |
| `data[].sprout_profiles[].handle` |  |  |
| `data[].sprout_profiles[].name` |  |  |
| `data[].sprout_profiles[].network` |  |  |
| `data[].sprout_profiles[].url` |  |  |
| `data[].timezone` |  |  |
| `data[].website` |  |  |
| `next_cursor` | yes |  |

### ClientObject

| Field | Required | Values |
|---|---|---|
| `archived` |  |  |
| `brand_identity` |  |  |
| `brief` |  |  |
| `company_slug` |  |  |
| `competitor_sets` |  |  |
| `competitor_sets[].client_id` |  |  |
| `competitor_sets[].competitors` |  |  |
| `competitor_sets[].competitors[].detection` |  |  |
| `competitor_sets[].competitors[].handles` |  |  |
| `competitor_sets[].competitors[].handles[].active` |  |  |
| `competitor_sets[].competitors[].handles[].confidence` |  |  |
| `competitor_sets[].competitors[].handles[].followers` |  |  |
| `competitor_sets[].competitors[].handles[].handle` |  |  |
| `competitor_sets[].competitors[].handles[].platform` |  |  |
| `competitor_sets[].competitors[].handles[].source` |  |  |
| `competitor_sets[].competitors[].handles[].url` |  |  |
| `competitor_sets[].competitors[].id` |  |  |
| `competitor_sets[].competitors[].name` |  |  |
| `competitor_sets[].competitors[].rank` |  |  |
| `competitor_sets[].competitors[].rationale` |  |  |
| `competitor_sets[].competitors[].selected` |  |  |
| `competitor_sets[].competitors[].similarity_score` |  |  |
| `competitor_sets[].competitors[].website` |  |  |
| `competitor_sets[].confirmed_at` |  |  |
| `competitor_sets[].created_at` |  |  |
| `competitor_sets[].demo_job_id` |  |  |
| `competitor_sets[].id` |  |  |
| `competitor_sets[].links` |  |  |
| `competitor_sets[].links.api` |  |  |
| `competitor_sets[].links.app` |  |  |
| `competitor_sets[].notes` |  |  |
| `competitor_sets[].source` |  |  |
| `competitor_sets[].status` |  |  |
| `competitor_sets[].tracked` |  |  |
| `competitors` |  |  |
| `competitors.selected` |  |  |
| `competitors.set_status` |  |  |
| `competitors.tracked` |  |  |
| `counts` |  |  |
| `counts.competitive_reports` |  |  |
| `counts.posts` |  |  |
| `counts.reports` |  |  |
| `counts.schedules` |  |  |
| `created_at` |  |  |
| `demo_job_id` |  |  |
| `design` |  |  |
| `design.ready` |  |  |
| `design.references` |  |  |
| `design.synthesis_at` |  |  |
| `design.system` |  |  |
| `design.waiting_for` |  | `look`, `designed_posts`, `social_accounts`, `logo_file`, `null` |
| `geo` |  |  |
| `id` |  |  |
| `keywords` |  |  |
| `language` |  |  |
| `last_report` |  |  |
| `links` |  |  |
| `links.api` |  |  |
| `links.app` |  |  |
| `logo_url` |  |  |
| `name` |  |  |
| `pillars` |  |  |
| `pillars[].description` |  |  |
| `pillars[].name` |  |  |
| `platforms` |  |  |
| `schedules` |  |  |
| `schedules[].active` |  |  |
| `schedules[].client_id` |  |  |
| `schedules[].created_at` |  |  |
| `schedules[].frequency` |  |  |
| `schedules[].id` |  |  |
| `schedules[].kind` |  |  |
| `schedules[].last_result` |  |  |
| `schedules[].last_run_at` |  |  |
| `schedules[].next_run_at` |  |  |
| `schedules[].range_mode` |  |  |
| `schedules[].run_day_of_month` |  |  |
| `setup` |  |  |
| `setup.issues` | yes |  |
| `setup.issues[].fix` |  | `setup`, `competitive` |
| `setup.issues[].kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `setup.issues[].text` |  |  |
| `setup.ready` | yes |  |
| `sprout` |  |  |
| `sprout.networks` |  |  |
| `sprout.profiles` |  |  |
| `sprout_profiles` |  |  |
| `sprout_profiles[].handle` |  |  |
| `sprout_profiles[].name` |  |  |
| `sprout_profiles[].network` |  |  |
| `sprout_profiles[].url` |  |  |
| `timezone` |  |  |
| `website` |  |  |

### CompetitiveReport

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.aggregates` |  |  |
| `data.analysis` |  |  |
| `data.client_id` |  |  |
| `data.completed_at` |  |  |
| `data.created_at` |  |  |
| `data.deck` |  |  |
| `data.deck.url` |  |  |
| `data.demo_job_id` |  |  |
| `data.duration_minutes` |  |  |
| `data.id` |  |  |
| `data.links` |  |  |
| `data.links.api` |  |  |
| `data.links.app` |  |  |
| `data.period` |  |  |
| `data.period.days` |  |  |
| `data.period.end` |  |  |
| `data.period.start` |  |  |
| `data.provider_status` |  |  |
| `data.quality_check` |  |  |
| `data.set_id` |  |  |
| `data.status` |  |  |
| `data.totals` |  |  |

### CompetitiveReportList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].aggregates` |  |  |
| `data[].analysis` |  |  |
| `data[].client_id` |  |  |
| `data[].completed_at` |  |  |
| `data[].created_at` |  |  |
| `data[].deck` |  |  |
| `data[].deck.url` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].duration_minutes` |  |  |
| `data[].id` |  |  |
| `data[].links` |  |  |
| `data[].links.api` |  |  |
| `data[].links.app` |  |  |
| `data[].period` |  |  |
| `data[].period.days` |  |  |
| `data[].period.end` |  |  |
| `data[].period.start` |  |  |
| `data[].provider_status` |  |  |
| `data[].quality_check` |  |  |
| `data[].set_id` |  |  |
| `data[].status` |  |  |
| `data[].totals` |  |  |
| `next_cursor` | yes |  |

### CompetitiveReportObject

| Field | Required | Values |
|---|---|---|
| `aggregates` |  |  |
| `analysis` |  |  |
| `client_id` |  |  |
| `completed_at` |  |  |
| `created_at` |  |  |
| `deck` |  |  |
| `deck.url` |  |  |
| `demo_job_id` |  |  |
| `duration_minutes` |  |  |
| `id` |  |  |
| `links` |  |  |
| `links.api` |  |  |
| `links.app` |  |  |
| `period` |  |  |
| `period.days` |  |  |
| `period.end` |  |  |
| `period.start` |  |  |
| `provider_status` |  |  |
| `quality_check` |  |  |
| `set_id` |  |  |
| `status` |  |  |
| `totals` |  |  |

### CompetitorSet

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.client_id` |  |  |
| `data.competitors` |  |  |
| `data.competitors[].detection` |  |  |
| `data.competitors[].handles` |  |  |
| `data.competitors[].handles[].active` |  |  |
| `data.competitors[].handles[].confidence` |  |  |
| `data.competitors[].handles[].followers` |  |  |
| `data.competitors[].handles[].handle` |  |  |
| `data.competitors[].handles[].platform` |  |  |
| `data.competitors[].handles[].source` |  |  |
| `data.competitors[].handles[].url` |  |  |
| `data.competitors[].id` |  |  |
| `data.competitors[].name` |  |  |
| `data.competitors[].rank` |  |  |
| `data.competitors[].rationale` |  |  |
| `data.competitors[].selected` |  |  |
| `data.competitors[].similarity_score` |  |  |
| `data.competitors[].website` |  |  |
| `data.confirmed_at` |  |  |
| `data.created_at` |  |  |
| `data.demo_job_id` |  |  |
| `data.id` |  |  |
| `data.links` |  |  |
| `data.links.api` |  |  |
| `data.links.app` |  |  |
| `data.notes` |  |  |
| `data.source` |  |  |
| `data.status` |  |  |
| `data.tracked` |  |  |

### CompetitorSetList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].client_id` |  |  |
| `data[].competitors` |  |  |
| `data[].competitors[].detection` |  |  |
| `data[].competitors[].handles` |  |  |
| `data[].competitors[].handles[].active` |  |  |
| `data[].competitors[].handles[].confidence` |  |  |
| `data[].competitors[].handles[].followers` |  |  |
| `data[].competitors[].handles[].handle` |  |  |
| `data[].competitors[].handles[].platform` |  |  |
| `data[].competitors[].handles[].source` |  |  |
| `data[].competitors[].handles[].url` |  |  |
| `data[].competitors[].id` |  |  |
| `data[].competitors[].name` |  |  |
| `data[].competitors[].rank` |  |  |
| `data[].competitors[].rationale` |  |  |
| `data[].competitors[].selected` |  |  |
| `data[].competitors[].similarity_score` |  |  |
| `data[].competitors[].website` |  |  |
| `data[].confirmed_at` |  |  |
| `data[].created_at` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].id` |  |  |
| `data[].links` |  |  |
| `data[].links.api` |  |  |
| `data[].links.app` |  |  |
| `data[].notes` |  |  |
| `data[].source` |  |  |
| `data[].status` |  |  |
| `data[].tracked` |  |  |
| `next_cursor` | yes |  |

### CompetitorSetObject

| Field | Required | Values |
|---|---|---|
| `client_id` |  |  |
| `competitors` |  |  |
| `competitors[].detection` |  |  |
| `competitors[].handles` |  |  |
| `competitors[].handles[].active` |  |  |
| `competitors[].handles[].confidence` |  |  |
| `competitors[].handles[].followers` |  |  |
| `competitors[].handles[].handle` |  |  |
| `competitors[].handles[].platform` |  |  |
| `competitors[].handles[].source` |  |  |
| `competitors[].handles[].url` |  |  |
| `competitors[].id` |  |  |
| `competitors[].name` |  |  |
| `competitors[].rank` |  |  |
| `competitors[].rationale` |  |  |
| `competitors[].selected` |  |  |
| `competitors[].similarity_score` |  |  |
| `competitors[].website` |  |  |
| `confirmed_at` |  |  |
| `created_at` |  |  |
| `demo_job_id` |  |  |
| `id` |  |  |
| `links` |  |  |
| `links.api` |  |  |
| `links.app` |  |  |
| `notes` |  |  |
| `source` |  |  |
| `status` |  |  |
| `tracked` |  |  |

### CostEventList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].actor_kind` |  |  |
| `data[].bucket` |  |  |
| `data[].client_id` |  |  |
| `data[].client_name` |  |  |
| `data[].company_slug` |  |  |
| `data[].cost_source` |  |  |
| `data[].cost_usd` |  |  |
| `data[].env` |  |  |
| `data[].execution_id` |  |  |
| `data[].feature` |  |  |
| `data[].id` |  |  |
| `data[].occurred_at` |  |  |
| `data[].price_ref` |  |  |
| `data[].provider` |  |  |
| `data[].provider_ref` |  |  |
| `data[].quantities` |  |  |
| `data[].resource` |  |  |
| `data[].unattributed` |  |  |
| `next_cursor` | yes |  |

### CostPricing

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.at` |  |  |
| `data.prices` |  |  |
| `data.providers` |  |  |

### CostSummary

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.currency` | yes | `USD` |
| `data.filters` |  |  |
| `data.from` | yes |  |
| `data.group_by` |  | `day`, `week`, `month`, `client`, `provider`, `resource`, `feature`, `bucket`, `env` |
| `data.notes` |  |  |
| `data.reconciliation` |  |  |
| `data.rows` | yes |  |
| `data.rows[].bucket` |  |  |
| `data.rows[].client` |  |  |
| `data.rows[].client.bucket` |  |  |
| `data.rows[].client.company_slug` |  |  |
| `data.rows[].client.id` |  |  |
| `data.rows[].client.name` |  |  |
| `data.rows[].cost_usd` |  |  |
| `data.rows[].day` |  |  |
| `data.rows[].env` |  |  |
| `data.rows[].estimated_usd` |  |  |
| `data.rows[].events` |  |  |
| `data.rows[].feature` |  |  |
| `data.rows[].month` |  |  |
| `data.rows[].provider` |  |  |
| `data.rows[].quantities` |  |  |
| `data.rows[].resource` |  |  |
| `data.rows[].unattributed_events` |  |  |
| `data.rows[].unattributed_usd` |  |  |
| `data.rows[].unpriced_events` |  |  |
| `data.rows[].week` |  |  |
| `data.to` | yes |  |
| `data.tool` | yes | `advisor`, `socialytics` |
| `data.totals` | yes |  |
| `data.totals.cost_usd` |  |  |
| `data.totals.estimated_usd` |  |  |
| `data.totals.events` |  |  |
| `data.totals.unattributed_events` |  |  |
| `data.totals.unattributed_usd` |  |  |
| `data.totals.unpriced_events` |  |  |

### DemoInput

| Field | Required | Values |
|---|---|---|
| `callback_url` |  |  |
| `client_name` | yes |  |
| `competitors` |  |  |
| `competitors[].name` |  |  |
| `competitors[].website` |  |  |
| `force_run` |  |  |
| `idempotency_key` |  |  |
| `industry` |  |  |
| `regions` |  |  |
| `requester` |  |  |
| `requester.email` |  |  |
| `requester.id` |  |  |
| `requester.name` |  |  |
| `website` | yes |  |

### DemoJob

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.callback_status` |  |  |
| `data.callback_url` |  |  |
| `data.client_id` |  |  |
| `data.completed_at` |  |  |
| `data.created_at` |  |  |
| `data.error` |  |  |
| `data.gaps` |  |  |
| `data.gaps[].code` |  |  |
| `data.gaps[].message` |  |  |
| `data.gaps[].step` |  |  |
| `data.id` |  |  |
| `data.idempotency_key` |  |  |
| `data.input` |  |  |
| `data.links` |  |  |
| `data.links.client` |  |  |
| `data.links.self` |  |  |
| `data.next_check_at` |  |  |
| `data.outputs` |  |  |
| `data.requester` |  |  |
| `data.run_ids` |  |  |
| `data.started_at` |  |  |
| `data.status` |  | `queued`, `running`, `completed`, `partial`, `failed`, `cancelled` |
| `data.steps` |  |  |
| `data.steps[].data` |  |  |
| `data.steps[].finished_at` |  |  |
| `data.steps[].message` |  |  |
| `data.steps[].name` |  |  |
| `data.steps[].outcome` |  |  |
| `data.steps[].reason` |  |  |
| `data.steps[].started_at` |  |  |
| `data.steps[].status` |  | `pending`, `running`, `done`, `skipped`, `failed` |
| `data.tool` |  |  |
| `data.updated_at` |  |  |

### DemoJobList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].callback_status` |  |  |
| `data[].callback_url` |  |  |
| `data[].client_id` |  |  |
| `data[].completed_at` |  |  |
| `data[].created_at` |  |  |
| `data[].error` |  |  |
| `data[].gaps` |  |  |
| `data[].gaps[].code` |  |  |
| `data[].gaps[].message` |  |  |
| `data[].gaps[].step` |  |  |
| `data[].id` |  |  |
| `data[].idempotency_key` |  |  |
| `data[].input` |  |  |
| `data[].links` |  |  |
| `data[].links.client` |  |  |
| `data[].links.self` |  |  |
| `data[].next_check_at` |  |  |
| `data[].outputs` |  |  |
| `data[].requester` |  |  |
| `data[].run_ids` |  |  |
| `data[].started_at` |  |  |
| `data[].status` |  | `queued`, `running`, `completed`, `partial`, `failed`, `cancelled` |
| `data[].steps` |  |  |
| `data[].steps[].data` |  |  |
| `data[].steps[].finished_at` |  |  |
| `data[].steps[].message` |  |  |
| `data[].steps[].name` |  |  |
| `data[].steps[].outcome` |  |  |
| `data[].steps[].reason` |  |  |
| `data[].steps[].started_at` |  |  |
| `data[].steps[].status` |  | `pending`, `running`, `done`, `skipped`, `failed` |
| `data[].tool` |  |  |
| `data[].updated_at` |  |  |
| `next_cursor` | yes |  |

### DemoJobObject

| Field | Required | Values |
|---|---|---|
| `callback_status` |  |  |
| `callback_url` |  |  |
| `client_id` |  |  |
| `completed_at` |  |  |
| `created_at` |  |  |
| `error` |  |  |
| `gaps` |  |  |
| `gaps[].code` |  |  |
| `gaps[].message` |  |  |
| `gaps[].step` |  |  |
| `id` |  |  |
| `idempotency_key` |  |  |
| `input` |  |  |
| `links` |  |  |
| `links.client` |  |  |
| `links.self` |  |  |
| `next_check_at` |  |  |
| `outputs` |  |  |
| `requester` |  |  |
| `run_ids` |  |  |
| `started_at` |  |  |
| `status` |  | `queued`, `running`, `completed`, `partial`, `failed`, `cancelled` |
| `steps` |  |  |
| `steps[].data` |  |  |
| `steps[].finished_at` |  |  |
| `steps[].message` |  |  |
| `steps[].name` |  |  |
| `steps[].outcome` |  |  |
| `steps[].reason` |  |  |
| `steps[].started_at` |  |  |
| `steps[].status` |  | `pending`, `running`, `done`, `skipped`, `failed` |
| `tool` |  |  |
| `updated_at` |  |  |

### DesignSystemList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].approved_at` |  |  |
| `data[].client_id` |  |  |
| `data[].created_at` |  |  |
| `data[].id` |  |  |
| `data[].notes` |  |  |
| `data[].previews` |  |  |
| `data[].previews[].format` |  |  |
| `data[].previews[].template_id` |  |  |
| `data[].previews[].url` |  |  |
| `data[].status` |  |  |
| `data[].templates` |  |  |
| `data[].templates[].formats` |  |  |
| `data[].templates[].id` |  |  |
| `data[].templates[].name` |  |  |
| `data[].tokens` |  |  |
| `data[].version` |  |  |
| `next_cursor` | yes |  |

### DesignSystemObject

| Field | Required | Values |
|---|---|---|
| `approved_at` |  |  |
| `client_id` |  |  |
| `created_at` |  |  |
| `id` |  |  |
| `notes` |  |  |
| `previews` |  |  |
| `previews[].format` |  |  |
| `previews[].template_id` |  |  |
| `previews[].url` |  |  |
| `status` |  |  |
| `templates` |  |  |
| `templates[].formats` |  |  |
| `templates[].id` |  |  |
| `templates[].name` |  |  |
| `tokens` |  |  |
| `version` |  |  |

### Discarded

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.job_id` |  |  |
| `data.removed` |  |  |
| `data.removed.client` |  |  |
| `data.removed.competitive_reports` |  |  |
| `data.removed.competitor_sets` |  |  |
| `data.removed.media_jobs` |  |  |
| `data.removed.posts` |  |  |
| `data.removed.reports` |  |  |

### DiscardedObject

| Field | Required | Values |
|---|---|---|
| `job_id` |  |  |
| `removed` |  |  |
| `removed.client` |  |  |
| `removed.competitive_reports` |  |  |
| `removed.competitor_sets` |  |  |
| `removed.media_jobs` |  |  |
| `removed.posts` |  |  |
| `removed.reports` |  |  |

### Empty

`object`

### Error

| Field | Required | Values |
|---|---|---|
| `error` | yes |  |
| `error.code` | yes |  |
| `error.details` |  |  |
| `error.message` | yes |  |

### Health

| Field | Required | Values |
|---|---|---|
| `build` |  |  |
| `ok` |  |  |
| `time` |  |  |
| `tool` |  |  |
| `version` |  |  |

### Links

| Field | Required | Values |
|---|---|---|
| `api` |  |  |
| `app` |  |  |

### MediaJobList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].client_id` |  |  |
| `data[].created_at` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].error` |  |  |
| `data[].id` |  |  |
| `data[].kind` |  |  |
| `data[].output_url` |  |  |
| `data[].post_id` |  |  |
| `data[].provider` |  |  |
| `data[].review` |  |  |
| `data[].reviewed_at` |  |  |
| `data[].seed_image_url` |  |  |
| `data[].status` |  |  |
| `data[].updated_at` |  |  |
| `next_cursor` | yes |  |

### MediaJobObject

| Field | Required | Values |
|---|---|---|
| `client_id` |  |  |
| `created_at` |  |  |
| `demo_job_id` |  |  |
| `error` |  |  |
| `id` |  |  |
| `kind` |  |  |
| `output_url` |  |  |
| `post_id` |  |  |
| `provider` |  |  |
| `review` |  |  |
| `reviewed_at` |  |  |
| `seed_image_url` |  |  |
| `status` |  |  |
| `updated_at` |  |  |

### PersonalKeyCreate

| Field | Required | Values |
|---|---|---|
| `name` | yes |  |

### PersonalKeyCreated

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.created_at` |  |  |
| `data.expires_at` |  |  |
| `data.id` |  |  |
| `data.key` |  |  |
| `data.key_prefix` |  |  |
| `data.last_used_at` |  |  |
| `data.name` |  |  |
| `data.revoked_at` |  |  |
| `data.scopes` |  | `read` |

### PersonalKeyCreatedObject

| Field | Required | Values |
|---|---|---|
| `created_at` |  |  |
| `expires_at` |  |  |
| `id` |  |  |
| `key` |  |  |
| `key_prefix` |  |  |
| `last_used_at` |  |  |
| `name` |  |  |
| `revoked_at` |  |  |
| `scopes` |  | `read` |

### PersonalKeyList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].created_at` |  |  |
| `data[].expires_at` |  |  |
| `data[].id` |  |  |
| `data[].key_prefix` |  |  |
| `data[].last_used_at` |  |  |
| `data[].name` |  |  |
| `data[].revoked_at` |  |  |
| `data[].scopes` |  | `read` |
| `next_cursor` | yes |  |

### PersonalKeyObject

| Field | Required | Values |
|---|---|---|
| `created_at` |  |  |
| `expires_at` |  |  |
| `id` |  |  |
| `key_prefix` |  |  |
| `last_used_at` |  |  |
| `name` |  |  |
| `revoked_at` |  |  |
| `scopes` |  | `read` |

### PersonalKeyRevoked

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.id` | yes |  |
| `data.revoked_at` | yes |  |

### PersonalKeyRevokedObject

| Field | Required | Values |
|---|---|---|
| `id` | yes |  |
| `revoked_at` | yes |  |

### Post

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.approved` |  |  |
| `data.approved_at` |  |  |
| `data.archived` |  |  |
| `data.client_id` |  |  |
| `data.concept` |  |  |
| `data.copy` |  |  |
| `data.created_at` |  |  |
| `data.cta` |  |  |
| `data.demo_job_id` |  |  |
| `data.finishing` |  |  |
| `data.format` |  |  |
| `data.hashtags` |  |  |
| `data.id` |  |  |
| `data.links` |  |  |
| `data.links.api` |  |  |
| `data.links.app` |  |  |
| `data.media_urls` |  |  |
| `data.platform` |  |  |
| `data.rejected_at` |  |  |
| `data.rejection_reason` |  |  |
| `data.report_id` |  |  |
| `data.selected` |  |  |
| `data.source` |  |  |
| `data.variant_angle` |  |  |
| `data.variant_group_id` |  |  |
| `data.version` |  |  |
| `data.visual_direction` |  |  |

### PostList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].approved` |  |  |
| `data[].approved_at` |  |  |
| `data[].archived` |  |  |
| `data[].client_id` |  |  |
| `data[].concept` |  |  |
| `data[].copy` |  |  |
| `data[].created_at` |  |  |
| `data[].cta` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].finishing` |  |  |
| `data[].format` |  |  |
| `data[].hashtags` |  |  |
| `data[].id` |  |  |
| `data[].links` |  |  |
| `data[].links.api` |  |  |
| `data[].links.app` |  |  |
| `data[].media_urls` |  |  |
| `data[].platform` |  |  |
| `data[].rejected_at` |  |  |
| `data[].rejection_reason` |  |  |
| `data[].report_id` |  |  |
| `data[].selected` |  |  |
| `data[].source` |  |  |
| `data[].variant_angle` |  |  |
| `data[].variant_group_id` |  |  |
| `data[].version` |  |  |
| `data[].visual_direction` |  |  |
| `next_cursor` | yes |  |

### PostObject

| Field | Required | Values |
|---|---|---|
| `approved` |  |  |
| `approved_at` |  |  |
| `archived` |  |  |
| `client_id` |  |  |
| `concept` |  |  |
| `copy` |  |  |
| `created_at` |  |  |
| `cta` |  |  |
| `demo_job_id` |  |  |
| `finishing` |  |  |
| `format` |  |  |
| `hashtags` |  |  |
| `id` |  |  |
| `links` |  |  |
| `links.api` |  |  |
| `links.app` |  |  |
| `media_urls` |  |  |
| `platform` |  |  |
| `rejected_at` |  |  |
| `rejection_reason` |  |  |
| `report_id` |  |  |
| `selected` |  |  |
| `source` |  |  |
| `variant_angle` |  |  |
| `variant_group_id` |  |  |
| `version` |  |  |
| `visual_direction` |  |  |

### Report

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.analysis` |  |  |
| `data.calendar` |  |  |
| `data.calendar[].date_label` |  |  |
| `data.calendar[].day` |  |  |
| `data.calendar[].posts` |  |  |
| `data.client_id` |  |  |
| `data.completed_at` |  |  |
| `data.counts` |  |  |
| `data.created_at` |  |  |
| `data.deck` |  |  |
| `data.deck.status` |  |  |
| `data.deck.url` |  |  |
| `data.demo_job_id` |  |  |
| `data.duration_minutes` |  |  |
| `data.error` |  |  |
| `data.id` |  |  |
| `data.industry_trends` |  |  |
| `data.links` |  |  |
| `data.links.api` |  |  |
| `data.links.app` |  |  |
| `data.metrics_summary` |  |  |
| `data.performance` |  |  |
| `data.period` |  |  |
| `data.period.end` |  |  |
| `data.period.start` |  |  |
| `data.previous_period` |  |  |
| `data.status` |  |  |
| `data.trend_status` |  |  |
| `data.trends` |  |  |
| `data.type` |  |  |
| `data.warnings` |  |  |

### ReportList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].analysis` |  |  |
| `data[].calendar` |  |  |
| `data[].calendar[].date_label` |  |  |
| `data[].calendar[].day` |  |  |
| `data[].calendar[].posts` |  |  |
| `data[].client_id` |  |  |
| `data[].completed_at` |  |  |
| `data[].counts` |  |  |
| `data[].created_at` |  |  |
| `data[].deck` |  |  |
| `data[].deck.status` |  |  |
| `data[].deck.url` |  |  |
| `data[].demo_job_id` |  |  |
| `data[].duration_minutes` |  |  |
| `data[].error` |  |  |
| `data[].id` |  |  |
| `data[].industry_trends` |  |  |
| `data[].links` |  |  |
| `data[].links.api` |  |  |
| `data[].links.app` |  |  |
| `data[].metrics_summary` |  |  |
| `data[].performance` |  |  |
| `data[].period` |  |  |
| `data[].period.end` |  |  |
| `data[].period.start` |  |  |
| `data[].previous_period` |  |  |
| `data[].status` |  |  |
| `data[].trend_status` |  |  |
| `data[].trends` |  |  |
| `data[].type` |  |  |
| `data[].warnings` |  |  |
| `next_cursor` | yes |  |

### ReportObject

| Field | Required | Values |
|---|---|---|
| `analysis` |  |  |
| `calendar` |  |  |
| `calendar[].date_label` |  |  |
| `calendar[].day` |  |  |
| `calendar[].posts` |  |  |
| `client_id` |  |  |
| `completed_at` |  |  |
| `counts` |  |  |
| `created_at` |  |  |
| `deck` |  |  |
| `deck.status` |  |  |
| `deck.url` |  |  |
| `demo_job_id` |  |  |
| `duration_minutes` |  |  |
| `error` |  |  |
| `id` |  |  |
| `industry_trends` |  |  |
| `links` |  |  |
| `links.api` |  |  |
| `links.app` |  |  |
| `metrics_summary` |  |  |
| `performance` |  |  |
| `period` |  |  |
| `period.end` |  |  |
| `period.start` |  |  |
| `previous_period` |  |  |
| `status` |  |  |
| `trend_status` |  |  |
| `trends` |  |  |
| `type` |  |  |
| `warnings` |  |  |

### ScheduledPostList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].client_id` |  |  |
| `data[].content` |  |  |
| `data[].created_at` |  |  |
| `data[].id` |  |  |
| `data[].media_url` |  |  |
| `data[].platform` |  |  |
| `data[].report_id` |  |  |
| `data[].scheduled_time` |  |  |
| `data[].status` |  |  |
| `next_cursor` | yes |  |

### ScheduledPostObject

| Field | Required | Values |
|---|---|---|
| `client_id` |  |  |
| `content` |  |  |
| `created_at` |  |  |
| `id` |  |  |
| `media_url` |  |  |
| `platform` |  |  |
| `report_id` |  |  |
| `scheduled_time` |  |  |
| `status` |  |  |

### ScheduleList

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data[].active` |  |  |
| `data[].client_id` |  |  |
| `data[].created_at` |  |  |
| `data[].frequency` |  |  |
| `data[].id` |  |  |
| `data[].kind` |  |  |
| `data[].last_result` |  |  |
| `data[].last_run_at` |  |  |
| `data[].next_run_at` |  |  |
| `data[].range_mode` |  |  |
| `data[].run_day_of_month` |  |  |
| `next_cursor` | yes |  |

### ScheduleObject

| Field | Required | Values |
|---|---|---|
| `active` |  |  |
| `client_id` |  |  |
| `created_at` |  |  |
| `frequency` |  |  |
| `id` |  |  |
| `kind` |  |  |
| `last_result` |  |  |
| `last_run_at` |  |  |
| `next_run_at` |  |  |
| `range_mode` |  |  |
| `run_day_of_month` |  |  |

### Setup

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.issues` | yes |  |
| `data.issues[].fix` |  | `setup`, `competitive` |
| `data.issues[].kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `data.issues[].text` |  |  |
| `data.ready` | yes |  |

### SetupIssue

| Field | Required | Values |
|---|---|---|
| `fix` |  | `setup`, `competitive` |
| `kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `text` |  |  |

### SetupObject

| Field | Required | Values |
|---|---|---|
| `issues` | yes |  |
| `issues[].fix` |  | `setup`, `competitive` |
| `issues[].kind` |  | `brand_identity_missing`, `pillars_missing`, `keywords_missing`, `sprout_missing`, `competitors_missing`, `design_style_missing`, `schedule_missing` |
| `issues[].text` |  |  |
| `ready` | yes |  |

### Status

| Field | Required | Values |
|---|---|---|
| `data` | yes |  |
| `data.counts` |  |  |
| `data.demo_jobs` |  |  |
| `data.demo_jobs.failed_24h` |  |  |
| `data.demo_jobs.running` |  |  |
| `data.demo_jobs.stuck` |  |  |
| `data.findings` |  |  |
| `data.findings[].client` |  |  |
| `data.findings[].client_id` |  |  |
| `data.findings[].detail` |  |  |
| `data.findings[].job_id` |  |  |
| `data.findings[].kind` |  |  |
| `data.findings[].link` |  |  |
| `data.findings[].report_id` |  |  |
| `data.findings[].severity` |  |  |
| `data.time` |  |  |
| `data.tool` |  |  |

### StatusObject

| Field | Required | Values |
|---|---|---|
| `counts` |  |  |
| `demo_jobs` |  |  |
| `demo_jobs.failed_24h` |  |  |
| `demo_jobs.running` |  |  |
| `demo_jobs.stuck` |  |  |
| `findings` |  |  |
| `findings[].client` |  |  |
| `findings[].client_id` |  |  |
| `findings[].detail` |  |  |
| `findings[].job_id` |  |  |
| `findings[].kind` |  |  |
| `findings[].link` |  |  |
| `findings[].report_id` |  |  |
| `findings[].severity` |  |  |
| `time` |  |  |
| `tool` |  |  |
