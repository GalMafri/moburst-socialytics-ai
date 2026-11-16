// server/src/index.ts
//
// The Vercel function's app: esbuild bundles this file into dist/app.mjs, and
// the committed entry api/picture.mjs at the repository root re-exports it.
// The root vercel.json rewrites /api/health and /api/picture/* to that
// entry, so those calls reach one Hono app, which routes by the original
// path. The app has no environment variable: a call is checked against the
// product's database (call.ts).

import { createApp } from "./app.ts";
import { databaseClaim } from "./call.ts";
import { stdoutLog } from "./log.ts";

const app = createApp({ claimCall: databaseClaim(), log: stdoutLog });

export default { fetch: (request: Request) => app.fetch(request) };
