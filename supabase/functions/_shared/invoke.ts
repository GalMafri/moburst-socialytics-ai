/**
 * One function calling another in this project as the project itself: the
 * operational secret (the same one the crons send) plus the user the call
 * acts for, which requireStaff accepts as a server caller. The service role
 * is the bearer so functions that only check for a bearer are satisfied too.
 * The result carries the status and body so a caller can record why a call
 * failed instead of losing the reason.
 */
import { SERVER_SECRET_HEADER, SERVER_USER_HEADER } from "./auth/authz.ts";

export interface CallResult {
  ok: boolean;
  status: number;
  data: unknown | null;
  text: string;
}

export interface CallEnv {
  url: string;
  serviceKey: string;
  /** SOCIALYTICS_N8N_SECRET; sent as the server header and as X-Cron-Secret. */
  secret: string | null;
  /** The user the call acts for (created_by on what the call writes). */
  actAs: string | null;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  extraHeaders?: Record<string, string>;
}

export async function callFunction(name: string, body: unknown, env: CallEnv): Promise<CallResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.serviceKey}`,
    apikey: env.serviceKey,
  };
  if (env.secret) {
    headers[SERVER_SECRET_HEADER] = env.secret;
    headers["X-Cron-Secret"] = env.secret;
  }
  if (env.actAs) headers[SERVER_USER_HEADER] = env.actAs;
  Object.assign(headers, env.extraHeaders ?? {});
  const doFetch = env.fetchImpl ?? ((u: string, i: RequestInit) => fetch(u, i));
  try {
    const res = await doFetch(`${env.url}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let data: unknown | null = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { ok: res.ok, status: res.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: e instanceof Error ? e.message : String(e) };
  }
}

/** The environment every edge function has. The acted-for user is chosen per call. */
export function callEnvFromDeno(actAs: string | null = null): CallEnv {
  const d = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return {
    url: d?.env.get("SUPABASE_URL") ?? "",
    serviceKey: d?.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    secret: d?.env.get("SOCIALYTICS_N8N_SECRET") ?? null,
    actAs,
  };
}
