// Makes one long Claude call for an in-app pipeline step, beside the step
// (_shared/pipelines/claude.ts claudeBatchStep, claudeDirect.ts): answers 202
// at once and makes the call as a background task, which runs after the
// answer up to the runtime's wall clock. What came of the call goes to the
// run's payload store: the answer, or why there is none. The step reads it
// the next time it looks; until then its message batch stands beside it.
//
// POST {"run_id","save_as","body","start"[,"keep_days"]} with the operational
// secret (X-Socialytics-Secret). Only for a pipeline run that is running.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { CLAUDE_DIRECT_DEADLINE_MS, directFailedKey, runClaudeDirect, type DirectFailure } from "../_shared/pipelines/claudeDirect.ts";
import { makePayloadStore } from "../_shared/pipelines/store.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SAVE_AS = /^[a-z0-9][a-z0-9_.-]{0,100}$/i;

// Calls still under way when the runtime shuts this worker down are kept as
// failures, so the step asks for the call once more rather than waiting.
const underWay = new Set<{ put: (failure: DirectFailure) => Promise<unknown>; t0: number; start: number }>();
addEventListener("beforeunload", (ev) => {
  const reason = (ev as Event & { detail?: { reason?: string } }).detail?.reason ?? "shutdown";
  for (const w of underWay) void w.put({ message: `cut off by the runtime (${reason})`, seconds: Math.round((Date.now() - w.t0) / 1000), start: w.start }).catch(() => undefined);
});

Deno.serve(async (req) => {
  if (!(await secretEquals(req.headers.get("X-Socialytics-Secret"), Deno.env.get("SOCIALYTICS_N8N_SECRET")))) return json({ error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  // deno-lint-ignore no-explicit-any
  const a = await req.json().catch(() => null) as any;
  const runId = typeof a?.run_id === "string" ? a.run_id : "";
  const saveAs = typeof a?.save_as === "string" && SAVE_AS.test(a.save_as) ? a.save_as : "";
  const start = Number(a?.start);
  const body = a?.body && typeof a.body === "object" && !Array.isArray(a.body) ? a.body as Record<string, unknown> : null;
  if (!runId || !saveAs || !body || !Number.isInteger(start) || start < 1 || start > 5) return json({ error: "run_id, save_as, body and start are required" }, 400);
  if (typeof body.model !== "string" || !Array.isArray(body.messages)) return json({ error: "body is not a Messages API request" }, 400);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: run, error } = await db.from("report_pipeline_runs").select("id, status").eq("id", runId).maybeSingle();
  if (error) return json({ error: "the run could not be read" }, 503);
  if (!run || run.status !== "running") return json({ error: "no running pipeline run has that id" }, 409);

  const store = makePayloadStore(db, runId);
  const keepDays = Number(a?.keep_days) > 0 ? Number(a.keep_days) : undefined;
  const w = { put: (f: DirectFailure) => store.put(directFailedKey(saveAs), f), t0: Date.now(), start };
  underWay.add(w);
  const work = runClaudeDirect(store, { apiKey, body, saveAs, start, keepDays, deadlineMs: CLAUDE_DIRECT_DEADLINE_MS }).finally(() => underWay.delete(w));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;
  return json({ accepted: true, run_id: runId, save_as: saveAs, start }, 202);
});
