import { describe, expect, it } from "vitest";
import { asMediaBackend, mediaBackendFor } from "../../../supabase/functions/_shared/higgsfield/backend";

/** Just enough of the Supabase client for a single maybeSingle() read. */
function db(result: { data?: any; error?: any } | (() => never)) {
  return {
    from() {
      if (typeof result === "function") result();
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => result as any };
            },
          };
        },
      };
    },
  };
}

describe("asMediaBackend", () => {
  it("recognises the one alternative", () => {
    expect(asMediaBackend("higgsfield")).toBe("higgsfield");
  });

  it("treats anything else as the default, so a typo cannot spend credits", () => {
    for (const value of ["Higgsfield", "HIGGSFIELD", "gemini", "", null, undefined, 1, {}]) {
      expect(asMediaBackend(value)).toBe("gemini");
    }
  });
});

describe("mediaBackendFor", () => {
  it("reads the client's column", async () => {
    expect(await mediaBackendFor(db({ data: { media_backend: "higgsfield" } }), "c1")).toBe("higgsfield");
  });

  it("defaults when there is no client id", async () => {
    expect(await mediaBackendFor(db({ data: { media_backend: "higgsfield" } }), null)).toBe("gemini");
  });

  it("defaults when the row cannot be read", async () => {
    expect(await mediaBackendFor(db({ error: { message: "nope" } }), "c1")).toBe("gemini");
  });

  it("defaults when the lookup throws rather than failing the generation", async () => {
    const thrower = db(() => {
      throw new Error("network");
    });
    expect(await mediaBackendFor(thrower, "c1")).toBe("gemini");
  });
});
