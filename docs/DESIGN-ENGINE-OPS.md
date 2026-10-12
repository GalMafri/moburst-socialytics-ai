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
