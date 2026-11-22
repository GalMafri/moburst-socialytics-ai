// @vitest-environment node
// P37-03 (QA 22 Nov 2026): a submitted frame whose look-up keeps failing was polled for ever.
import { expect, it } from "vitest";
import { STALE_SUBMITTED_MS, submittedGivenUp } from "../../functions/advance-creative-plan/stale";

const NOW = Date.parse("2026-11-22T12:00:00Z");

it("gives up a submitted job whose look-up still fails after the limit", () => {
  expect(submittedGivenUp(new Date(NOW - STALE_SUBMITTED_MS - 1).toISOString(), NOW)).toBe(true);
});

it("keeps asking about a recent one, and never gives up on an unreadable date", () => {
  expect(submittedGivenUp(new Date(NOW - 10 * 60_000).toISOString(), NOW)).toBe(false);
  expect(submittedGivenUp("not a date", NOW)).toBe(false);
});
