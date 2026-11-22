// P49: an X post with a link is refused as too long. X counts every link as 23
// characters (t.co), but publishProblems counts the link's full length, so a
// post X and Sprout take is refused in the dialog and by schedule-sprout-post.
import { describe, expect, it } from "vitest";
import { publishProblems } from "../../../../supabase/functions/_shared/sprout/publishRules";

describe("P49 X length with a link", () => {
  it("takes 240 characters of copy plus a long link (X weighs the link as 23)", () => {
    const text = `${"a".repeat(240)} https://www.example.com/blog/2026/11/a-long-article-slug-about-the-launch?utm_source=x`;
    expect(publishProblems({ network: "twitter", text, mediaUrls: [] })).toEqual([]);
  });
});
