# Higgsfield integration

Socialytics generates post images and videos through the Higgsfield REST API
(`api.higgsfield.ai`). This replaced the Gemini 3.1 Flash Image + Veo chain in
September 2026. The prompt builders (`supabase/functions/_shared/design-prompts/`)
are unchanged; only the model provider behind them moved.

There are two separate Higgsfield surfaces. Do not confuse them:

| Surface | Auth | Used by |
| --- | --- | --- |
| REST API `api.higgsfield.ai` | `Authorization: Key <id>:<secret>` | The app's edge functions. Unattended, all clients, all users |
| Hosted MCP `https://mcp.higgsfield.ai/mcp` | Personal Higgsfield account, interactive | Individual team members in Claude Code / Cowork, for ad hoc generation |

## Configuration (Supabase edge secrets)

Set in the Supabase dashboard under Edge Functions → Secrets. Never in
`app_settings` — that table is readable client-side by all staff sessions.

| Secret | Required | Purpose |
| --- | --- | --- |
| `HIGGSFIELD_API_KEY_ID` | yes | REST key id |
| `HIGGSFIELD_API_KEY_SECRET` | yes | REST key secret |
| `HIGGSFIELD_IMAGE_MODEL_PATH` | no | Defaults to `/higgsfield-ai/soul/v2/standard` |
| `HIGGSFIELD_VIDEO_MODEL_PATH` | no | Defaults to `/higgsfield-ai/dop/v2/standard`. Confirm against the models enabled on the account |
| `HIGGSFIELD_VIDEO_PARAMS` | no | JSON object merged into every video submission (duration/quality knobs, which are model-specific) |

Model routes are account-specific on Higgsfield's side. If a generation fails
with a 404-like upstream error, check which endpoints the account has enabled
at cloud.higgsfield.ai and set the two `*_MODEL_PATH` overrides.

## How generation flows

**Images** (`generate-post-image`) stay synchronous from the frontend's point
of view: submit → poll (2s→10s backoff, 120s budget) → download the output →
return a data URL. The request/response contract is identical to the Gemini
version, including the carousel contact-sheet validation and retry.

**Videos** (`generate-post-video`) chain two async jobs (brand-aligned seed
image → image-to-video), so they use a job row:

1. The function submits the video through the hosted MCP tools, which take no
   callback URL, and records a `media_jobs` row. There is no webhook: the
   `higgsfield-webhook` function and its `HIGGSFIELD_WEBHOOK_SECRET` secret
   were removed in November 2026 with the other functions that had no caller.
2. The function returns the row's id while the video renders.
3. The browser asks `media-job-status` until the row is terminal. That function
   collects the finished clip and copies it into the `generated-media` bucket
   (Higgsfield CDN URLs expire after ~7 days).

**Client context** still shapes every generation. Design references and a
PNG/JPG brand book are passed as short-lived signed URLs
(`reference_image_urls`). A **PDF brand book cannot be sent** — Higgsfield
accepts image inputs only — so its influence must come through
`design_style_synthesis` in the prompt. The client lifecycle's weekly design
references step (`_shared/brand-references/learnStyle.ts`) writes that
synthesis from the client's own posts and uploads, so a client with a PDF-only
brand book is covered without anyone running a function by hand.

## Rate limits

Higgsfield limits **concurrency**, not request rate. Hitting the cap returns
HTTP 400 with a "Maximum number of concurrent requests (N)" message, which the
edge functions surface as a clear "at capacity, try again" error (HTTP 429 to
the frontend). The multi-variant UI fires variants in parallel, so with a low
account cap, 3 variants × several users can hit it; the error is retryable.

## Team MCP setup (ad hoc generation in Claude)

For designers/strategists who want Higgsfield directly in Claude Code or
Cowork, add the hosted MCP and sign in with your own Higgsfield account:

```bash
claude mcp add --transport http higgsfield https://mcp.higgsfield.ai/mcp
```

Then run `/mcp` inside Claude Code to complete the browser sign-in. This is
per-person and entirely separate from the app's REST credentials — nothing you
generate through the MCP touches Socialytics data unless you upload it.

## What this account's REST key can actually reach (probed 2026-09-10)

The `higgsfield-probe` function that produced this table was removed in November 2026 (nothing called it). To re-check, send the same empty-body requests from a terminal with the REST key. A 422 means
the route exists and rejected an empty body; 404 means it does not exist;
503 `model_disabled` means it exists but is off for this key.

| Route | Status | Use |
| --- | --- | --- |
| `GET /models` | 200 — 3 items | `higgsfield-ai/soul/cinema`, `higgsfield-ai/soul/v2/standard`, `soul-id`. All text2image |
| `/higgsfield-ai/popcorn/auto` | 422 (needs `prompt`) | **Images.** The design-capable model; produced an on-brand NewDay two-zone post in the first attempt |
| `/higgsfield-ai/dop/standard` | 422 (needs `prompt`, `image_url`) | **Video from a still.** Slugs are `lite`/`standard`/`turbo`, each with a `/first-last-frame` variant — NOT `v2/...` |
| `/v1/image2video/seedance` | 422 (needs `params`) | **Video from a still**, Seedance family |
| `/nano-banana-pro` | 503 `model_disabled` | Disabled for this key |
| `/seedance-2-5`, `/v1/seedance-2-5` | 404 `model_not_found` | Wrong path; use `/v1/image2video/seedance` |

The catalogue at `GET /models` is NOT the whole surface — popcorn and dop
answer 422 while being absent from it. Probe the route; do not trust the list.

### The REST key and the MCP account are not the same entitlement

The hosted MCP (used by the team in Claude Code) reaches the modern
catalogue — `nano_banana_pro`, `seedance_2_5`, `gpt_image_2_5`,
`marketing_studio_image` — and on 2026-09-10 `nano_banana_pro` produced a
Bader Law post that matched their design system exactly, headline spelled
correctly, and `seedance_2_5` animated it for 5 seconds with the lettering
still pixel-stable at the last frame. The app's REST key answers
`model_disabled` for that same model.

So the quality demonstrated through the MCP is not automatically what the app
would ship. Either enable the modern models on the REST key at
cloud.higgsfield.ai, or build against popcorn and dop, which this key does
have.

### Verdict, 2026-09-10: do not wire the app to Higgsfield yet

Both candidates were run against the same brief and the same three Bader Law
design references.

| Model | Reachable by | Result |
| --- | --- | --- |
| `nano_banana_pro` | the team's MCP account only | Bader's system exactly: navy ribbing, red block, black-and-white cutout, headline spelled correctly. A `seedance_2_5` clip from that still keeps the lettering pixel-stable to the last frame |
| `higgsfield-ai/popcorn/auto` | **the app's REST key** | On-brand colours, unusable type: mirrored and garbled ("wogяƚ would inover gfd afer ta aciglent"), and it copied "Happy Mother's Day" out of a reference image |

Popcorn IS entitled on the app's key — it returns 200 and completes, despite
being absent from the cloud dashboard's three-model list, so that list is not
the entitlement. But its typography is the exact failure the current pipeline
already fights, so moving generation onto it would be a regression.

The value is real and it sits behind one model the API account cannot use.
`cloud.higgsfield.ai` is a SEPARATE account from the one the MCP uses:
different wallet (782 credits against 2427) and a different catalogue, with
no per-model controls on the API-keys page. Getting `nano-banana-pro` (and a
seedance image-to-video route) enabled on the API account is a conversation
with Higgsfield, not a setting. Until then the app stays on its current
pipeline.
