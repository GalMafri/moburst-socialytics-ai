// server/src/app.ts
//
// The door of the picture service: GET /api/health answers anyone and says
// only the service's name; every other /api/* call must carry, in the
// x-socialytics-call header, the id of a call the worker opened in the
// database, and the service claims that id before it reads the request
// (call.ts, 16 Nov 2026). No id, or one that is not a UUID, answers 401
// without a database call; an id the database does not claim (unknown,
// already claimed, opened more than 120 seconds ago) answers 401 and leaves
// one log line, so a job that was refused can be traced; a database that
// does not answer gives 503, which the worker waits out without spending a
// try. Anything unknown answers JSON, never a bare page. The picture routes
// are mounted behind the door, and they read and write only in the product's
// own storage (storage.ts), so a claimed call still cannot send the service
// anywhere else.
// Built as a function of its dependencies so tests run it without a server.

import { Hono } from "hono";
import { PICTURE_API_BASE, PICTURE_CALL_HEADER } from "../../supabase/functions/_shared/picture/contract.ts";
import { isCallId, type ClaimCall } from "./call.ts";
import { stdoutLog, type Log } from "./log.ts";
import { pictureRoutes } from "./picture/routes.ts";
import { PRODUCT_STORAGE, STORAGE_TIMEOUT_MS } from "./storage.ts";

export type AppDeps = {
  claimCall: ClaimCall;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: Log;
  /** The one address the service reads from and writes to. The product's own storage unless a test gives its own. */
  storage?: string;
  /** How long one call's reads and writes may take together, counted only while storage is read or written. */
  storageTimeoutMs?: number;
  /** This machine's own clock in milliseconds: what a call's working time is measured on. */
  clock?: () => number;
  /** The version of the search's steps a point's mark carries: the search's own (SEARCH_STEPS_VERSION) unless a test gives another. */
  searchVersion?: number;
};

const NOT_ALLOWED = "Not allowed.";
const NOT_CLAIMED = "The database did not claim the call.";
const NOT_CHECKED = "The picture service could not check the call with the database.";

export function createApp(deps: AppDeps): Hono {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const log = deps.log ?? stdoutLog;
  const now = deps.now ?? Date.now;

  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true, service: "socialytics-server" }));

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    const id = c.req.header(PICTURE_CALL_HEADER);
    if (!isCallId(id)) return c.json({ ok: false, reason: NOT_ALLOWED }, 401);
    let claimed: boolean;
    try {
      claimed = await deps.claimCall(id);
    } catch (err) {
      // The line names the path and the failure, never the id.
      log({ at: new Date(now()).toISOString(), route: c.req.path, ok: false, reason: NOT_CHECKED, error: err instanceof Error ? err.message : String(err) });
      return c.json({ ok: false, reason: NOT_CHECKED }, 503);
    }
    if (!claimed) {
      // The caller hears only "Not allowed."; the log says which refusal it was, and never the id.
      log({ at: new Date(now()).toISOString(), route: c.req.path, ok: false, reason: NOT_CLAIMED });
      return c.json({ ok: false, reason: NOT_ALLOWED }, 401);
    }
    return next();
  });

  app.route(PICTURE_API_BASE, pictureRoutes({ fetchImpl, log, now, storage: deps.storage ?? PRODUCT_STORAGE, storageTimeoutMs: deps.storageTimeoutMs ?? STORAGE_TIMEOUT_MS, clock: deps.clock ?? (() => performance.now()), searchVersion: deps.searchVersion }));

  app.notFound((c) => c.json({ ok: false, reason: "Unknown route." }, 404));

  return app;
}
