# Designs in each platform's upload size

17 Nov 2026. Branch `qafix/platform-sizes`.

## The requirement

Lital: "the designs should be in the size they need to be uploaded in per the social platform they're getting posted to" and "this needs to be dynamic. proposed sizes change and vary".

Agreed:

- A sizes table: one row per platform and format (image, carousel, Story) with the current upload size. A design reads its size from the table when it is requested and is drawn in that shape from the start. Nothing is cropped or stretched afterwards.
- A weekly job reads Sprout Social's image sizes guide (https://sproutsocial.com/insights/social-media-image-sizes-guide/) and updates the table when a size has changed.
- A new size is accepted only on exact checks. A read that fails or looks wrong leaves the last good size in place.
- Nobody maintains it: no setting, no manual step, no flag, no alert.
- Where a platform accepts several shapes, the one the guide lists first is used.

## Today

Every still is planned on a 1088x1360 page (`DEFAULT_PAGE`, design-worker), drawn by the image model at twice that (`pictureSize`: 2176x2720) and delivered 1440 wide (`outputSize`: 1440x1800). A Story is planned on 1152x2048, drawn at 2160x3840 and delivered at 1440x2560. The platform never changes the shape.

## 1. The tables

Migration `20261117150000_platform_sizes.sql`. Everything in it is additive and it can be run twice.

### `public.platform_sizes`

| column | meaning |
| --- | --- |
| `platform` text | `instagram`, `facebook`, `linkedin`, `x` (the key `networkKey` gives, the same key the publish path uses) |
| `format` text | `image`, `carousel` or `story` |
| `width`, `height` integer | the upload size in use, in pixels |
| `source` text | `seed` or `guide` |
| `changed_at` timestamptz | when the size last changed |
| `previous_width`, `previous_height` | the size before the last change |
| `checked_at` timestamptz | the last run that read this row from the guide |
| `pending_width`, `pending_height`, `pending_at` | a far different size read once, waiting for the same read again |

Primary key `(platform, format)`. Checks: the format is one of the three, each edge of the size and of a pending size is between 600 and 2560.

Seed (inserted with `on conflict do nothing`, so a second run never overwrites a refreshed size):

| platform | format | size |
| --- | --- | --- |
| instagram | image | 1080x1350 |
| instagram | carousel | 1080x1350 |
| instagram | story | 1080x1920 |
| facebook | image | 1080x1350 |
| facebook | story | 1080x1920 |
| linkedin | image | 1200x1200 |
| x | image | 1600x900 |

### `public.platform_size_reads`

One row per run of the refresh, for the team's own diagnosis in the database. No screen reads it.

| column | meaning |
| --- | --- |
| `read_at` | when the run ended |
| `ok` | whether the guide was fetched and read |
| `source`, `source_updated` | the URL, and the page's own "modified" date when it has one |
| `error` | why the whole read failed |
| `rows` jsonb | one entry per table row: the sizes read, the outcome (`same`, `changed`, `held`, `confirmed`, `refused`), the reason for a refusal, the size before and after |

Rows older than 400 days are deleted by the same call that writes a new one.

### `design_requests.upload_size`

A jsonb column, null for every request that exists. A request made after the release holds `{platform, format, width, height}`: the row it read when it was requested. All of its options, slides and replacements use it, so a refresh during a request changes nothing for that request.

### Access

As `moments` and `moment_lists`: row level security on, staff may read, the three restrictive OAuth policies, nothing for anon, writes for the service role only. `record_platform_size_read` and `enqueue_platform_sizes_job` are for the service role only.

## 2. From a request to a row

`uploadSizeKey(post)` in `_shared/design/platformSize.ts`, built on the functions that already decide what a request is. `readUploadSize` (`platformSizeDb.ts`) reads the row when `design-request` creates the request.

- Platform: `networkKey(platform)` (`_shared/sprout/publishRules.ts`). "Twitter/X", "X (Twitter)", "x" give `x`; "LinkedIn" gives `linkedin`.
- Format:
  - `isStoryPost(request)` true: `story`.
  - else `formatKind(format, platform)`: `carousel` gives `carousel`.
  - `document`, `video`, `short video`: no key. A LinkedIn document keeps today's page: the guide says nothing about documents.
  - Everything else ("Single Image", "image", "photo", "static post", no format) is `image`.
- A carousel on a platform with no carousel row uses that platform's image row. A carousel is uploaded as feed images.
- No key, no row, a row that fails the checks of section 3, or a read that errors: the request has no `upload_size` and is designed exactly as today (1088x1360 page, 1440 wide; a Story on 1152x2048, 1440x2560). Nothing fails.

A video request never reads the table.

## 3. The refresh

`_shared/design/platformSizeRead.ts` (the reading and deciding, no network) and `_shared/design/platformSizeRefresh.ts` (the job).

### When

`enqueue_platform_sizes_job` queues one `platform_sizes` job on Monday (Israel time), or on any day when no run finished in the last 8 days, never while one is queued or running. pg_cron calls it daily at 05:30 UTC (`platform-sizes-enqueue`). The first run is the morning after the migration. A job the worker does not know yet (the migration applied before `run-scheduled-jobs` is deployed) fails as an unknown kind and is queued again the next day.

### Fetch

A plain GET with a 20 second limit. The HTML's article is turned into text: headings marked, each table row on one line with its cells separated by `|`, list items on their own lines. A page under 1,500 characters of text, with no size on it, or with no cheat sheet row and no section for any platform the table holds, is a failed read.

### Extract

One call to `anthropicMessages` with the planning model (`claude-opus-5-5`) and a tool whose input is the strict structure:

```json
{"rows": [{"platform": "instagram", "format": "image",
           "sizes": [{"width": 1080, "height": 1080, "part": "cheat_sheet"}]}]}
```

The model is asked only for the rows the table holds. Anything else in its answer is dropped.

### The reading rule

For an image or carousel row, the sizes in this order:

1. The cheat sheet: the table under the heading that contains "cheat sheet", the platform's row, the "Primary post image" cell, sizes in the order written. The code reads this cell itself: it is one table cell with one meaning, so it needs no model.
2. The platform's own section: the part of the page under the platform's heading, the organic post sizes for that format on lines marked recommended, in the order the model lists them. A carousel is read only from a part whose heading names carousel posts.

For a Story row: the recommended size in the platform's Stories image part.

Never: ads, profile and cover images, thumbnails, video, minimum and maximum sizes, safe areas, grid views.

The cheat sheet wins over the section, and the first listed wins within a part, when a new size is chosen. A size in use stays while the page still writes it in the platform's cheat sheet cell or anywhere in the platform's section. The code checks both itself, on the page's text, whatever the model returned, so a platform with two recommended shapes never flips between them and LinkedIn's 1200x1200 does not depend on the model listing it.

### Checked in code, on exact facts

- **On the page.** The cheat sheet sizes are the ones in the "Primary post image" cell of the row that starts with the platform's name, in the cell's order, whatever the model said about them. A `section` size the model returns counts only when it is written between the platform's heading and the next heading of the same level. A size that is not there is dropped. A Story is never read from the cheat sheet.
- **Sane.** Whole numbers, each edge from 600 to 2560.
- **A shape the app makes.** A still: width over height from 0.5 to 2.0. A Story: exactly 9:16.
- **A page for it.** `pageFor`: the rectangle in multiples of 16, within 25% of today's pixel count (1088x1360 for a still, 1152x2048 for a Story), whose shape is closest to the size's (then closest in pixel count). The page's shape must be within 0.2% of the size's.
- **Drawable.** `pictureSize(page)` gives edges in multiples of 16, none over 3840 (`MODEL_MAX_EDGE`), no more pixels than the largest picture the app draws today (the Story's 2160x3840), the page's own shape, and the upload size is no larger than it on either edge, so delivery never enlarges.

### Compare and write

For each row, with the valid sizes in reading order:

| what was read | outcome | what changes |
| --- | --- | --- |
| the size in use is written in the platform's cheat sheet cell or section, or is among the listed sizes | `same` | `checked_at`; a pending size is cleared |
| the first listed size is one the image model refused and has not drawn since | `refused` (`model_refused`) | nothing |
| the model gave nothing for the row, or nothing listed is on the page | `refused` | nothing |
| the first size differs from the size in use, not wildly | `changed` | the size |
| it differs wildly and is not the pending size | `held` | the pending size |
| it differs wildly and is the pending size | `confirmed` | the size |

The first size listed is the only candidate. When it fails a check the row is refused: the job never falls through to another shape.

**Wildly**: the shape (width over height) differs by more than 10%, or either edge by more than 25%. 1080x1350 to 1080x1440 is accepted at once. 1080x1350 to 1080x1080, or to 1440x1800, waits for the same read on the next run that reads the row.

A held size lasts one read. It is confirmed only by the next read of the row that gives the same size. A read that gives anything else clears or replaces it. A refused read and a failed run neither confirm nor clear it, and after three runs that read the guide and refused the row it is dropped (`pending_misses`).

`record_platform_size_read` writes the run and applies the changes in one transaction. Each change holds only while the row still has the size the run compared against.

### Failure

A fetch that fails, a page that is not the guide, a model answer that is not the structure: the run is written with `ok` false and its reason, no row of `platform_sizes` is touched, and the job is tried again by the queue (three tries, then the next day). No message goes to anyone.

## 4. Drawing in the shape

### The page and the delivered size

When a request holds an `upload_size`, `jobShape` gives its page and delivered size and `startOption` puts them on the job: `input.generate.size` (the page) and `input.generate.deliver` (the upload size). The worker draws at `pictureSize(page)` and delivers at `deliver`.

| upload size | page | image model | delivered |
| --- | --- | --- | --- |
| 1080x1350 | 1088x1360 | 2176x2720 | 1080x1350 |
| 1200x1200 | 1216x1216 | 2432x2432 | 1200x1200 |
| 1600x900 | 1536x864 | 3072x1728 | 1600x900 |
| 1080x1920 (Story) | 1152x2048 | 2160x3840 | 1080x1920 |

Instagram and Facebook stills are planned and drawn exactly as today. Only their delivered size changes, from 1440x1800 to 1080x1350.

All slides of a carousel are rows of one `startOption` call from one request, so they share one size.

### The logo's placement

`design_brand_settings.placement` is in shares of the 4:5 frame the settings card shows (`FRAME`, 1088x1360). `placementFor(placement, logoW, logoH, page)` maps it to another page:

- A 4:5 page: the placement itself, unchanged.
- Any other page: the logo keeps its pixel size and its distance from its corner, scaled by `k = sqrt(page area / 4:5 frame area)`. The pages have nearly the same pixel count, so `k` is close to 1 and the logo covers the same share of the picture.
  - `width' = width x 1088 x k / pageW`
  - `left' = left x 1088 x k / pageW` (left and right anchors; center stays centered)
  - vertical: the gap to the nearer edge (top or bottom) is kept, scaled by `k`, and never past the point where the logo would be centered.
  - The logo always ends inside the page.

For `{anchor: left, width: 0.3, top: 0.05, left: 0.06}` and a 600x200 logo (326x109 px at 65, 68 on the 4:5 frame):

| page | width | left | top | pixels |
| --- | --- | --- | --- | --- |
| 1216x1216 | 0.2683 | 0.0537 | 0.0559 | 326 wide at 65, 68 |
| 1536x864 | 0.2012 | 0.0402 | 0.0745 | 309 wide at 62, 64 |

A Story keeps `storyLogoPlacement` (the safe band).

The mapped placement is written on the job (`input.placement`), which is the one value every later step reads.

### Every place that assumed a size

| place | what it assumed | now |
| --- | --- | --- |
| `design-worker` `DEFAULT_PAGE`, `pageOf` | 1088x1360 with no `generate.size` | unchanged: the page of a job with no size |
| `design-worker` finish, verify, `picture_check` | `outputSize(page)`, 1440 wide | `deliveredOf(job)`: `generate.deliver`, else `outputSize(page)` |
| `canva/finish.ts` `OUTPUT_WIDTH`, `outputSize` | 1440 wide | unchanged: the delivered size of a job with no `deliver` |
| `canva/finish.ts` `pictureSize` | twice the page, multiples of 16, 3840 at most | unchanged, used for every page |
| `canva/jobs.ts` `startOption` | no size for a still, `STORY_PAGE` for a Story, the stored placement | page, delivered size and mapped placement from the request's `upload_size` |
| `canva/brief.ts` `designPrompt` | "post (4:5)", "carousel (4:5)" | the page's own shape; a 4:5 page gives the same words as today |
| `canva/options.ts` planner prompts | no shape | one line more for a still that is not 4:5 |
| picture service `canvas` | the page it is sent | unchanged: it is sent the job's page and placement |
| picture service `slot`, `locate` (the usual width) | `canvasLogoRect(placement, design size)` | unchanged: the job's placement is already the page's |
| picture service `slot-file`, `finish` | rectangles in `frame` pixels | unchanged |
| picture service `read` (words, marks, the logo area) | the page it is sent | unchanged |
| the logo set's canvas file and ground | a file and a color, no size | unchanged |
| `lifecycle/designSettings.ts` `FRAME`, `logoPick.ts` `measuredPlacement`, the settings card | 4:5 | unchanged: this is the frame the stored placement is defined on, and `placementFor` maps from it |
| `design/story.ts` `STORY_PAGE`, safe band, band read | 9:16 | unchanged. A Story row is accepted only at 9:16, so its page is always 1152x2048 |
| the video path (`startVideoOption`, video-worker, `CARD_SIZE`) | 9:16 | untouched |
| app: post panel viewer | the design's own shape once loaded | unchanged |
| app: variant tiles, the all-clients week card | a fixed box by format | the design's own shape once it loads (`DesignFrame`) |

### The reads of a delivered design

The words are read on the page-size JPEG, as before. The area around the logo is cut from the delivered file, so its rectangle is computed from the delivered size (`logoAreaRect(rect, frame, deliveredOf(job))`): on an Instagram design it is now a crop of a 1080-wide file where it was a crop of a 1440-wide one. The logo is 25% smaller in that crop. The check asks whether anything touches or crosses the logo, which does not depend on the scale.

## 5. Version skew

Order: the migration, then `design-worker`, `video-worker`, `design-request`, `run-scheduled-jobs`. The worker calls `design_size_refused` and `note_platform_size_outcome`, which the migration creates.

- The migration alone changes nothing: no code reads the tables or the column yet.
- A job from before the change has no `generate.deliver` and no mapped placement. Every reader falls back to today's values, so it finishes as today, whichever worker runs it.
- A request from before the change has no `upload_size`. Its replacement options are started as today.
- The new worker with the old `design-request`: jobs have no size, as today.
- The old worker with the new `design-request` (the reverse order): the page and placement are followed, the delivered picture is 1440 wide in the page's shape. Not wrong, not the upload size. The order above avoids it.

## 6. A size the image model refuses never fails a design

`_shared/design/sizeFallback.ts`, the worker's generate step, and section 6 of the migration.

- **What the job carries.** `startOption` writes `input.as_before` beside the mapped values: the stored placement, and for a Story its page. That is the job as it was made before the table.
- **The fallback.** `imageEdit` answers a 4xx that is not the rate limit as `ModelRefused`. When that happens on the generate step of a lead job (a single design or a carousel's cover) that carries `generate.deliver`, the worker calls `design_size_refused`, applies the same change to the job in hand (`asBeforeInput`), has the canvas made again for the 4:5 page and asks the model once more, inside the same step. No try is spent and no design is counted. It happens once: afterwards the job has no `deliver`. A refusal of the second request is an error as it always was.
- **One size per carousel.** `design_size_refused` changes every active job of the option in one statement and clears the request's `upload_size`, so replacements are made as before too. Slides wait for the cover's design, so none has drawn when the cover falls back. A slide after the cover never falls back alone: its cover was drawn in the same size. A design drawn for another page than its job now has (`state.drawn_for`, for a slide whose draw was in flight) is dropped without being counted and drawn again.
- **The record.** The fallback follows any refusal, but the size is recorded as refused (`platform_size_outcomes`: `refused_at`, the model's words, `refusal_confirmed_at`) only when both hold: the redraw asked the model for another picture size than the refused request, and the redraw succeeded, in the same step. A refusal for a key, billing or the picture's content is refused again at once and records nothing. A platform whose page is today's (Instagram, Facebook, a Story) asks the same picture size twice and records nothing. A successful draw in a size records `drawn_at`. For diagnosis in the database only.
- **Off at once, tried again weekly.** A recorded refusal of the size in use sets the row's `usable` to false in the same call, so later requests read no size and are designed as before: one refused design, not one per request. The weekly run then takes the row back to the size before it when the model has drawn that one (`reverted`, whether or not the guide could be read). Otherwise, on its next run that reads the guide and still finds the size listed, it sets the row usable again and clears the refusal (`retried`), so the next design tries the size. If the model truly cannot draw it, that is one refused design a week, and none fails. A size refused and not drawn since is never chosen from the guide for another row state (`model_refused`).

## As built

Built as written. Files:

- `supabase/migrations/20261117150000_platform_sizes.sql`
- `_shared/design/platformSize.ts` (the key, the checks, the page, the placement, wildly), `shape.ts` (a shape in words), `platformSizeDb.ts` (the read at request time), `platformSizeRead.ts` (the guide's text and parts, the outcome), `platformSizeRefresh.ts` (the job)
- Small edits: `canva/jobs.ts` (`startOption`), `canva/brief.ts` (the shape in the prompt, `deliver`), `canva/finish.ts` (`deliveredSize`), `canva/options.ts` (`shapeLine`), `design-worker/index.ts` (`deliveredOf`), `design-request/index.ts` (the read, the planner's shape), `run-scheduled-jobs/index.ts` and `scheduled-jobs/types.ts` (the job kind)
- App: `src/lib/naturalRatio.ts`, `src/components/calendar/DesignFrame.tsx`, used by the all-clients week card and the post panel's variant tiles. The calendar card's thumbnail band and the Story card keep their fixed frames: the first fits the whole design inside a band, the second is 9:16 by definition.

`run-scheduled-jobs` also answers `{"mode":"platform_sizes_dry_run"}`: the guide fetched and read now, each row's outcome, nothing written. It makes one model call.

### What the first real runs must show

- `platform_sizes_dry_run`, or the first scheduled run: `ok` true and seven rows `same`. That proves the edge runtime fetches the guide and the model answers in the structure.
- The first LinkedIn still: `input.generate.size` 1216x1216, a design at 2432x2432, a delivered file of 1200x1200, the logo at its usual corner.
- The first X still: page 1536x864, design 3072x1728, delivered 1600x900.
- The first Instagram or Facebook still: page 1088x1360 as before, delivered 1080x1350.
- The first Story: delivered 1080x1920.

## Limits, said plainly

- The image model has drawn 4:5 and 9:16 for this app. 2432x2432 and 3072x1728 are first drawn on the first LinkedIn and X requests. If it refuses one, those designs are made as before (section 6) and the weekly run takes the size back.
- Any 4xx that is not the rate limit triggers the fallback, since the model's wording for a size it refuses is not known. A refusal for another reason is refused again as before and spends tries as it always did, and records nothing against the size. A content refusal that happens to pass on the redraw of a square or wide design is recorded, switches that row off, and is undone by the next weekly run.
- A row that went back to an earlier drawn size stays there while the guide lists only the refused size.
- The refresh was built against the guide as fetched on 17 Nov 2026 from a laptop. Whether the edge runtime's fetch gets the same page is known after the first run.
- The guide lists 1080x1080 before 1080x1350 for Instagram, and 1200x627 on its cheat sheet for LinkedIn. The seed holds the sizes agreed (1080x1350 and 1200x1200), which the guide also lists, so by the rule above they stay.
