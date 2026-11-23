// @vitest-environment node
// An opt-in check of the review question against the live model. It never
// runs on its own: it is skipped unless ANTHROPIC_API_KEY is set and
// REVIEW_LIVE=1 is given, so a key in the environment alone never makes the
// test suite call a model.
//
//   REVIEW_LIVE=1 ANTHROPIC_API_KEY=... ./node_modules/.bin/vitest run supabase/tests/_shared/brand-references/reviewLive.test.ts
//
// The posts are synthetic: 20 small images for an invented brand (simple
// shapes and lettering) in supabase/tests/fixtures/review, each with a
// platform, a date and a caption in posts.json. Two posts for each occasion
// type, 8 plain everyday posts, and 2 everyday layouts published on a holiday
// date with an ordinary caption. The request is the one production sends
// (discover.ts reviewRequest), with the image's bytes in place of its URL.
//
// Required: no clear occasion post answers everyday (it would enter a
// library and be copied), and at most 1 everyday post answers occasion.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anthropicFetch } from "../../../functions/_shared/anthropic";
import { kindClassification, OCCASIONS, usableClassification } from "../../../functions/_shared/brand-references/candidates";
import { reviewReply, reviewRequest } from "../../../functions/_shared/brand-references/discover";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "review");
interface Post { file: string; platform: string; date: string; caption: string; expect: string; note?: string }
const { brand, posts } = JSON.parse(readFileSync(join(fixtures, "posts.json"), "utf8")) as { brand: string; posts: Post[] };

const key = process.env.ANTHROPIC_API_KEY ?? "";
const live = !!key && process.env.REVIEW_LIVE === "1";

describe("the fixtures", () => {
  it("hold two posts for each occasion type, 8 plain everyday posts and 2 everyday posts published on a holiday date", () => {
    expect(brand).toBe("Harbor Coffee");
    expect(posts).toHaveLength(20);
    for (const type of OCCASIONS) expect(posts.filter((p) => p.expect === type), type).toHaveLength(2);
    const everyday = posts.filter((p) => p.expect === "everyday");
    expect(everyday.filter((p) => !p.note)).toHaveLength(8);
    expect(everyday.filter((p) => p.note === "published on a holiday date").map((p) => p.date.slice(5))).toEqual(["07-04", "12-25"]);
    for (const p of posts) {
      expect(readFileSync(join(fixtures, p.file)).byteLength, p.file).toBeLessThan(40_000);
      expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe.skipIf(!live)("the review question, asked of the live model", () => {
  it("answers occasion for every occasion post, and everyday for all but at most one everyday post", async () => {
    const answers: Array<{ post: Post; usable: boolean; kind: string | null; occasion: string | null; evidence: string }> = [];
    for (const post of posts) {
      // The test meter (supabase/tests/paid) adds no key, so the request carries this check's own.
      const response = await anthropicFetch({ tool: "socialytics", clientId: null, feature: "qa.review_live", actor: "system", qa: true }, "/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(reviewRequest(
          { brand, platform: post.platform, postedAt: `${post.date}T15:00:00Z`, caption: post.caption },
          { type: "base64", media_type: "image/jpeg", data: readFileSync(join(fixtures, post.file)).toString("base64") },
        )),
        signal: AbortSignal.timeout(30_000),
      });
      expect(response.ok, `${post.file}: the model answered ${response.status}`).toBe(true);
      const value = reviewReply(await response.json());
      const answer = kindClassification(value);
      answers.push({ post, usable: usableClassification(value), kind: answer?.kind ?? null, occasion: answer?.occasion ?? null, evidence: answer?.evidence ?? "" });
    }
    console.table(answers.map((a) => ({ file: a.post.file, expected: a.post.expect, usable: a.usable, kind: a.kind, occasion: a.occasion, evidence: a.evidence.slice(0, 60) })));

    // Every post here is a designed layout.
    expect(answers.filter((a) => !a.usable).map((a) => a.post.file)).toEqual([]);
    // No clear occasion answers everyday. (No full answer keeps a post out as well, so it does not count against this.)
    expect(answers.filter((a) => a.post.expect !== "everyday" && a.kind === "everyday").map((a) => a.post.file)).toEqual([]);
    // At most one everyday post is held back as an occasion or left unanswered.
    expect(answers.filter((a) => a.post.expect === "everyday" && a.kind !== "everyday").length).toBeLessThanOrEqual(1);
  }, 600_000);
});
