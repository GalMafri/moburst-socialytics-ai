# Picture work out of the edge function, one request lifecycle

Status: approved by Lital on 12 Nov 2026 (scope: the first slice of the Vercel move). Implementation plan: docs/superpowers/plans/2026-11-12-picture-service.md. The notes marked "As found while planning" record where the code differed from this document when the plan was written; the plan follows the code. Where the service runs and how it knows a call is ours changed at release: the section "As released 16 Nov 2026" is the current word on both, and the text below is written to match it.

## Why

On 11 Nov 2026 every design-worker run ended with "CPU Time exceeded" 50 to 70 seconds after boot and no run completed. Three jobs were running in every pass: two Pay The Pyper images at the logo search (its square 2160x2160 logo makes the search take about 4.3 seconds) and a Bader Law Story at the brand-marks check (the Story is drawn at 2160x3840; decoding that 11 MB PNG alone takes 0.7 seconds on a laptop and several times that in the worker). A killed run writes nothing, so the jobs were re-leased every two minutes for hours, and every other client's design starved with them.

This is not a bug in one step. Every picture step of a design (logo search, redraw preparation, brand-marks read, logo placement and finish, the verify crops, and the video worker's kit cleaning and frame handling) decodes and resamples whole pictures in JavaScript inside a Supabase edge function, which gets 2 seconds of CPU per request and shares 256 MB of memory across the requests one worker serves. The 19 Oct audit measured it (a single finish peaks near 238 MB; three designs at once ran the worker out of memory on 13 Oct) and recommended moving picture work out; the recommendation was parked. The 90-minute request limit and the died-run counting released on 11 Nov make such runs end instead of hanging; they do not make them succeed.

The damage control of 11 Nov (request time limit, died runs count as tries, cheaper logo search) is live: commit 7b8397b on main, deployed 17:10 IST; its first sweep closed the three stuck requests at 17:12. This document is the fix.

## Goals

- A design of any kind (single, carousel slide, Story) and a video's frame and kit finish for every client, whatever the page size (up to the model's 3840 px edge) and whatever the logo file, with the same quality as today.
- A request always ends with a design or with a reason, decided by one set of rules for every kind, within a bounded time, with nobody doing anything by hand.
- The edge workers never decode a picture again: they orchestrate, record and call.
- Picture steps are observable: each call has a duration, a size and an outcome that the job records.

## Non-goals

- Changing how designs look, what the image model draws, or the 2x drawing rule (drawn at twice the page, delivered at 1440 wide; kept as is).
- Moving the queue, the model calls or the database out of Supabase in this project (the scope section says how this work relates to that move).
- Rewriting the Trends or any other screen.

## Anti-goals (what would make this a failure even if it works)

- A flag, a per-client switch, a "set the service URL first" step or any manual setup. The service is part of the product's deploy, like a function.
- Lower picture quality: a finish that is not pixel-equivalent to today's finish on the same inputs is a defect.
- A new way for a request to hang: every call is bounded and every failure returns a reason the job records.
- Pixel-guessing gates (see the design rules in memory): the service does the same deterministic work the worker does today, nothing more.

## The design

### 1. The picture service

A small HTTP service, deployed from the Socialytics repository to Moburst's Vercel Pro team (Fluid compute with the Performance function size, 2 vCPU and 4 GB of memory per instance, autoscaling; both are settings of the Vercel project, named in "As released 16 Nov 2026"; a call is given 90 seconds), using sharp (libvips) for decoding, resampling, cropping and encoding instead of imagescript in JavaScript. One route per picture operation the workers do today, each a pure function of its inputs:

- `locate`: design picture + logo file + usual rectangle + background color + scales -> the logo's rectangle and score (today's `findLogo`, same algorithm, same answers on the same inputs).
- `read-picture`: picture + page size -> a JPEG at page size for the model to read (today's resample before the marks and verify reads), plus optional crops (the Story band, the area around the logo) returned as separate images.
- `finish`: logo-free picture + logo file + rectangle + page -> the delivered file exactly as today: one PNG at 1440 wide (`outputSize`), the same compositing math. Nothing about what a client receives changes, and `verify` keeps reading that same file, logo-area crop included.
- `canvas`: logo file + background color + placement + page -> the generation canvas and mask PNGs the `generate` step hands to the image model today (today's canvas and mask building, pixel for pixel). `generate` still calls the image model itself; it only stops building pictures.
- `transcode` and `title-read` (video worker): the opening frame and each cleaned kit still are a model PNG re-encoded as a JPEG (`transcode`); the title layer is drawn by the image model and stored as is, and its only picture work is the read-back (`title-read`: the lettering's box on the layer, a grey ground under it, a half-size JPEG for the read). The kit's source-still size comes from the JPEG header, with no call. As found while planning: the design named `kit-still`, `frame` and `title` routes and "title layer compositing"; the code has no such compositing.

Every decode, resample, composite or encode in `design-worker/index.ts` and `_shared/video/steps.ts` maps to one of these routes: 24 operations on the design path and 5 on the video path, listed in the plan (`_shared/video/kit.ts` holds no bitmap work; `canva-finish` is retired, its `advance` and `tick` answer 410, and its bitmap code is dead). The older functions that still decode pictures on their own (generate-post-image, generate-post-video, build-design-system and the other pre-13-Oct paths listed in memory as carrying pre-existing type errors) are not in scope: they are not on the design or video path and are retired separately.

Every route reads its inputs through signed storage URLs the worker mints (short-lived GET) and writes its outputs through signed upload URLs the worker mints (short-lived PUT). The service holds no secret at all: no Supabase service key, no secret of the product's other vendors and no shared secret with the workers. It knows a call is ours through the database: the worker opens a call before each attempt and sends its id, and the service claims that id once before it reads the request ("As released 16 Nov 2026", The call check); it refuses any call it cannot claim. It takes a link only when the link is in the product's own storage and follows no redirect, so even a claimed call cannot send it to another address, and one call's reads and writes share 30 seconds of time in storage, below the worker's 60 and counted only while storage is read or written ("As released 16 Nov 2026", What the service will fetch; changed 17 Nov 2026). Each call carries the job id and step, is idempotent (same inputs, same outputs, outputs written to deterministic paths), and is bounded by a timeout the worker sets (60 seconds: an edge request's wall limit is 150 seconds and the design worker's step loop may run 50 seconds before a step starts; a finish of a 2160x3840 page takes seconds with libvips). The service answers `{ ok: true, result }` or `{ ok: false, reason }`, and `reason` is written in the product's words (no library errors).

The service logs each call with duration, input sizes and outcome. It has no state and no database.

### 2. The workers after the move

`design-worker` and `video-worker` keep the queue, the leases, the model calls (image model, Claude reads), the job records and the request settlement. Every place they decode or resample a picture today becomes one service call:

- design: `generate` -> service `canvas` for the generation canvas and mask (as found while planning: `generate` decodes the logo and builds both today; `unlogo` alone has no decoding); `locate` -> service `locate`; `marks` and `verify` reads -> service `read` (crops included); `finish` -> service `finish`.
- video: `title_check` -> service `title-read`; the frame's and the kit stills' JPEG re-encode -> service `transcode`; the kit's source-still size -> a JPEG header read in the worker.

A step that calls the service records the service's reason on failure. A call the service refused (a 400, a 401 for a call it could not claim) and a picture it could not work with (an `ok: false` answer) each spend a try, as any other step error does. A service that is unavailable (network error, timeout, an answer cut off while it is read, 429 or 5xx after the client's one retry, a failure that is not the service's own JSON answer, or a database that could not open the call or answer the service's claim) is a wait, the way a busy image model already is: the reason is kept on the job (the service's own, when its last answer gave one, such as storage that cannot serve a picture right now), its lease is released, no try is spent and the next pass tries again (`_shared/canva/stepError.ts`, one rule for both workers; `_shared/canva/hold.ts`, one hold for both). Ruling (final review): an unavailable picture service waits and does not spend a try; bounded by the 90-minute request limit; costs a request that waits out an outage instead of failing fast.

What makes a wait cost nothing (final review, round 1):

- The job's step is saved with its state on every error. A step that ran before the one that waited (a video's title, drawn and paid for before its check) is not run again.
- A paid picture is counted only once the image model has made it: a design, a logo removal, a video's title, its opening frame. A wait before that uses up none of the job's pictures, so an outage of any length ends no job on its picture limit.
- One rule for every paid picture (the title's layer, the video frame's PNG, each kit still's edit by still and round, a design, a logo removal): stored, counted, saved to the job row with the step that uses it, then used (`saveJobProgress` in `_shared/canva/jobs.ts`). A wait never pays for it again, and neither does a run that dies in a picture call that hangs: the next pass goes on from the row. A kept picture the service could not work with (`ok: false`) is dropped and drawn again under its step's own limit; one whose call was refused stays, and the refusal spends a try.
- Only errors about the stills themselves are tries of a client's kit. A claim that ended in a wait is no try of the kit, and neither is one that ended in a call the service refused (a call it could not claim, a 404, a 400): the refusal spends a try of the job, which fails after its tries with the service's reason. So neither an outage nor a refused call ever stores an empty kit for a client.
- A kit claim is only as good as the job that holds it. When a job that holds the claim has ended (failed after refused calls, canceled, or finished without storing the kit), the next job claims at once instead of waiting out the 15 minutes, and goes on from the ended job's pick, outcomes and paid edits (the files are the client's own), so nothing paid for is paid for twice.
- A job with no request (the job that reads a client's video style and makes its kit) has no request for the 90-minute limit to end. The same limit is counted from that job's own start: still waiting after it, the job fails with the reason and stores nothing for the client. The kit stays unmade, and the next video that needs it makes it, under its own request's limit.

A step never holds a bitmap, so the memory ceiling of a pass no longer depends on the clients in it. The pass structure (one `advance` request per job) stays.

### 3. One request lifecycle

`_shared/design/requestRules.ts` already decides most ends (`no_design`, `no_progress`, `no_footage`, `filmed`, `post_passed`, `post_removed`). The gap found on 11 Nov: a person pressed Design on a Bader Law video and on its Story for a post dated two days earlier; the video request, routed to filming, was closed as `post_passed` within eight minutes, while the Story request went on. The rule becomes one for every kind, and it follows what a person asked for:

- A request a person starts runs to its end whatever the post's date: the person asked, and a Story or a late post is posted by hand anyway. It ends with a design, or with `no_design` or `no_progress` under the bounds that exist today (tries, the 90-minute limit). A paid video clip is never stopped by a date.
- `post_passed` applies only where nothing is being made: a request waiting for footage, and the weekly button's choice of posts (it leaves past posts out, as it does today).
- The same function decides this for single, carousel, Story and video, at the same two moments (when a request is settled after a job ends, and in the sweep).

As found while planning (12 Nov): no code closes a request being prepared by its date; settlement and the sweep apply no date rule, and `post_passed` is written only by the filming sweep on `needs_filming` rows. The gap is at creation: the `create` action and `planNow` park a video in the filming wait without reading the post's time, and the filming sweep closes it within ten minutes. The week button already checks the time before filming. The rule is therefore applied where the gap is: a person's video for a post whose time has passed, or is less than a day away, is made from the client's posts (route `posts`), never parked; the filming sweep and the week button's exclusion of past posts stay as they are. A Story is a `single` request with the Story format (there is no `story` kind).

What a person sees follows the rule approved on 19 Oct and unchanged here: a request that ends without a design closes quietly and the post shows "No design yet" with its Design button back, the moment the request ends. No end reasons are written on cards; the 11 Nov Story that said "Preparing design" for hours was a request that never ended, which the 90-minute limit now prevents.

### 4. Deploy and proof, in this order

1. The service, deployed from the repository (the `server/` folder, its own `package.json`, a function of the app's Vercel project `moburst-socialytics` in the Moburst team, shipped by the GitHub Actions job that already deploys the frontend with the team's token), after the migration that lets it check a call. Nothing is set by hand. Its own tests cover each route on synthetic fixtures at the real sizes (a 2176x2720 single, a 2160x3840 Story, a 2160x2160 square logo like Pay The Pyper's, a 700x239 wide logo like LegaBot's) with imagescript 1.3.0 as the oracle.
2. Proof before any worker calls it: replay every design finished since 2 Nov (32 designs; the finish arithmetic is unchanged since then, and no Story has ever finished) from its stored logo-free picture, logo and rectangle through the service's `finish` and compare with the delivered PNG pixel by pixel. The bar is zero differing pixels: the service runs today's resample and blend arithmetic (libvips decodes and encodes; the arithmetic stays ours), so there is no quality question to argue. The bar applies to every PNG the service writes and to decoding; JPEGs that feed models keep their dimensions and quality settings. `locate` is the same `findLogo` module the worker runs, so its proof is decode equivalence (imagescript and libvips give the same pixels for every stored file); the replay prints its rectangles beside the stored ones. Then a load test: a Moburst week's worth of designs (11 posts, 3 options each) through the deployed service at once, run as the design worker's `picture_check` action, with durations recorded.
3. The worker release: both workers switched to the service in one release (no flag), with the one-lifecycle change and the post-card words. The three kinds of requests that failed on 11 Nov are the acceptance check: a Pay The Pyper single, a Bader Law Story and a Moburst video, each ending in a design or a reason within its bounds.

### 5. What it costs

Vercel Pro is already paid (team Moburst since 25 Oct). Picture calls are seconds of compute per design; the image model and Claude reads cost what they cost today. No new vendor.

## Scope (Lital, 12 Nov 2026: the first slice of the Vercel move)

The picture service is built as the first part of the Socialytics server on Vercel, the home the queue workers, the report engine and the API move into later under Lital's Q4 initiative (Socialytics and AdVisor off Lovable and n8n, hosted on Vercel). What that fixes now, so nothing is rebuilt at the move:

- One Vercel project in the Moburst team (Pro, Fluid compute), the app's own, `moburst-socialytics`, with the server as its function, built from a `server/` folder of the Socialytics repository: Node 22, TypeScript, one HTTP app with routes grouped by concern (`/picture/*` now; `/jobs/*`, `/reports/*` later). The 12 Nov decision was a project of its own, `socialytics-server`; why that changed is in "As released 16 Nov 2026". Shared types between the edge functions and the server live in one place in the repository, so a call's request and reply are typed on both sides.
- Deployment follows the repository's main branch through the GitHub Actions job that already deploys the frontend to the team with the `VERCEL_TOKEN` secret (a token of ai@moburst.com): that same job builds and deploys the server with the site. No Git app is linked and none is needed. As found while planning: the design asked for a Git integration and a preview per branch; previews are not part of this slice.
- The function is a committed entry, `api/picture.mjs` at the repository root, which re-exports the esbuild bundle `server/dist/app.mjs`, made by the root package's `vercel-build` script (the custom build step Vercel documents for a Node.js function); the root `vercel.json` rewrites `/api/health` and `/api/picture/*` to it. As found in final review (12 Nov 2026): a bundle written straight into `api/` by the build is not there when Vercel reads the project's files, so that earlier layout could not build (reproduced with Vercel CLI 63.1.2). Layout in `server/README.md`.
- Address: the workers call the app project's production domain, `https://moburst-socialytics.vercel.app` (`PICTURE_SERVICE_URL` in `_shared/picture/contract.ts`). The project has held that domain since it was made (its domain list, read on 16 Nov 2026), and it answers without a sign-in (read the same day).
- Secrets: none. The service reads no environment variable and never holds a Supabase service key. Later workers that need a vendor's key keep it server side in the Vercel project; a call between our own parts is checked through the database, as here.
- Observability: Vercel's request logs and one structured log line per picture call (job, step, sizes, duration, outcome). Later workers log the same way.
- Tests: the server has its own test suite in the repository (Vitest, run with the rest), with route tests on the fixtures named in section 4 and a pixel-equivalence test against today's compositing code.

What stays on Supabase in this slice: the database, storage, the queue (`scheduled_jobs`, `canva_finish_jobs`), the edge workers, the model calls and the API. They move in later slices, onto this project.

## As released 16 Nov 2026

Two parts of the 12 Nov design needed a person, and the design feature was failing in production, so both were replaced by parts that need nobody. Everything else above stands.

### Where it runs

The service is one Node function of the app's own Vercel project, `moburst-socialytics` (team Moburst), at `https://moburst-socialytics.vercel.app`. The 12 Nov plan was a second project, `socialytics-server`, with a second deploy job in `.github/workflows/deploy.yml`. The Git credential that releases this repository may not change workflow files, so that job could never be added. The workflow on main already builds and deploys the app's project on every push (`vercel build --prod`, then `vercel deploy --prebuilt --prod`, at the repository root), and the service now ships inside that build with the workflow unchanged:

- `server/` is an npm workspace of the root package, so the one install the jobs run (`npm ci` at the root) installs it, sharp's native files for the runner included. There is one lockfile.
- The function entry is `api/picture.mjs`, committed. Vercel's Node.js builder runs the root `vercel-build` script (`npm run build --workspace server`, one esbuild bundle) and packs the entry with the bundle and sharp.
- The root `vercel.json` gives the function 90 seconds and rewrites `/api/health` and `/api/picture/*` to it, ahead of the page fallback. Every other path, the `/api-keys` page among them, is served as before; the site's build command and output are unchanged.
- `api/` also holds a client library. `.vercelignore` lists each of its folders, and `server/test/deploy.test.ts` fails when a new entry in `api/` is not listed, so nothing else there can become a function.
- The function runs on Node 22 because the root `engines.node` is `22.x`; package.json engines override the project's Node.js setting (24.x on 16 Nov), so the Node.js setting is left as it is.
- The build job's own steps cover the server: `npx tsc -b --force` type-checks it (the root `tsconfig.json` references `./server`) and `npx vitest run` runs its tests.

What this costs the site's own deploy: the server's install, type check and tests now run inside the one `build` job, and the SSH deploy of the user-facing site needs that job too. A failure that shows only on the Linux runner would stop the site's deploy as well as the function's. Nothing else is lost in that case, because no edge function has been deployed at that point. The cost measured in review on a 10-core Mac is small (62 more packages in `npm ci`, 6 seconds of type check, about 12 seconds of tests), and the risk is low (sharp only decodes and encodes, the arithmetic is the product's own), but the build and the function have run only on macOS arm64. The first run on Linux x64 is the push itself, so that run is watched to its end before anything else is released (Release order, step 3).

Two settings of the Vercel project that the service depends on. Both are read or set through the Vercel connector, never by a person in a dashboard:

- Deployment protection. Vercel Authentication is on for everything except the project's production domain (`ssoProtection.deploymentType` is `all_except_custom_domains`, read 16 Nov 2026). `moburst-socialytics.vercel.app` is that domain and answers without a sign-in; the per-deployment addresses and `moburst-socialytics-moburst-ai.vercel.app` ask for one. The service must only ever be called at the production domain, which is what `PICTURE_SERVICE_URL` holds. If this setting were changed to cover every deployment, a sign-in page would stand in front of the service: every picture call would wait (a page is not the service's own answer, so the worker counts the service as unavailable) and each request would end after its 90 minutes with no design.
- Function size. `resourceConfig.fluid` is `true` and `resourceConfig.functionDefaultMemoryType` is `performance` (2 vCPU and 4 GB per instance), the size section 1 names and the 12 Nov plan gave the project it dropped. The connector's read of the project does not show these two values, and this project was made for a static site, so the release sets both through the connector before the push (a deployment takes the project's function defaults when it is made). The built function itself carries only the runtime (`nodejs22.x`) and its 90 seconds. Whatever the size, the load bar of section 4 (33 finishes at once, each under 10 seconds) is measured on the deployed function by `picture_check` before any other worker is switched (Release order, step 8).

### The call check

The 12 Nov design had a shared secret, `PICTURE_SERVICE_SECRET`, that a person typed into Lovable's function secrets and into Vercel. It is removed, with every branch that waited for it to be set. A call is now checked through the database (migration `20261116100000_picture_calls.sql`):

- `public.picture_calls` holds one row per call. Row level security is on, no policy lets anyone in and the app's roles hold no grant, so the two functions below are the only way to it. Its only policies are the three restrictive ones every table carries, which keep an OAuth session from writing.
- `open_picture_call()` (security definer, service role only) inserts a call and returns its id, and clears calls older than a day in the same statement, so the table stays small with nothing to sweep it.
- `claim_picture_call(p_call)` (security definer, callable with the public anon key) marks a call claimed and answers true only when the id exists, is unclaimed and was opened within the last 120 seconds. The update takes the row's lock, so one id cannot be claimed twice.
- The edge client opens a call before every attempt, its one retry included, and sends the id in the `x-socialytics-call` header. It gives the database 5 seconds to open the call.
- The service claims the id before it reads the body, through the project's public REST endpoint with the public anon key (both imported from `public-env.ts`, the repository's one file of public values), with a 5 second limit. Claimed: the call goes on. Not claimed, no id, or an id that is not a UUID: 401 "Not allowed." (a malformed id never reaches the database). The database not answering: 503, which the client already treats as the service being unavailable, so the job waits and spends no try. A database that cannot open the call is the same wait.
- A well-formed id the database does not claim leaves one log line in the service (the path and "The database did not claim the call.", never the id), so a job that was refused can be traced. A call with no id or a malformed one, which anyone on the internet can send, is not logged.
- `GET /api/health` stays open and says only the service's name.

Why this instead of a secret: nobody enters anything anywhere (the anti-goal of this document: no manual setup), there is nothing to rotate or to leak from a dashboard, and a call cannot be replayed, because its id works once and for two minutes.

Who can open a call, exactly: of the roles the app and its REST endpoint can use (`anon`, `authenticated`, `service_role`), only the service role, which the workers already hold and the service never does. The database owner and the hosting platform's own roles can too, as they can for every table and function in the project: the default privileges of schema `public` give the platform's roles EXECUTE on new functions and SELECT and INSERT on new tables (read from `pg_default_acl` on 16 Nov 2026), the same grant every other service-role-only function here carries. The REST endpoint cannot switch to those roles, and the platform holds the owner's role in any case, so this is no new exposure. The migration does not revoke from them: what the platform's own tools need is not known.

### What the service will fetch

The call check rests on one database grant. So that a later migration that granted `open_picture_call` too widely could not turn the function into something that fetches any address it is handed, the service has a second line of its own (`server/src/storage.ts`, `server/src/picture/schemas.ts`):

- Every link in a request must be an https link under the product's storage address, `PUBLIC_DEFAULTS.VITE_SUPABASE_URL` + `/storage/v1/` (the same public values file as the claim; same host and port, no name or password in the link, and a path that stays inside the storage folder once it is resolved). Any other link is a body that is not well formed: 400 naming the field, before anything is fetched. The workers sign every link with the storage client of that same project, and the 32 picture links the design worker stored in the 30 days before 16 Nov 2026 all start with that address (read from `post_iterations.media_urls`).
- No redirect is followed, on a read or on a write.
- One call's reads and writes share 30 seconds of time in storage (`STORAGE_TIMEOUT_MS`), below the worker's 60 seconds for the call, so a storage that stalls ends as the service's own 503 with a reason and a wait for the job, never as a function held to its 90 seconds. Changed on 17 Nov 2026: until then it was one 45 second timer started with the call, which also ran while the call worked on its pictures, so a call with long searches could not read its later pictures. The time is now counted only while storage is read or written (`storageTime`), the searches give other calls a turn every 20 ms, and the two routes that search work to a time budget the caller sends (docs/superpowers/specs/2026-11-16-logo-tone-design.md, section 5, "A call's time").

Before a claim nothing leaves the function except the one fixed claim request.

### To watch after the release

Reasoned from the code, not seen: the claim has a 5 second timer and the pixel work (overlay, resize, crop) is synchronous JavaScript. With several calls in one function instance, a long synchronous stretch that covers the timer's deadline lets it fire before the database's answer is read, and the service then answers 503 although the database already marked the id claimed. The damage is bounded: the worker's retry opens a new call, and a second failure makes the job wait without spending a try. If Vercel's log shows "could not check the call" with "timeout" while the database is healthy, raise `CLAIM_TIMEOUT_MS` or move the pixel loops to a worker thread.

### Deferred

These wait for a Git credential that may change files under `.github/workflows`; none is needed for the release:

- Node 22 in the workflow's two `setup-node` steps. The jobs run on Node 20 today; the build, the tests and `vercel build` pass on it, and the function itself runs on Node 22 on Vercel.
- A Deno type check of every edge function entry point in the build job. Until then `supabase/tests/_shared/denoCheck.test.ts` runs that check wherever Deno is installed (every machine a release is prepared on) and is skipped on the runner. The test that asserted the workflow step is removed with the step.
- The server's own workflow steps (install, type check, build). They are not needed: the root install, type check and test steps cover the server, and the bundle is built in the deploy itself.

### Release order

The service is released with the QA fix batch it was built on. Main is still the code of 11 Nov (`7b8397b6`), and this branch is that batch (27 fix batches and 25 migrations dated 13 Nov, more than 240 commits and about 670 files ahead of main) plus the service. So the push carries the whole batch, and the design functions need more than this document's one migration. On 16 Nov 2026 the live record (`supabase_migrations.schema_migrations`) held 13 of the batch's 25 migrations. The 12 it did not hold: `20261113100100`, `100200`, `100500`, `100600`, `100700`, `101000`, `101010` (`use_design`), `101020`, `101200`, `102100`, `103000` and `103200` (`video_style_take_kit`). The steps below are the design unit's; the batch's other function deploys and the migrations that travel with them follow the batch's own release runbook of 12 Nov. No step is done by a person: migrations and reads go through the Lovable connector, the setting and the deployment read through the Vercel connector, function deploys through a message to the Lovable agent.

Before the push:

1. Set the Vercel project's function size: `resourceConfig.fluid` `true` and `resourceConfig.functionDefaultMemoryType` `performance` on project `moburst-socialytics` (Where it runs). It applies to deployments made after it.
2. Apply and record `20261116100000_picture_calls.sql`. It adds one table and two functions that nothing calls yet.

The push:

3. Push the release commit to main. This is the batch going live: the unchanged `deploy` job puts the whole new frontend on socialytics.moburst.com over SSH, and the unchanged `vercel` job builds the site and the function into project `moburst-socialytics`. A red `build` job means neither is deployed, and nothing else is lost, because no edge function has been deployed yet. Four gates, all passed before step 4:
   - the workflow run of the pushed commit ends in success (this is also the first run of the server's install and tests on Linux);
   - the Vercel project shows a READY production deployment of the pushed commit;
   - `curl -s https://moburst-socialytics.vercel.app/api/health` returns the body `{"ok":true,"service":"socialytics-server"}`. The gate is the body. The status proves nothing: before the function exists the same address answers 200 with the site's page. The body also proves that the function sees the original path after the rewrite;
   - `curl -s -X POST https://moburst-socialytics.vercel.app/api/picture/finish -H 'content-type: application/json' -d '{}'` returns `{"ok":false,"reason":"Not allowed."}` with status 401. Before the function exists this answers 405 with a page. It proves that a POST to a picture route reaches the function, and it makes no database call.

The design unit, at an hour when nothing is being designed:

4. Nothing in flight: `select (select count(*) from public.design_requests where status = 'preparing') as preparing, (select count(*) from public.canva_finish_jobs where status not in ('done','failed','canceled')) as open_jobs limit 1;` answers 0 and 0. Read it again before steps 7 and 9.
5. Apply and record, in this order: `20261113101010_use_design.sql` (the new `design-request` calls `use_design`), `20261113101020_worker_lease_release_deletes.sql` (the lease functions keep their signatures), `20261113103200_video_style_take_kit.sql` (the new `video-worker` calls `video_style_take_kit`).
6. The check that the database has what the functions call, before any function deploy. Every database function in the import graphs of `design-worker`, `video-worker`, `design-request` and `canva-finish` must exist:
   ```sql
   select w.name from (values ('open_picture_call'),('claim_picture_call'),('use_design'),('video_style_take_kit'),('claim_worker_lease'),('release_worker_lease'),('video_clip_order'),('video_clip_ordered'),('video_clip_stop'),('video_style_claim_kit'),('video_style_merge'),('can_write_client'),('is_client_member'),('is_moburst_staff'),('is_admin')) as w(name)
   where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = w.name) limit 20;
   ```
   It must return no row (on 16 Nov, before steps 2 and 5, it returned the first four). And the record must hold the four versions: `select version from supabase_migrations.schema_migrations where version in ('20261116100000','20261113101010','20261113101020','20261113103200') order by 1 limit 10;` returns four rows. `higgsfield_tokens_read` and `higgsfield_tokens_save` are left out on purpose: the new code works with or without them.
7. Deploy `design-worker` alone, from the head of main. From here its picture steps run in the service. A request made in this window is planned by the old `design-request` and run by the new worker, a pairing that was not exercised, hence the empty queue of step 4.
8. Run `picture_check` on the new worker with `{"action":"picture_check","count":33}`. Expected: 33 of 33 `ok`, every `ms` under 10,000. It calls no model, spends nothing and changes no delivered picture (it writes under `picture-check/`). This is the gate for step 9, and it is given 30 minutes from step 7. An answer `{"error":"Unknown action."}` with status 400 is the old worker: step 7 did not take.
9. Deploy `video-worker` and `design-request` (and `canva-finish`, the retired fourth function of the unit, whose new code answers 410) from the same head.
10. Apply and record `20261113101000_design_jobs_unique.sql` right after step 9 (precheck for duplicates first). Not before: the old `design-request` cannot work with that index.

`20261113100500_higgsfield_token_vault.sql` stays last, where the batch's runbook puts it; the picture service does not need it.

What is safe out of order, and what is not:

- A worker that cannot open a call, or a service whose claim the database does not answer, is a wait that spends no try. So is a worker that calls before the function's first deploy: the project answers such a call with a page (405, read 16 Nov), and a failure that is not the service's own JSON answer counts as the service being unavailable. The same holds if a sign-in page is ever put in front of the project. Such a job waits at most the request's 90 minutes (`REQUEST_MAX_MINUTES`) and then fails with the reason.
- A function deployed before its migration is not safe: `design-request` before `101010` breaks the "use this design" action for every client, and `video-worker` before `103200` breaks the video kit step. Step 6 is there to make that impossible.

### Rollback

What is live for the design functions before this release is the code of `7b8397b6` (deployed 11 Nov). Lovable deploys a function from the current files of main only and cannot take a commit id (its answer of 16 Nov), so "back to `7b8397b6`" always means: make that code current on main with a revert commit, never a forced push, then deploy the functions by name.

- The service or its route is wrong and the edge functions are fine (a gate of step 3 fails, or `picture_check` names the service): fix forward with a push. The `vercel` job replaces the function within the run and no edge function is deployed again. Until then jobs wait and spend no try.
- `picture_check` fails for another reason, or designs come out wrong after step 9: if step 10 ran, first `drop index if exists public.canva_finish_jobs_request_option_slide_key;` and delete its record row; then push the revert of the release commit, wait for its build, and deploy from that head the design functions that were deployed so far, `design-request` first, then `video-worker`, `canva-finish`, `design-worker`. Check: `picture_check` answers 400 "Unknown action." again. The revert takes the batch's frontend back with it, so it is also the batch's own way back; run steps 4 to 8 right after the gates of step 3 and before the batch's other function deploys, and a failed `picture_check` is undone by the revert push and one function deploy.
- Leave in place: the `picture_calls` migration, `101010`, `101020` and `103200` (additions, or the same signatures) and the Vercel project's setting. The function leaves the project by itself with the revert push.
- Vercel's instant rollback is not the routine way back: after one, later `--prod` deploys do not take the domain until the rollback is undone, which is a step by hand.

## Calls made in this document (for Lital to check while reading)

- A person's own request runs whatever the post's date (section 3). Her complaint of 11 Nov was a request that closed quietly after a click; this is the rule that prevents it.
- No end reasons on cards: the 19 Oct rule stands.
- Pixel-equivalence bar is zero differing pixels, by porting today's arithmetic.
- The older picture-decoding functions are out of scope.

## Left to the builder (answered in the plan)

- Signed read URLs last 600 seconds; upload URLs keep Supabase's own validity. A transient service failure (network, timeout, 429, 5xx) is tried once more after 2 seconds; if the service is still unavailable the job waits for the next pass without spending a try (section 2), and no paid model call is repeated.
- Logs: Vercel's request logs plus one JSON line per call (route, job, step, sizes, duration, outcome).
- The route list against the code: in the plan's decisions and Tasks 4 to 7.
