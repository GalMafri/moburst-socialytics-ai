// supabase/functions/_shared/video/sandbox.ts
//
// Running a script in an Anthropic-hosted sandbox (Managed Agents), for the
// video join (compose.ts). The app's own key owns an environment with ffmpeg
// and a small agent whose only tool is bash; each join is one session that
// runs one script. Hosted, never on a laptop. Nothing waits here: a session
// is started, and later asked whether it has finished.
//
// The sandbox at its rate limit or briefly down (429, 5xx, 529 overloaded)
// is a wait of the job (ModelBusy, canva/stepError.ts), never a spent try
// (QA 22 Nov 2026, P54-02: three passes of outage after the clip was paid
// for ended the video).
import { anthropicFetch } from "../anthropic.ts";
import type { CostContext } from "../cost/context.ts";
import { ModelBusy } from "../media/modelBusy.ts";
import { ProviderKeyMissing } from "../paid/index.ts";

const BETA = "managed-agents-2026-04-01";
const ENVIRONMENT = "socialytics-video";
const AGENT = "Socialytics video assembly";
const MODEL = "claude-haiku-5-5";
const SUPABASE_HOST = new URL(Deno.env.get("SUPABASE_URL") ?? "https://rwouwxqggjjacbpbhqsn.supabase.co").host;
/** A join costs about a cent; the cap only stops a session that goes wrong. */
const SESSION_CAP_CENTS = "100";

const SYSTEM =
  "You assemble videos for a scheduled job. Every message holds one bash script: everything between the line <script> and the line </script>, without those two tag lines. " +
  "Write it to a file and run it once with bash, exactly as given, allowing up to 900 seconds. Do not edit it, split it or run anything else. " +
  "Then reply with only the last line it printed. If it fails, reply FAILED: followed by the last lines of its output.";

const HEADERS = { "Content-Type": "application/json", "anthropic-beta": BETA };

/** One call of the Managed Agents API, through the paying desk (which adds the key and records any usage it reports). */
async function call<T = any>(cost: CostContext, method: string, path: string, body?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await anthropicFetch(cost, path, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    // No key is the plain error it always was: the job tries again.
    if (e instanceof ProviderKeyMissing) throw new Error("ANTHROPIC_API_KEY is not set.");
    throw e;
  }
  const text = await resp.text();
  if (!resp.ok) {
    const message = `Hosted sandbox ${method} ${path.split("?")[0]} ${resp.status}: ${text.slice(0, 300)}`;
    throw resp.status === 429 || resp.status >= 500 ? new ModelBusy(message) : new Error(message);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function findByName(cost: CostContext, path: string, name: string): Promise<any | null> {
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res: any = await call(cost, "GET", `${path}?limit=100${after ? `&after_id=${after}` : ""}`);
    const hit = (res.data ?? []).find((x: any) => x.name === name && !x.archived_at);
    if (hit) return hit;
    if (!res.has_more || !res.last_id) return null;
    after = res.last_id;
  }
  return null;
}

let runtime: { environmentId: string; agentId: string } | null = null;

/** The environment and agent, created on first use under the app's own key. */
export async function ensureRuntime(cost: CostContext): Promise<{ environmentId: string; agentId: string }> {
  if (runtime) return runtime;
  let env = await findByName(cost, "/v1/environments", ENVIRONMENT);
  if (!env) {
    env = await call(cost, "POST", "/v1/environments", {
      name: ENVIRONMENT,
      description: "Socialytics video posts: joins cover, footage and end card with ffmpeg",
      config: {
        type: "cloud",
        // Inputs and the result only move between this sandbox and the app's storage.
        networking: { type: "limited", allow_package_managers: true, allowed_hosts: [SUPABASE_HOST] },
        packages: { type: "packages", apt: ["ffmpeg"] },
      },
    });
  }
  let agent = await findByName(cost, "/v1/agents", AGENT);
  if (!agent) {
    agent = await call(cost, "POST", "/v1/agents", {
      name: AGENT,
      model: MODEL,
      system: SYSTEM,
      tools: [{
        type: "agent_toolset_20260401",
        default_config: { enabled: false, permission_policy: { type: "always_allow" } },
        configs: [{ name: "bash", enabled: true }, { name: "write", enabled: true }],
      }],
      metadata: { app: "socialytics" },
    });
  }
  runtime = { environmentId: env.id, agentId: agent.id };
  return runtime;
}

/**
 * Start one session that runs the script. Returns the session id. `cost` is
 * who the session is for (the video job's client and step); the environment
 * and agent made on first use go under the same context and cost nothing.
 */
export async function startScript(cost: CostContext, script: string, title: string): Promise<string> {
  const { environmentId, agentId } = await ensureRuntime(cost);
  const session: any = await call(cost, "POST", "/v1/sessions", {
    agent: { type: "agent", id: agentId },
    environment_id: environmentId,
    title,
    budget: { type: "limit", max_list_cost: { amount: SESSION_CAP_CENTS, currency: "USD" } },
  });
  await call(cost, "POST", `/v1/sessions/${session.id}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text: `<script>\n${script}\n</script>` }] }],
  });
  return session.id;
}

export type ScriptState = { state: "running" } | { state: "finished"; reply: string } | { state: "failed"; reason: string };

/** Whether the session has finished, and what it replied. */
export async function checkScript(cost: CostContext, sessionId: string): Promise<ScriptState> {
  const session: any = await call(cost, "GET", `/v1/sessions/${sessionId}`);
  if (session.status === "running" || session.status === "rescheduling") return { state: "running" };
  const events: any = await call(cost, "GET", `/v1/sessions/${sessionId}/events?limit=200`);
  const replies = (events.data ?? []).filter((e: any) => e.type === "agent.message")
    .map((e: any) => (e.content ?? []).map((c: any) => c.text ?? "").join(" ").trim()).filter(Boolean);
  // A session that has not answered yet is still starting its container,
  // unless its turn has ended: then no answer is coming (QA 22 Nov 2026,
  // P53-04: one that ended its turn without a word was read as running on
  // every check, and the join waited on it until the request's limit).
  if (session.status === "idle" && !replies.length) {
    const stop = session.stop_reason?.type;
    if (stop === "end_turn") return { state: "failed", reason: "The sandbox ended its turn without an answer." };
    if (stop) return { state: "failed", reason: `The sandbox stopped: ${stop}` };
    return { state: "running" };
  }
  const reply = replies[replies.length - 1] ?? "";
  if (session.status === "terminated" && !reply) return { state: "failed", reason: "The sandbox ended without an answer." };
  return { state: "finished", reply };
}

/** Sessions are not kept once read. */
export async function endScript(cost: CostContext, sessionId: string): Promise<void> {
  await call(cost, "DELETE", `/v1/sessions/${sessionId}`).catch(() => undefined);
}
