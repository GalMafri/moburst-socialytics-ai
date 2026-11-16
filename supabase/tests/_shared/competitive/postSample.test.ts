// Posting times are counted in the client's own time zone, so "the client
// posts at 9 pm" means 9 pm where the client is. A report with no zone counts
// in UTC and says so.
import { describe, expect, it } from "vitest";
import { addPostToSample, companyPostSample, emptyPostSample, validTimeZone } from "../../../functions/_shared/competitive/postSample";
import { aggregateCompetitive } from "../../../functions/_shared/pipelines/competitive/aggregate";

const post = { postId: "p1", companyId: "1", publishedAt: "2026-10-10T01:30:00Z", channel: "instagram", message: "hi", engagementTotal: 3 };

describe("posting times by zone", () => {
  it("counts a post published 2026-10-10T01:30Z for a New York client in hour 21 on Friday", () => {
    const bucket = emptyPostSample();
    addPostToSample(bucket, post, "America/New_York");
    expect(bucket.by_hour).toEqual({ "21": 1 });
    expect(bucket.by_weekday).toEqual({ Fri: 1 });
  });

  it("counts the same post in hour 1 on Saturday with no zone", () => {
    const bucket = emptyPostSample();
    addPostToSample(bucket, post);
    expect(bucket.by_hour).toEqual({ "1": 1 });
    expect(bucket.by_weekday).toEqual({ Sat: 1 });
  });

  it("counts midnight as hour 0, never 24, and follows daylight saving time", () => {
    const bucket = emptyPostSample();
    addPostToSample(bucket, { ...post, publishedAt: "2026-07-01T04:00:00Z" }, "America/New_York");
    addPostToSample(bucket, { ...post, publishedAt: "2026-12-01T05:00:00Z" }, "America/New_York");
    expect(bucket.by_hour).toEqual({ "0": 2 });
  });

  it("buckets a company and each of its channels in the zone", () => {
    const sample = companyPostSample([post], 30, "America/New_York");
    expect(sample.by_hour).toEqual({ "21": 1 });
    expect(sample.by_channel.instagram.by_hour).toEqual({ "21": 1 });
    expect(sample.by_channel.instagram.by_weekday).toEqual({ Fri: 1 });
  });

  it("accepts a real zone only", () => {
    expect(validTimeZone("America/New_York")).toBe("America/New_York");
    expect(validTimeZone("Not/AZone")).toBeNull();
    expect(validTimeZone("")).toBeNull();
    expect(validTimeZone(undefined)).toBeNull();
  });
});

describe("the aggregate", () => {
  const inputs = (time_zone?: string) => ({
    cfg: { report_id: "r", client_id: "c", client_name: "Client", set_id: "s", landscape_hint: "", competitors_json: "[]", range_start: "2026-10-01", range_end: "2026-10-31", started_at: "2026-11-01T00:00:00Z", suppressed_insights_json: "[]", attempt_started_at: "", time_zone },
    landscape: { landscape_id: "L", landscape_name: "L", matched_by: "id", client_company_id: "1", selected_company_ids: [] },
    companiesResp: { companies: [{ id: 1, name: "Client" }] },
    postsResp: { socialPosts: [post] },
    metricsResp: {}, metricsPrevResp: {}, seriesResp: {}, audienceResp: {},
    body: {},
  });

  it("stores the zone it counted in and counts the client's hours in it", () => {
    const out = aggregateCompetitive(inputs("America/New_York"));
    expect(out.time_zone).toBe("America/New_York");
    expect(out.companies[0].by_hour).toEqual({ "21": 1 });
    expect(out.companies[0].by_weekday).toEqual({ Fri: 1 });
    expect(out.companies[0].by_channel.instagram.by_hour).toEqual({ "21": 1 });
  });

  it("stores no zone and counts in UTC for a client with none", () => {
    const out = aggregateCompetitive(inputs());
    expect(out.time_zone).toBeUndefined();
    expect(out.companies[0].by_hour).toEqual({ "1": 1 });
    expect(aggregateCompetitive(inputs("Not/AZone")).time_zone).toBeUndefined();
  });
});
