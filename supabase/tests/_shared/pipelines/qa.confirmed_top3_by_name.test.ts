// @vitest-environment node
// P43-03: aggregate marks in_confirmed_top3 by a substring match on names,
// although the landscape step already resolved the confirmed competitors to
// RivalIQ ids (selected_company_ids, matched by website or saved id). A
// confirmed competitor whose RivalIQ name differs from the name the team
// saved is not marked, and the client is marked when names overlap.
import { describe, expect, it } from "vitest";
import { aggregateCompetitive } from "../../../functions/_shared/pipelines/competitive/aggregate";
import { runConfig } from "../../../functions/_shared/pipelines/competitive/nodes";

const body = { client_name: "Acme Bank", website_url: "https://acmebank.com", date_range_start: "2026-10-01", date_range_end: "2026-10-31",
  competitors: [{ name: "Facebook", website_url: "https://meta.com" }, { name: "Acme", website_url: "https://acme-loans.com" }] };
const landscape = { landscape_id: 7, landscape_name: "L", matched_by: "explicit id", client_company_id: 1, selected_company_ids: [2, 3],
  companies: [{ id: 1, name: "Acme Bank", url: "https://acmebank.com" }, { id: 2, name: "Meta", url: "https://meta.com" }, { id: 3, name: "Acme", url: "https://acme-loans.com" }] };

describe("aggregate: confirmed competitor flag", () => {
  it("follows the resolved selection ids, not name substrings", () => {
    const out = aggregateCompetitive({ cfg: runConfig(body, new Date("2026-11-02T00:00:00Z")), landscape, companiesResp: { companies: landscape.companies },
      postsResp: { socialPosts: [] }, metricsResp: {}, metricsPrevResp: {}, seriesResp: {}, audienceResp: {}, body });
    const flag = Object.fromEntries(out.companies.map((c: { company_id: string; in_confirmed_top3: boolean }) => [c.company_id, c.in_confirmed_top3]));
    expect(flag).toEqual({ "1": false, "2": true, "3": true });
  });
});
