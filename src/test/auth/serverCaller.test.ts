import { describe, it, expect } from "vitest";
import { serverActAsUser, SERVER_SECRET_HEADER, SERVER_USER_HEADER } from "../../../supabase/functions/_shared/auth/authz";

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
