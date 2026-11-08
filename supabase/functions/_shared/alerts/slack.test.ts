// @vitest-environment node
// Node, like the Deno runtime, has AbortSignal.timeout; jsdom does not.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ISSUES_WEBHOOK_ENV, LITAL_SLACK, madeReportText, periodText, postIssue, reportsLink, stuckReportText } from "./slack";

const WEBHOOK = "https://hooks.slack.test/services/T000/B000/secret-part";
const OCTOBER = { start: "2026-10-01", end: "2026-10-31" };

afterEach(() => vi.restoreAllMocks());

describe("the issues channel", () => {
  it("is posted to through the secret SLACK_ISSUES_WEBHOOK_URL and mentions Lital", () => {
    expect(ISSUES_WEBHOOK_ENV).toBe("SLACK_ISSUES_WEBHOOK_URL");
    expect(LITAL_SLACK).toBe("<@U03AZ88435H>");
  });
});

describe("reportsLink", () => {
  it("is the client's reports page for the kind of report", () => {
    expect(reportsLink("social", "c-123")).toBe("https://socialytics.moburst.com/clients/c-123/reports");
    expect(reportsLink("competitive", "c-123")).toBe("https://socialytics.moburst.com/clients/c-123/competitive/reports");
  });
});

describe("periodText", () => {
  it("names a whole calendar month", () => {
    expect(periodText(OCTOBER)).toBe("October 2026");
    expect(periodText({ start: "2028-02-01", end: "2028-02-29" })).toBe("February 2028");
  });

  it("names the first and last day of any other period", () => {
    expect(periodText({ start: "2026-11-01", end: "2026-11-08" })).toBe("Nov 1 to Nov 8, 2026");
    expect(periodText({ start: "2026-10-15", end: "2026-11-14" })).toBe("Oct 15 to Nov 14, 2026");
    expect(periodText({ start: "2025-12-15", end: "2026-01-14" })).toBe("Dec 15, 2025 to Jan 14, 2026");
    expect(periodText({ start: "2026-11-08", end: "2026-11-08" })).toBe("Nov 8, 2026");
  });

  it("keeps a period it cannot read as it is", () => {
    expect(periodText({ start: "someday", end: "2026-11-08" })).toBe("someday to 2026-11-08");
  });
});

describe("stuckReportText", () => {
  it("mentions Lital first, then names the client, the report, its period, the reason and the reports page", () => {
    const text = stuckReportText({ client: "Fixture", kind: "social", range: OCTOBER, reason: "the in-app run stopped", link: reportsLink("social", "c-123") });
    expect(text).toBe("<@U03AZ88435H> The social report for Fixture (October 2026) is still not made a day after its first try. Reason: the in-app run stopped. https://socialytics.moburst.com/clients/c-123/reports");
    expect(text.startsWith(LITAL_SLACK)).toBe(true);
  });

  it("names a competitive report and links the client's competitive reports page", () => {
    const text = stuckReportText({ client: "Fixture", kind: "competitive", range: OCTOBER, reason: "the report engine setting could not be read", link: reportsLink("competitive", "c-123") });
    expect(text.startsWith(LITAL_SLACK)).toBe(true);
    expect(text).toContain("The competitive report for Fixture (October 2026)");
    expect(text).toContain("Reason: the report engine setting could not be read.");
    expect(text).toContain("https://socialytics.moburst.com/clients/c-123/competitive/reports");
  });

  it("escapes the characters Slack reads as markup in the client's name and the reason", () => {
    const text = stuckReportText({ client: "A&B <Co>", kind: "social", range: OCTOBER, reason: "x < y & z", link: reportsLink("social", "c-1") });
    expect(text).toContain("for A&amp;B &lt;Co&gt; (October 2026)");
    expect(text).toContain("Reason: x &lt; y &amp; z.");
    expect(text).not.toContain("<Co>");
  });
});

describe("madeReportText", () => {
  it("mentions Lital and says the report is made, with the reports page", () => {
    const text = madeReportText({ client: "Fixture", kind: "competitive", range: OCTOBER, link: reportsLink("competitive", "c-123") });
    expect(text).toBe("<@U03AZ88435H> The competitive report for Fixture (October 2026) is made now. https://socialytics.moburst.com/clients/c-123/competitive/reports");
  });

  it("uses no dashes as punctuation in either message", () => {
    const texts = [
      stuckReportText({ client: "Fixture", kind: "social", range: { start: "2026-11-01", end: "2026-11-08" }, reason: "it has not finished yet", link: reportsLink("social", "c") }),
      madeReportText({ client: "Fixture", kind: "social", range: { start: "2025-12-15", end: "2026-01-14" }, link: reportsLink("social", "c") }),
    ];
    for (const t of texts) expect(t).not.toMatch(/[—–]| - /);
  });
});

describe("postIssue", () => {
  it("posts nothing and answers false without a webhook", async () => {
    const fetchImpl = vi.fn();
    expect(await postIssue(undefined, "hello", fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(await postIssue("", "hello", fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the text once, as Slack's incoming webhook JSON, and answers true when Slack takes it", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return new Response("ok", { status: 200 }); };
    expect(await postIssue(WEBHOOK, "hello <@U03AZ88435H>", fetchImpl as typeof fetch)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "hello <@U03AZ88435H>" });
  });

  it("answers false, without throwing or logging the webhook, when Slack refuses the message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = async () => new Response("no_service", { status: 404 });
    expect(await postIssue(WEBHOOK, "hello", fetchImpl as unknown as typeof fetch)).toBe(false);
    const printed = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
    expect(printed).toContain("404");
    expect(printed).not.toContain("hooks.slack");
    expect(printed).not.toContain("secret-part");
  });

  it("answers false, without throwing or logging the webhook, when the request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = async () => { throw new TypeError(`fetch failed for ${WEBHOOK}`); };
    expect(await postIssue(WEBHOOK, "hello", fetchImpl as unknown as typeof fetch)).toBe(false);
    const printed = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(" ")).join("\n");
    expect(warn).toHaveBeenCalled();
    expect(printed).not.toContain("hooks.slack");
    expect(printed).not.toContain("secret-part");
  });
});
