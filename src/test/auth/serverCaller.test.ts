import { describe, it, expect } from "vitest";
import { serverActAsUser, serverActor, SERVER_SECRET_HEADER, SERVER_USER_HEADER } from "../../../supabase/functions/_shared/auth/authz";

describe("server calls to staff-gated functions", () => {
  it("name the headers the api worker sends", () => {
    expect(SERVER_SECRET_HEADER).toBe("x-socialytics-secret");
    expect(SERVER_USER_HEADER).toBe("x-socialytics-user");
  });
  it("accept only a UUID as the user to act for", () => {
    expect(serverActAsUser("11111111-2222-4333-8444-555555555555")).toBe("11111111-2222-4333-8444-555555555555");
    expect(serverActAsUser(" 11111111-2222-4333-8444-555555555555 ")).toBe("11111111-2222-4333-8444-555555555555");
    expect(serverActAsUser("lital@moburst.com")).toBe("");
    expect(serverActAsUser(null)).toBe("");
    expect(serverActAsUser("")).toBe("");
  });
});

describe("the system actor", () => {
  it("is a server call with no user header, and only where the path allows it", () => {
    expect(serverActor(null, true)).toEqual({ kind: "system" });
    expect(serverActor("", true)).toEqual({ kind: "system" });
    expect(serverActor(null, false)).toBeNull();
  });
  it("never stands in for a header that names someone, well formed or not", () => {
    expect(serverActor("11111111-2222-4333-8444-555555555555", true)).toEqual({ kind: "user", userId: "11111111-2222-4333-8444-555555555555" });
    expect(serverActor("lital@moburst.com", true)).toBeNull();
    expect(serverActor("not-a-user", false)).toBeNull();
  });
});
