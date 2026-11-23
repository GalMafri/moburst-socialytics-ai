# Socialytics API: start here

Base URL: `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api/v1/`
Authenticate with `Authorization: Bearer <key>` (keys are created in Socialytics Settings > API access, or with `POST /v1/admin/keys`).

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

Claude connector (MCP): `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/mcp`, signed in per person with OAuth (Moburst staff and client users). See SOCIALYTICS-API.md, section Claude connector.

## Costs

`GET /v1/costs`, `/v1/cost-events` and `/v1/cost-pricing` (scope `costs`) report what Socialytics's paid providers cost, per client, service and period. The shape is identical in AdVisor and Socialytics. See REFERENCE.md, section Costs.

## Stability

Within `v1`, changes are additive: new routes, optional parameters and response fields can appear at any time, so ignore fields you do not know. A change that would break a working integration needs an entry in `api/BREAKING.md` with its date and replacement before it can ship, and is announced in CHANGES.md.
