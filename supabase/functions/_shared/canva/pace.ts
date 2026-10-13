// supabase/functions/_shared/canva/pace.ts
//
// Keeping Canva calls inside Canva's published rate limits, so edits can run
// side by side. Canva documents per-minute limits per tool and no limit on
// open editing sessions (canva.dev/docs/mcp/tools, 13 Oct 2026):
//   start-editing-transaction 20/min, perform-editing-operations 50/min,
//   commit-editing-transaction 20/min, cancel-editing-transaction 20/min,
//   export-design 20/min.
// Its usage policy asks for bounded exponential backoff on 429. The worker used
// to run every edit one at a time on the belief that Canva allowed one session
// per account; that came from a night when sessions were also never closed.
// Free of Deno and network imports so it can be tested.

/** Calls allowed per minute, at 75% of Canva's published limit for headroom across worker passes. */
export const CANVA_PACE: Record<string, number> = {
  "start-editing-transaction": 15,
  "perform-editing-operations": 37,
  "commit-editing-transaction": 15,
  "cancel-editing-transaction": 15,
};

/** A sliding one-minute window per key: how long until the next call may go. */
export class Pace {
  private calls = new Map<string, number[]>();
  constructor(private limits: Record<string, number>, private windowMs = 60_000, private now: () => number = () => Date.now()) {}

  /** Record a call and return 0, or return how many ms to wait before trying again (nothing recorded). */
  tryTake(key: string): number {
    const limit = this.limits[key];
    if (!limit) return 0;
    const t = this.now();
    const recent = (this.calls.get(key) ?? []).filter((at) => t - at < this.windowMs);
    if (recent.length < limit) {
      recent.push(t);
      this.calls.set(key, recent);
      return 0;
    }
    this.calls.set(key, recent);
    return this.windowMs - (t - recent[0]) + 25;
  }
}

/** Canva is at its rate limit: the step waits for a later pass instead of failing. */
export class CanvaBusy extends Error {
  /** why: "at its rate limit for" (a 429), or "unavailable for" (server errors that outlasted the resends). */
  constructor(public waitMs: number, what: string, why = "at its rate limit for") {
    super(`Canva is ${why} ${what}; trying again in ${Math.ceil(waitMs / 1000)}s.`);
    this.name = "CanvaBusy";
  }
}

/** How long to wait before resending after a 429: Canva's Retry-After when given, else exponential (1s, 2s, 4s…). */
export function backoffMs(retryAfter: string | null, attempt: number): number {
  const s = Number(retryAfter);
  if (retryAfter && Number.isFinite(s) && s >= 0) return Math.min(60_000, s * 1000);
  return Math.min(30_000, 1000 * 2 ** attempt);
}

/**
 * The pace kept in the database (claim_rate_slot), shared by every worker
 * request: each design job advances in its own request, so an in-memory count
 * would only see its own calls. A database error lets the call go; Canva's own
 * 429 and the backoff still hold the line.
 */
// deno-lint-ignore no-explicit-any
export function databasePace(admin: any, account = "canva"): (tool: string) => Promise<number> {
  return async (tool) => {
    const limit = CANVA_PACE[tool];
    if (!limit) return 0;
    const { data, error } = await admin.rpc("claim_rate_slot", { p_key: `${account}:${tool}`, p_limit: limit });
    if (error) return 0;
    return Number(data) || 0;
  };
}
