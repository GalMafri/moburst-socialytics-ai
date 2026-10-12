# Design engine: how it runs in production

What a client sees: a post panel's **Design** tab with *Create designs*, then *Your options* with *Checks passed*, then *Use this one*, which attaches the files to the post for the **Schedule** tab. Nothing is shown that did not pass every check.

## Parts and where they live

| Part | Where | Deployed by |
| --- | --- | --- |
| Tables `brand_profiles`, `brand_assets`, `design_runs`, `design_options`, `design_rules`, `platform_specs`; `can_act_for_client`; `design_runs_lease/extend/status` | Supabase `rwouwxqggjjacbpbhqsn` | migrations `20261008170000_brand_assets.sql`, `20261012100000_design_runs.sql` (applied 2026-10-12) |
| Edge functions `design-pick` (pick or reject), `design-store` (the worker's door, server secret only), `schedule-sprout-post` (client members may schedule their own posts via `requireActor`) | Supabase | the Lovable agent, from main |
| `DesignTab.tsx` in the post panel | the published app | Lovable publish |
| The worker `engine/scripts/worker.py` | the Socialytics box (`deploy.sh` starts it under `forever` as `design-worker` when `engine/.env` exists) | GitHub Actions deploy on push to main |
| n8n bridges `Socialytics - Design Store Bridge` (`/webhook/design-store-bridge`) and `Socialytics - Higgsfield Bridge (design proof)` (`/webhook/design-higgsfield-proof`) | n8n, Moburst AI project | hold the project's server secret (credential "Socialytics App Webhook") and the team's Higgsfield session |

## The worker's environment (`engine/.env` on the host)

```
ANTHROPIC_API_KEY=<the dedicated Socialytics key>
SOCIALYTICS_STORE_URL=https://moburst.app.n8n.cloud/webhook/design-store-bridge
SOCIALYTICS_PROBE_URL=https://moburst.app.n8n.cloud/webhook/design-higgsfield-proof
SOCIALYTICS_ACT_AS_USER=<uuid of the staff user the worker acts for>
```

With `SOCIALYTICS_STORE_URL` set the worker holds no Supabase key: every row and file goes through `design-store` under the server secret. A host that has the service role may set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` instead and leave the store URL out. A host that has a personal Higgsfield MCP token may set `HIGGSFIELD_MCP_TOKEN` instead of the probe URL.

The worker also needs the client's **learned workspace** at `engine/work/<client-slug>/` (fonts, logo files, the reads cache, the posts for references), which `scripts/learn_client.py` produces. Until the learner runs on the box, the workspaces live on the machine that ran it, and that machine is the worker. A run for a client with no workspace on the host fails with "brand not learned on this host" and the Design tab says the designs could not be made.

## Publishing a learned brand

```
uv run python scripts/learn_client.py --client "Bader Law" --site https://www.baderlaw.com/
uv run python scripts/publish_profile.py --client "Bader Law" --client-id <client uuid> --confirm
```

`--confirm` marks the profile confirmed by the user the store acts for. The worker uses the newest confirmed version.

## Health

`select public.design_runs_status();` (or `design-store` op `status` through the bridge) returns queued and running counts, stuck runs (lease expired) and today's failures. A run leased three times without finishing stays `running` with an expired lease and is listed as stuck.

## Costs

Static: about 18 to 26 Higgsfield credits and $1.6 to $3.4 of model spend per run of up to three options. Carousel: about 18 credits and $3 to $6 per run. Video text cards: no credits; a b-roll clip through Seedance is about 89 credits and is asked for before generation.

## 12 October 2026: what changed after the first live day

**Generation.** Every option's picture is now a whole-frame plate in the client's own look: `picture.brief.build_plate` sends the client's published posts as image references to GPT Image 2.5 (high), with the planner's concept for the supporting element, the family's copy area and logo corner declared calm, and nothing written anywhere. `run.tools.plate_family` sets the family's picture role to `full`, so the plate is the ground under every slot; copy and the exact logo are set on it by code and the gate is unchanged. The self-test's `unrenderable` marks no longer exclude families (the plate carries what the flat ground lacked). One `picture` call takes `option_ids` and makes every option's plates at once (`PICTURE_WORKERS`).

**A run never ends in a client-facing failure.** If the first pass offers nothing, the worker runs a second pass with the first pass's reasons as rules (`SECOND_PASS_MIN_CREDITS`), then offers the brand text cards as option `T` (Remotion stills on a plate, the video's frame gate), and only then drops. The app shows a dropped run as "Finishing up"; the hourly n8n workflow **Socialytics Design Runs Check** (`cFNQ8NienyJ1HJIL`, project "Mobi Moburst") reads `design-store` `status` and mails lital@moburst.com the runs that ended with nothing offered in the last two hours (`needs_staff`) and any run stuck past its lease.

**Picture judge.** `measure.saliency.salient_share` is subject coverage: the share of the picture's subject mass under a slot, or the slot's detail level against `SUBJECT_LEVEL`, whichever is higher; a calm plate reads 0. (Until 12 October it was the slot's mean over the frame mean, which refused calm plates.)

**Sizes.** The main size decides an option; a companion size that fails is left out of the offer (`left_out` in the measure result). Landscape companions (W/H ≥ 1.25) are judged by the platform's band and dead-space floors, not the client's feed floors.

**Video.** A plate in the client's look (one Sonnet sentence for the concept, `PLATE_CREDITS_MAX` 20) sits under the cards in slow motion; a closing card shows the mark alone; the frame gate judges the closing card's own box. If the plate fails under the cards the video re-renders on the flat brand ground. Seedance b-roll is wired (`video/broll.py`) but off until Lital approves the spend (about 89 credits a clip).

**Database (migration 20261012140000, 150000, 153000).** `design_runs.lease_token`: set on lease, required by `design_runs_extend`, `design_runs_finish` and by `design-store` on `extend`, `finish`, `write_options`, `upload` (the worker's `BridgeStore` keeps the token per run). An insert trigger resets the worker's columns to server defaults (budget 45 credits), caps the copy, refuses a second queued/running run for the same post and format, and caps a client at 60 runs a day. `UPDATE` on `design_options` and `design_rules` is revoked for signed-in users (`design-pick` writes as the service role). `design_runs_status()` carries `needs_staff`.

**Workers.** There is no graceful stop: to roll code, start a new worker (`nohup uv run python scripts/worker.py --poll 10 > work/_worker<N>.log 2>&1 &`) and kill an old one only when its last log lines are nothing but store polls. Identify a process by the log it holds open (`lsof -p <pid> | grep _worker`), never by pid order: on 12 October the busy worker was killed instead of the idle one and its carousel run restarted from the plan when the lease lapsed. Runs can be queued by hand with an insert into `design_runs` (the trigger fills the rest); formats `Single Image`, `Carousel`, `Video`.
