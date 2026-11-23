import { describe, expect, it } from "vitest";
import { generate, stale } from "../../../scripts/api-docs";
import { config } from "../../../scripts/api-gen";

describe("generated API files", () => {
  const gen = generate(config);

  it("no breaking change is waiting without an entry in api/BREAKING.md", () => {
    expect(gen.blocked, "Keep the old shape working, or acknowledge it in api/BREAKING.md (see CLAUDE.md)").toEqual([]);
  });

  it("are up to date with the routes (run npm run api:gen)", () => {
    expect(stale(config, gen), "Run `npm run api:gen` and commit the files it writes").toEqual([]);
  });
});
