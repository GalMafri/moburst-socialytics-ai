/**
 * The gOS usage push: turns this tool's public.gos_events rows into the usage
 * events of the gOS Auth / API Integration Guide (§15) and sends them to
 * POST {AUTH_SERVICE_URL}/usage/events, from the background only.
 *
 * Contract followed (guide §4 and §15):
 *   - header X-Tool-Token (MOBTOOLS_TOOL_TOKEN), an explicit User-Agent, JSON;
 *   - a batch of 1 to 500 events; the answer is 202 {accepted, duplicates,
 *     rejected, tool_id} even when part of the batch is bad, so `rejected` is
 *     logged and kept;
 *   - event_id (8 to 64 characters) is the idempotency key: it is derived from
 *     the source row (tool, event, execution), so a resend is a no-op;
 *   - the tool never sends tool_open (the Auth Service records it at handoff);
 *   - 401 or 403 means the token is bad: no retry with the same token.
 *
 * What was sent is kept in public.gos_usage_outbox; the database function
 * gos_usage_pending() returns only rows that are not there yet, so nothing is
 * sent twice on purpose and nothing is skipped: an event is recorded only after
 * the Auth Service answered for its batch. When the service is down, nothing is
 * recorded and the next run sends the same events again.
 *
 * Pure apart from the deps passed in, so Vitest runs it without Deno. AdVisor
 * (_shared/gos-usage.ts) and Socialytics (gos-usage-push/usage.ts) hold the same
 * text; the tool-specific parts (which rows are ready, which clients are left
 * out, output kinds) come in through UsageConfig and the database function.
 */

export type GosEventName = "execution_start" | "execution_complete" | "output_delivered";
export type ActorKind = "user" | "schedule" | "system" | "api";
export type CompleteStatus = "success" | "failed" | "cancelled" | "partial";

/** One row of gos_usage_pending(): a gos_events row plus how it was started. */
export interface SourceRow {
  occurred_at: string;
  /** The view's event name: execution-start | execution-complete | output-delivered. */
  event: string;
  execution_id: string;
  user_email: string | null;
  company_slug: string | null;
  duration_ms: number | null;
  ok: boolean | null;
  props: Record<string, unknown> | null;
  /** The execution was started by a machine through the API (a demo job). */
  via_api?: boolean | null;
  /** The execution was started by a schedule. Null when the tool cannot tell. */
  via_schedule?: boolean | null;
}

export interface UsageEvent {
  event_id: string;
  event_name: GosEventName;
  occurred_at: string;
  execution_id: string;
  execution_kind?: string;
  company_slug?: string;
  user_email?: string;
  actor_kind: ActorKind;
  status?: CompleteStatus;
  duration_ms?: number;
  output_kind?: string;
  output_ref?: string;
  quantity?: number;
  attrs?: Record<string, unknown>;
}

export interface UsageConfig {
  /** The tool's gOS slug (TOOL_ID), e.g. "advisor". Prefixes every event_id. */
  tool: string;
  /** output_kind per execution kind (props.kind); defaults to the kind itself. */
  outputKinds?: Record<string, string>;
  /** props key holding the number of units delivered, per execution kind. */
  quantityKeys?: Record<string, string>;
  /** Actor when no person and no API caller started the work and via_schedule is unknown. */
  defaultMachineActor?: ActorKind;
  /** props keys never sent in attrs (internal error text and the like). */
  dropAttrs?: string[];
}

export const MAX_BATCH = 500;

const VIEW_TO_GOS: Record<string, GosEventName> = {
  "execution-start": "execution_start",
  "execution-complete": "execution_complete",
  "output-delivered": "output_delivered",
};
const SHORT: Record<GosEventName, string> = {
  execution_start: "start",
  execution_complete: "complete",
  output_delivered: "output",
};

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The idempotency key of one event: `<tool>-<start|complete|output>-<execution id>`.
 * The view has at most one row per (event, execution), so this is unique and
 * the same on every run. An execution id that would make it longer than 64
 * characters (or odd characters) is replaced by the first 40 hex of its SHA-256.
 */
export async function eventIdFor(tool: string, name: GosEventName, executionId: string): Promise<string> {
  const plain = `${tool}-${SHORT[name]}-${executionId}`;
  if (plain.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(plain)) return plain;
  return `${tool}-${SHORT[name]}-${(await sha256Hex(executionId)).slice(0, 40)}`;
}

function actorOf(row: SourceRow, cfg: UsageConfig): ActorKind {
  if (row.user_email) return "user";
  if (row.via_api) return "api";
  if (row.via_schedule === true) return "schedule";
  if (row.via_schedule === false) return "system";
  return cfg.defaultMachineActor ?? "system";
}

function statusOf(row: SourceRow): CompleteStatus {
  if (row.ok === true) return "success";
  const s = String(row.props?.status ?? "").toLowerCase();
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "partial") return "partial";
  return "failed";
}

/**
 * One gos_events row as a §15 event, or null when the row is not one the tool
 * sends (tool-open, an unknown event, a row without an execution).
 */
export async function toUsageEvent(row: SourceRow, cfg: UsageConfig): Promise<UsageEvent | null> {
  const name = VIEW_TO_GOS[row.event];
  if (!name || !row.execution_id) return null;
  const at = new Date(row.occurred_at);
  if (Number.isNaN(at.getTime())) return null;
  const executionId = String(row.execution_id);
  const kind = typeof row.props?.kind === "string" ? (row.props.kind as string) : undefined;
  const ev: UsageEvent = {
    event_id: await eventIdFor(cfg.tool, name, executionId),
    event_name: name,
    occurred_at: at.toISOString(),
    execution_id: executionId,
    actor_kind: actorOf(row, cfg),
  };
  if (kind) ev.execution_kind = kind;
  // The guide: omit the client key rather than guess.
  if (row.company_slug) ev.company_slug = row.company_slug;
  if (row.user_email) ev.user_email = row.user_email;
  if (name === "execution_complete") {
    ev.status = statusOf(row);
    if (typeof row.duration_ms === "number" && Number.isFinite(row.duration_ms) && row.duration_ms >= 0) {
      ev.duration_ms = Math.round(row.duration_ms);
    }
  }
  if (name === "output_delivered") {
    ev.output_kind = (kind && cfg.outputKinds?.[kind]) || kind || "output";
    ev.output_ref = executionId;
    const qKey = kind ? cfg.quantityKeys?.[kind] : undefined;
    const q = qKey ? Number(row.props?.[qKey]) : NaN;
    if (Number.isFinite(q) && q > 0) ev.quantity = q;
  }
  const drop = new Set(["kind", ...(cfg.dropAttrs ?? [])]);
  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row.props ?? {})) if (!drop.has(k) && v !== null && v !== undefined) attrs[k] = v;
  if (Object.keys(attrs).length) ev.attrs = attrs;
  return ev;
}

/** Splits events into batches of at most `size` (1 to 500), in order. */
export function toBatches<T>(items: T[], size = MAX_BATCH): T[][] {
  const n = Math.max(1, Math.min(MAX_BATCH, Math.floor(size)));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** A row of public.gos_usage_outbox. */
export interface OutboxRow {
  event_id: string;
  source_event: string;
  execution_id: string;
  event_name: GosEventName;
  occurred_at: string;
  company_slug: string | null;
  status: "sent" | "duplicate" | "rejected";
  reject_reason: string | null;
  payload: UsageEvent;
  sent_at: string;
}

/** public.gos_usage_push_state, one row. */
export interface PushState {
  blocked_token_fp: string | null;
  blocked_reason: string | null;
  blocked_at: string | null;
  last_run_at?: string | null;
  last_result?: unknown;
}

export interface PushDeps {
  cfg: UsageConfig;
  /** MOBTOOLS_TOOL_TOKEN. Empty means "not configured yet": nothing is sent. */
  token: string | null | undefined;
  authServiceUrl: string;
  userAgent: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** gos_usage_pending(since, limit): rows not yet in the outbox, oldest first. */
  loadPending(sinceIso: string, limit: number): Promise<SourceRow[]>;
  record(rows: OutboxRow[]): Promise<void>;
  readState(): Promise<PushState | null>;
  writeState(patch: Partial<PushState> & { last_run_at: string; last_result: unknown }): Promise<void>;
  now(): Date;
  log(line: Record<string, unknown>): void;
}

export interface PushOptions {
  /** ISO time: rows that occurred at or after it are considered. */
  since: string;
  dryRun?: boolean;
  /** Send even though this token was refused before (after fixing it in gOS). */
  force?: boolean;
  /** Rows read per page (default 2000). */
  pageSize?: number;
  batchSize?: number;
  /** Pages per run (default 10), so one run stays short. */
  maxPages?: number;
  timeoutMs?: number;
}

export type PushStatus = "sent" | "nothing_to_send" | "deferred" | "blocked" | "not_configured" | "dry_run" | "more_pending";

export interface PushResult {
  status: PushStatus;
  since: string;
  read: number;
  posted: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  batches: number;
  skipped: number;
  reason?: string;
  sample?: UsageEvent[];
}

export async function tokenFingerprint(token: string): Promise<string> {
  return (await sha256Hex(token)).slice(0, 12);
}

interface Answer {
  accepted: number;
  duplicates: number;
  rejected: Map<string, string>;
  unmatched: unknown[];
}

/** Reads a 202 body. `rejected` items may be event ids, or objects naming the event (or its index) and why. */
export function readAnswer(body: unknown, batch: UsageEvent[]): Answer {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rejected = new Map<string, string>();
  const unmatched: unknown[] = [];
  for (const item of Array.isArray(b.rejected) ? b.rejected : []) {
    if (typeof item === "string") {
      if (batch.some((e) => e.event_id === item)) rejected.set(item, "rejected");
      else unmatched.push(item);
      continue;
    }
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = typeof o.event_id === "string"
      ? o.event_id
      : typeof o.index === "number" && batch[o.index] ? batch[o.index].event_id : null;
    const why = [o.detail, o.reason, o.error, o.message].find((v) => typeof v === "string") as string | undefined;
    if (id && batch.some((e) => e.event_id === id)) rejected.set(id, why ?? JSON.stringify(o));
    else unmatched.push(item);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { accepted: num(b.accepted), duplicates: num(b.duplicates), rejected, unmatched };
}

type PostOutcome =
  | { kind: "ok"; answer: Answer }
  | { kind: "bad_token"; status: number; detail: string }
  | { kind: "down"; detail: string };

async function post(deps: PushDeps, batch: UsageEvent[], timeoutMs: number): Promise<PostOutcome> {
  let res: Response;
  try {
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
    res = await deps.fetch(`${deps.authServiceUrl}/usage/events`, {
      method: "POST",
      headers: {
        "X-Tool-Token": String(deps.token),
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": deps.userAgent,
      },
      body: JSON.stringify({ events: batch }),
      signal,
    });
  } catch (e) {
    return { kind: "down", detail: `network: ${e instanceof Error ? e.message : String(e)}` };
  }
  let text = "";
  try { text = await res.text(); } catch { /* empty body */ }
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const detail = (body && typeof body === "object" && typeof (body as { detail?: unknown }).detail === "string")
    ? (body as { detail: string }).detail
    : text.slice(0, 300);
  if (res.status === 401 || res.status === 403) return { kind: "bad_token", status: res.status, detail };
  if (res.status === 200 || res.status === 202) return { kind: "ok", answer: readAnswer(body, batch) };
  return { kind: "down", detail: `HTTP ${res.status}: ${detail}` };
}

/**
 * One run: read what is pending, send it in batches, record each answered
 * batch. Stops at the first batch the Auth Service does not answer; what was
 * not recorded is sent again by the next run.
 */
export async function pushUsage(deps: PushDeps, opts: PushOptions): Promise<PushResult> {
  const result: PushResult = { status: "nothing_to_send", since: opts.since, read: 0, posted: 0, accepted: 0, duplicates: 0, rejected: 0, batches: 0, skipped: 0 };
  const finish = async (r: PushResult, patch: Partial<PushState> = {}) => {
    deps.log({ event: "GOS_USAGE_PUSH", ...r, sample: undefined });
    if (!opts.dryRun) {
      try {
        await deps.writeState({ ...patch, last_run_at: deps.now().toISOString(), last_result: { ...r, sample: undefined } });
      } catch (e) {
        deps.log({ event: "GOS_USAGE_PUSH_STATE_FAILED", message: e instanceof Error ? e.message : String(e) });
      }
    }
    return r;
  };

  const token = (deps.token ?? "").trim();
  if (!token) return finish({ ...result, status: "not_configured", reason: "MOBTOOLS_TOOL_TOKEN is not set" });

  const fp = await tokenFingerprint(token);
  if (!opts.force && !opts.dryRun) {
    const state = await deps.readState();
    if (state?.blocked_token_fp && state.blocked_token_fp === fp) {
      return finish({ ...result, status: "blocked", reason: `the Auth Service refused this token on ${state.blocked_at}: ${state.blocked_reason}. Replace MOBTOOLS_TOOL_TOKEN, or call with ?force=1 once it is fixed in gOS.` });
    }
  }

  const pageSize = opts.pageSize ?? 2000;
  const maxPages = opts.maxPages ?? 10;
  const timeoutMs = opts.timeoutMs ?? 20000;

  for (let page = 0; page < maxPages; page++) {
    const rows = await deps.loadPending(opts.since, pageSize);
    result.read += rows.length;
    const ready: Array<{ row: SourceRow; ev: UsageEvent }> = [];
    for (const row of rows) {
      const ev = await toUsageEvent(row, deps.cfg);
      if (ev) ready.push({ row, ev });
      else result.skipped++;
    }
    if (opts.dryRun) {
      return finish({ ...result, status: "dry_run", posted: ready.length, batches: toBatches(ready).length, sample: ready.slice(0, 5).map((r) => r.ev) });
    }
    if (!ready.length) break;

    for (const batch of toBatches(ready, opts.batchSize ?? MAX_BATCH)) {
      const events = batch.map((b) => b.ev);
      const out = await post(deps, events, timeoutMs);
      if (out.kind === "down") {
        deps.log({ event: "GOS_USAGE_PUSH_DEFERRED", detail: out.detail, pending_in_batch: events.length });
        return finish({ ...result, status: "deferred", reason: `Auth Service unreachable or failing (${out.detail}); the next run sends these again` });
      }
      if (out.kind === "bad_token") {
        deps.log({ event: "GOS_USAGE_PUSH_TOKEN_REFUSED", status: out.status, detail: out.detail });
        return finish(
          { ...result, status: "blocked", reason: `HTTP ${out.status}: ${out.detail}` },
          { blocked_token_fp: fp, blocked_reason: `HTTP ${out.status}: ${out.detail}`.slice(0, 500), blocked_at: deps.now().toISOString() },
        );
      }
      const { answer } = out;
      if (answer.unmatched.length) deps.log({ event: "GOS_USAGE_PUSH_REJECTED_UNMATCHED", items: answer.unmatched.slice(0, 20) });
      if (answer.rejected.size) {
        deps.log({ event: "GOS_USAGE_PUSH_REJECTED", rejected: [...answer.rejected].slice(0, 50).map(([id, why]) => ({ event_id: id, why })) });
      }
      const sentAt = deps.now().toISOString();
      // The answer gives counts only, so every event that was not rejected is marked sent.
      const recorded: OutboxRow[] = batch.map(({ row, ev }) => ({
        event_id: ev.event_id,
        source_event: row.event,
        execution_id: ev.execution_id,
        event_name: ev.event_name,
        occurred_at: ev.occurred_at,
        company_slug: ev.company_slug ?? null,
        status: answer.rejected.has(ev.event_id) ? "rejected" : "sent",
        reject_reason: answer.rejected.get(ev.event_id) ?? null,
        payload: ev,
        sent_at: sentAt,
      }));
      result.batches++;
      result.posted += events.length;
      result.accepted += answer.accepted;
      result.duplicates += answer.duplicates;
      result.rejected += answer.rejected.size;
      try {
        await deps.record(recorded);
      } catch (e) {
        // Sent but not recorded: the next run sends them again and the Auth
        // Service counts them as duplicates (same event_id). Stop here.
        const message = e instanceof Error ? e.message : String(e);
        deps.log({ event: "GOS_USAGE_PUSH_RECORD_FAILED", message, events: events.length });
        return finish({ ...result, status: "deferred", reason: `sent, but recording failed (${message}); the next run resends them as duplicates` });
      }
    }
    if (rows.length < pageSize) {
      return finish({ ...result, status: "sent" }, { blocked_token_fp: null, blocked_reason: null, blocked_at: null });
    }
    if (page === maxPages - 1) {
      return finish({ ...result, status: "more_pending", reason: `stopped after ${maxPages} pages; the next run continues` }, { blocked_token_fp: null, blocked_reason: null, blocked_at: null });
    }
  }
  return finish(result.posted ? { ...result, status: "sent" } : result);
}
