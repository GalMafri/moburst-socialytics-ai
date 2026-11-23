# Socialytics API: start here

Base URL: `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/`
Authenticate with `Authorization: Bearer <key>`. Keys are made on the API page in the app (account menu > API > Tokens, `/api-access?tab=tokens`): Moburst staff make their own (read only or read and write, all their companies or some, up to 90 days); admins also make tool keys there, with any scope (`costs` for the moburst.ai portal), or with `POST /v1/admin/keys`. The same page's Docs tab has the base URL, the interactive reference and the OpenAPI download.

| Document | What it is | Kept current by |
|---|---|---|
| [REFERENCE.md](REFERENCE.md) | Every route, parameter, scope and schema | Generated from the code (`npm run api:gen`); a test fails when it is stale |
| [CHANGES.md](CHANGES.md) | Every change to the API, dated | Generated with the reference |
| `GET /v1/openapi.json` | The same reference as served by the live API | The deployed code itself |
| `GET /v1/health` | Liveness, and the build of the code that is live | The deployed code itself |
| [CONSUMERS.md](CONSUMERS.md) | Who uses the API, with which scopes | Updated when a key is issued or revoked |
| [SOCIALYTICS-INTEGRATION-GUIDE.md](SOCIALYTICS-INTEGRATION-GUIDE.md) | How the pieces fit together, the demo job end to end | Hand-written; route details defer to REFERENCE.md |
| [SOCIALYTICS-API.md](SOCIALYTICS-API.md) | Earlier hand-written reference | Superseded by REFERENCE.md where they differ |
| [EXTENDING.md](EXTENDING.md) | How to add a route | See also CLAUDE.md at the repo root |

Claude connector (MCP): `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/mcp`. Moburst staff sign in as themselves with OAuth; client users have no API access at all (no API page, no keys, and the connector refuses them); tools and agents (AgentBurst, Mobi) send a Socialytics API key as the bearer instead, and get the tools its scopes allow. The tool list is `api/mcp/socialytics-tools.json`, generated from `supabase/functions/mcp/catalog.ts`. Besides the reads and the staff saves it has `socialytics_api_schema` and `socialytics_api` (any read route, with the caller's reach), work tools that start the actions in two steps (an estimate and a `confirm_token` first, the work only with the token), and `socialytics_cost_summary` (the costs scope). See SOCIALYTICS-API.md, section Claude connector.

## Actions

With the `run` scope a key starts the work people start in the app, for the clients it may see: a social or competitive report, a drafted post, a post's copy written again, a post's design options, a competitor proposal, a competitor feed refresh, a planned calendar week (`POST /v1/clients/{id}/...`, tag Actions in REFERENCE.md). Each takes an optional `idempotency_key`: a retry with the same key returns the first answer instead of starting paid work again. The work runs as the person who made the key, and its paid calls are charged to the client. Drafts are returned, never saved.

## Costs

`GET /v1/costs`, `/v1/cost-events` and `/v1/cost-pricing` (scope `costs`) report what Socialytics's paid providers cost, per client, service and period. The shape is identical in AdVisor and Socialytics. See REFERENCE.md, section Costs.

## Stability

Within `v1`, changes are additive: new routes, optional parameters and response fields can appear at any time, so ignore fields you do not know. A change that would break a working integration needs an entry in `api/BREAKING.md` with its date and replacement before it can ship, and is announced in CHANGES.md.
