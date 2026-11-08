// One message to #ai-products-issues (private, C0CG0ASL404), mentioning Lital.
//
// Posted through a Slack incoming webhook, Slack's documented way to post to
// one channel (https://api.slack.com/messaging/webhooks): a POST of JSON
// { "text": ... } to the webhook URL. The URL is a secret,
// SLACK_ISSUES_WEBHOOK_URL. It is never logged or printed, not even in an
// error, and without it nothing is posted.
//
// The report messages: one when a report still isn't ready a day after its
// first try (run-scheduled-jobs/dispatch.ts decides when), and one short
// message when that report is ready. One fixed test message shows the channel
// is connected (run-scheduled-jobs mode alert_test), so the webhook can be
// checked the moment the secret is added.

/** The secret that holds the issues channel's incoming webhook URL. */
export const ISSUES_WEBHOOK_ENV = "SLACK_ISSUES_WEBHOOK_URL";
/** Lital, mentioned at the start of every message. */
export const LITAL_SLACK = "<@U03AZ88435H>";

const APP_URL = "https://socialytics.moburst.com";
/** Slack answers an incoming webhook at once; a request still open after this long is dropped. */
const POST_TIMEOUT_MS = 10_000;

type ReportKind = "social" | "competitive";
interface Period { start: string; end: string }

/** The client's reports page for this kind of report (src/App.tsx routes). */
export function reportsLink(kind: ReportKind, clientId: string): string {
  const id = encodeURIComponent(clientId);
  return kind === "competitive" ? `${APP_URL}/clients/${id}/competitive/reports` : `${APP_URL}/clients/${id}/reports`;
}

/** Slack reads &, < and > as markup in a message's text; these are shown as written. */
const escape = (text: string) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date (yyyy-mm-dd) as year, month (0-11) and day, or null. */
function dateOf(value: string): { y: number; m: number; d: number } | null {
  const match = DAY.exec(String(value ?? "").slice(0, 10));
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(Date.UTC(y, m, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m && check.getUTCDate() === d ? { y, m, d } : null;
}

/**
 * The period in words: "October 2026" for a whole calendar month, else its
 * first and last day ("Nov 1 to Nov 8, 2026"; "Dec 15, 2025 to Jan 14, 2026").
 */
export function periodText(range: Period): string {
  const s = dateOf(range.start);
  const e = dateOf(range.end);
  if (!s || !e) return escape(`${range.start} to ${range.end}`);
  const lastDay = new Date(Date.UTC(s.y, s.m + 1, 0)).getUTCDate();
  if (s.y === e.y && s.m === e.m && s.d === 1 && e.d === lastDay) return `${MONTHS[s.m]} ${s.y}`;
  const short = (x: { m: number; d: number }) => `${MONTHS[x.m].slice(0, 3)} ${x.d}`;
  if (s.y === e.y && s.m === e.m && s.d === e.d) return `${short(s)}, ${s.y}`;
  return s.y === e.y ? `${short(s)} to ${short(e)}, ${e.y}` : `${short(s)}, ${s.y} to ${short(e)}, ${e.y}`;
}

const which = (kind: ReportKind, client: string, range: Period) => `The ${kind} report for ${escape(client)} (${periodText(range)})`;

/** A report still not ready a day after its first try: the client, the report, its period, why, and its page. */
export function stuckReportText(a: { client: string; kind: ReportKind; range: Period; reason: string; link: string }): string {
  return `${LITAL_SLACK} ${which(a.kind, a.client, a.range)} still isn't ready a day after the first try. Reason: ${escape(a.reason)}. ${a.link}`;
}

/** The report from an earlier message is ready. */
export function madeReportText(a: { client: string; kind: ReportKind; range: Period; link: string }): string {
  return `${LITAL_SLACK} ${which(a.kind, a.client, a.range)} is ready now. ${a.link}`;
}

/**
 * Posts one message to the issues channel. True when Slack took it; false,
 * with no request, when there is no webhook; false when Slack refused it or
 * the request failed. Never throws, and never logs the webhook URL.
 */
export async function postIssue(webhook: string | undefined, text: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): Promise<boolean> {
  if (!webhook) return false;
  try {
    const r = await fetchImpl(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    await r.body?.cancel().catch(() => {});
    if (r.ok) return true;
    // Only the status: nothing of the answer is logged.
    console.warn(`[slack] The issues channel refused the message (${r.status}).`);
    return false;
  } catch (e) {
    // The error's own text can carry the URL, so only its kind is logged.
    console.warn(`[slack] The message to the issues channel was not sent (${e instanceof Error ? e.name : "unknown error"}).`);
    return false;
  }
}

/** The fixed message alert_test posts: the channel is connected. */
export const CONNECTED_TEXT = `${LITAL_SLACK} Socialytics alerts are connected to this channel.`;

/**
 * Posts the fixed test message (run-scheduled-jobs mode alert_test). The
 * answer says only whether Slack took it: never the webhook or Slack's reply.
 * Without the webhook nothing is requested.
 */
export async function alertTest(webhook: string | undefined, fetchImpl?: typeof fetch): Promise<{ posted: boolean }> {
  return { posted: await postIssue(webhook, CONNECTED_TEXT, fetchImpl) };
}
