import { describe, expect, it } from "vitest";
import { findAuthUserByEmail } from "../../../supabase/functions/_shared/auth/findUser";

/** A fake admin API holding `total` users, paged the way GoTrue pages them. */
function adminWith(emails: string[]) {
  const calls: Array<{ page?: number; perPage?: number }> = [];
  const supabase = {
    auth: {
      admin: {
        async listUsers(args?: { page?: number; perPage?: number }) {
          calls.push(args || {});
          const perPage = args?.perPage ?? 50;
          const page = args?.page ?? 1;
          const slice = emails.slice((page - 1) * perPage, page * perPage);
          return { data: { users: slice.map((e, i) => ({ id: `u${(page - 1) * perPage + i}`, email: e })) }, error: null };
        },
      },
    },
  };
  return { supabase, calls };
}

const many = (n: number, prefix = "user") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}@moburst.com`);

describe("findAuthUserByEmail", () => {
  it("finds someone on the first page", async () => {
    const { supabase, calls } = adminWith(["a@moburst.com", "b@moburst.com"]);
    expect((await findAuthUserByEmail(supabase as any, "b@moburst.com"))?.id).toBe("u1");
    expect(calls.length).toBe(1);
  });

  it("finds someone past the first page, which is the whole point", async () => {
    // The old code called listUsers() with no arguments and searched only what
    // came back. Anyone sorting past that page could not sign in at all.
    const emails = [...many(240), "late@moburst.com"];
    const { supabase, calls } = adminWith(emails);
    const found = await findAuthUserByEmail(supabase as any, "late@moburst.com");
    expect(found?.email).toBe("late@moburst.com");
    expect(calls.length).toBeGreaterThan(1);
  });

  it("returns null for an address that is genuinely absent", async () => {
    const { supabase } = adminWith(many(10));
    expect(await findAuthUserByEmail(supabase as any, "nobody@moburst.com")).toBeNull();
  });

  it("stops as soon as a page comes back short", async () => {
    const { supabase, calls } = adminWith(many(10));
    await findAuthUserByEmail(supabase as any, "nobody@moburst.com");
    expect(calls.length).toBe(1);
  });

  it("stops on an exactly-full final page without looping forever", async () => {
    const { supabase, calls } = adminWith(many(400));
    expect(await findAuthUserByEmail(supabase as any, "nobody@moburst.com")).toBeNull();
    // 400 = two full pages of 200, then a third that comes back empty.
    expect(calls.length).toBe(3);
  });

  it("ignores case and surrounding whitespace on both sides", async () => {
    const { supabase } = adminWith(["  Mixed.Case@Moburst.com "]);
    expect(await findAuthUserByEmail(supabase as any, "mixed.case@moburst.COM")).toBeTruthy();
  });

  it("surfaces a listing failure instead of reporting the user as missing", async () => {
    // Reporting null here would send the caller down its create branch, which
    // then fails on a duplicate address and reads as "cannot provision user".
    const supabase = {
      auth: { admin: { async listUsers() { return { data: null, error: new Error("rate limited") }; } } },
    };
    await expect(findAuthUserByEmail(supabase as any, "a@moburst.com")).rejects.toThrow(/rate limited/);
  });

  it("tolerates a user row with no email", async () => {
    const supabase = {
      auth: {
        admin: {
          async listUsers() {
            return { data: { users: [{ id: "u0" }, { id: "u1", email: "a@moburst.com" }] }, error: null };
          },
        },
      },
    };
    expect((await findAuthUserByEmail(supabase as any, "a@moburst.com"))?.id).toBe("u1");
  });
});
