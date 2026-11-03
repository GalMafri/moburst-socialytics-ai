// @vitest-environment node
// The seasonal posts filter as supabase-js really sends it: JSON containment
// on calendar_posts.reasons, never a Postgres array literal.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SEASONAL_REASON } from "./runMoments";

describe("SEASONAL_REASON", () => {
  it("goes to PostgREST as JSON containment", async () => {
    const urls: string[] = [];
    const db = createClient("https://db.test", "anon", {
      global: { fetch: (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response("[]", { headers: { "Content-Type": "application/json" } }); }) as typeof fetch },
    });
    await db.from("calendar_posts").select("post_date").contains("reasons", SEASONAL_REASON);
    await db.from("calendar_posts").select("post_date").contains("reasons", [{ type: "seasonal" }] as never);
    const filter = (u: string) => decodeURIComponent(new URL(u).searchParams.get("reasons") ?? "");
    expect(filter(urls[0])).toBe('cs.[{"type":"seasonal"}]');
    // What the array form sent, which the database refused.
    expect(filter(urls[1])).not.toBe('cs.[{"type":"seasonal"}]');
  });
});
