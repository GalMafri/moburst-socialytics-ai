// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_SETUP_STEPS, designWaitingFor, designWaitingLine } from "./setup";
import { waitingLine } from "../../../../src/lib/designWeek";

const step = (name: string, status: string, waiting_for?: string) => ({ step: name, status, result: waiting_for ? { waiting_for } : {} });
const functions = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("designWaitingFor", () => {
  it("names the logo file first, then the design references' own wait, else the look", () => {
    expect(DESIGN_SETUP_STEPS).toEqual(["design_refs", "design_settings"]);
    expect(designWaitingFor([step("design_settings", "waiting", "logo_file"), step("design_refs", "waiting", "designed_posts")])).toBe("logo_file");
    expect(designWaitingFor([step("design_refs", "waiting", "designed_posts")])).toBe("designed_posts");
    expect(designWaitingFor([step("design_refs", "waiting", "social_accounts")])).toBe("social_accounts");
    expect(designWaitingFor([step("design_refs", "done"), step("design_settings", "running")])).toBe("look");
    expect(designWaitingFor([step("design_refs", "failed", "designed_posts")])).toBe("look");
    expect(designWaitingFor([step("design_refs", "waiting", "in_progress")])).toBe("look");
    expect(designWaitingFor([])).toBe("look");
  });
});

describe("designWaitingLine", () => {
  it("says what the client's setup waits for before designs start", () => {
    expect(designWaitingLine("look", "Pay The Pyper")).toBe("Designs start once Pay The Pyper's look is learned from its own posts.");
    expect(designWaitingLine("logo_file", "Pay The Pyper")).toBe("Designs start once Pay The Pyper's logo file is found on its website.");
    expect(designWaitingLine("social_accounts", "Bader Law")).toBe("Designs start once Bader Law's social accounts are connected.");
    expect(designWaitingLine("designed_posts", null)).toBe("Designs start once this client has published enough designed posts to learn its look from.");
    expect(designWaitingLine(undefined, " ")).toBe("Designs start once this client's look is learned from its own posts.");
  });

  it("is the one the app, the design button's server and the API use", () => {
    expect(waitingLine).toBe(designWaitingLine);
    const week = readFileSync(join(functions, "design-request", "week.ts"), "utf8");
    expect(week).toContain("from \"../_shared/design/setup.ts\"");
    expect(week).toContain("designWaitingFor(");
    const serializers = readFileSync(join(functions, "_shared", "socialytics-api", "serializers.ts"), "utf8");
    expect(serializers).toContain("from \"../design/setup.ts\"");
    expect(serializers).toContain("designWaitingLine(");
  });
});
