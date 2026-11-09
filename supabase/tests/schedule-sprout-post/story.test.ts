import { describe, expect, it } from "vitest";
import { fakeDb } from "../../functions/_shared/lifecycle/fakeDb";
import { STORY_NOT_SCHEDULABLE } from "../../functions/_shared/sprout/publishRules";
import { storedStoryProblem } from "../../functions/schedule-sprout-post/story";

// schedule-sprout-post refuses a Story by the format the calendar holds for
// the post, whatever the request says.

const posts = [
  { client_id: "c1", post_key: "post:feed", platform: "Instagram", format: "Single image" },
  { client_id: "c1", post_key: "post:story", platform: "Instagram", format: "Story", story_of: "post:feed" },
  { client_id: "c1", post_key: "post:fb-story", platform: "Facebook", format: "Story" },
  { client_id: "c2", post_key: "post:other-client", platform: "Instagram", format: "Story" },
];

describe("storedStoryProblem", () => {
  it("refuses a post the calendar holds as a Story", async () => {
    const db = fakeDb({ calendar_posts: posts });
    expect(await storedStoryProblem(db, "c1", "post:story")).toBe(STORY_NOT_SCHEDULABLE);
    expect(await storedStoryProblem(db, "c1", "post:fb-story")).toBe(STORY_NOT_SCHEDULABLE);
  });

  it("lets a feed post, a post the calendar doesn't hold, and another client's post through", async () => {
    const db = fakeDb({ calendar_posts: posts });
    expect(await storedStoryProblem(db, "c1", "post:feed")).toBeNull();
    expect(await storedStoryProblem(db, "c1", "post:missing")).toBeNull();
    expect(await storedStoryProblem(db, "c1", "post:other-client")).toBeNull();
    expect(await storedStoryProblem(db, "c1", null)).toBeNull();
  });
});
