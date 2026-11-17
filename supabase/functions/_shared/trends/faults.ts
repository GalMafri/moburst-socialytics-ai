// What a trend source's failed answer says about why it failed, read from the
// message the run kept for it (source.<platform>.<n>.failed) or from the
// reason a run stopped with.
//
//   request      the source refused what the app sent (400 and the other
//                answers about the request itself: a field it no longer
//                takes, an actor that is gone). Asking again sends the same
//                request, so it changes only when the app or the source does.
//   credentials  the account, or its access to this source, was turned away
//                (401, 402, 403). It changes when the account does.
//   transient    everything else: a run that failed or timed out, a rate
//                limit, a server error, an answer with nothing in it. Asking
//                again later is the cure.
//
// The first two are facts for a person; the last is the app's own to retry.

import { TREND_PLATFORMS, type TrendPlatform } from "./types.ts";

/** The sources a week's row says failed (trend_weeks.platforms). */
export function failedSources(platforms: unknown): TrendPlatform[] {
  const tally = (platforms ?? {}) as Record<string, { status?: unknown } | null | undefined>;
  return TREND_PLATFORMS.filter((p) => tally[p]?.status === "failed");
}

export type SourceFaultKind = "request" | "credentials" | "transient";

export interface SourceFault {
  platform: TrendPlatform;
  kind: SourceFaultKind;
  /** The HTTP status in the answer, when the message carries one. */
  status: number | null;
  /** The source's own words, for operators only: never shown on a screen. */
  message: string;
  /** Set when the source's kept words could not be read for this record: the kind is then not known, and is given as transient. */
  unread?: true;
}

const CREDENTIAL_STATUSES: ReadonlySet<number> = new Set([401, 402, 403]);
/** 408 and 429 ask for another try; every other 4xx is about the request. */
const RETRYABLE_4XX: ReadonlySet<number> = new Set([408, 425, 429]);

const CREDENTIAL_WORDS = /authentication token|token is not valid|invalid[- ]token|token[- ]not[- ]provided|user was not found|user[- ]or[- ]token[- ]not[- ]found|not[- ]enough[- ]usage|waited for [A-Z_]*TOKEN/i;
const REQUEST_WORDS = /invalid[- ]input|must be equal to one of the allowed values|input\.[A-Za-z0-9_.]+ (is required|must|should)|actor (was )?not found|record[- ]not[- ]found/i;

/** The kind of fault a failure message describes, and the HTTP status it names, if any. */
export function sourceFaultKind(message: string): { kind: SourceFaultKind; status: number | null } {
  const text = String(message ?? "");
  const answered = text.match(/\banswered (\d{3})\b/);
  const status = answered ? Number(answered[1]) : null;
  if (status !== null) {
    if (CREDENTIAL_STATUSES.has(status)) return { kind: "credentials", status };
    if (status >= 400 && status < 500 && !RETRYABLE_4XX.has(status)) return { kind: "request", status };
    return { kind: "transient", status };
  }
  if (CREDENTIAL_WORDS.test(text)) return { kind: "credentials", status };
  if (REQUEST_WORDS.test(text)) return { kind: "request", status };
  return { kind: "transient", status };
}

/** A platform's fault from the message its run kept. */
export function sourceFault(platform: TrendPlatform, message: string): SourceFault {
  return { platform, ...sourceFaultKind(message), message: String(message ?? "").slice(0, 300) };
}
