import { describe, expect, it } from "vitest";
import {
  brandFooting,
  brandWarning,
  correctionFor,
  noBrandFootingError,
  verdictIsDirty,
  verdictSummary,
} from "@/lib/designGuard";
import type { ClientContext } from "@/lib/clientContext";

const base: ClientContext = {
  client_id: "c1",
  client_name: "Test Client",
  brand_identity: null,
  design_references: [],
  brand_book_file_path: null,
  brand_book_url: null,
  content_pillars: [],
  brief_text: null,
  brand_notes: null,
  geo: [],
  languages: [],
  timezone: "UTC",
  design_style_synthesis: null,
};

const ctx = (over: Partial<ClientContext>): ClientContext => ({ ...base, ...over });

describe("brandFooting", () => {
  it("counts a synthesized design language as strong footing", () => {
    const f = brandFooting(ctx({ design_style_synthesis: { composition_patterns: "Full-bleed photography." } as any }));
    expect(f.strong).toBe(true);
    expect(f.none).toBe(false);
  });

  it("counts design references as strong footing", () => {
    // Bader Law and LegaBot: references but no brand book and no identity fields.
    const f = brandFooting(ctx({ design_references: ["a.png", "b.png"] }));
    expect(f.strong).toBe(true);
  });

  it("treats an empty synthesis shell as no synthesis", () => {
    const f = brandFooting(ctx({ design_style_synthesis: { synthesized_at: "2026-01-01", source_count: 0 } as any }));
    expect(f.strong).toBe(false);
    expect(f.none).toBe(true);
  });

  it("treats prose-only brand identity as weak", () => {
    // Gluvana Gluten Free: identity fields, nothing visual.
    const f = brandFooting(ctx({ brand_identity: { visual_style: "Clean and warm" } as any }));
    expect(f.weak).toBe(true);
    expect(f.strong).toBe(false);
    expect(f.none).toBe(false);
  });

  it("flags a client with nothing at all", () => {
    // MyRxProfile: no synthesis, no references, no book, no identity.
    const f = brandFooting(base);
    expect(f.none).toBe(true);
    expect(f.gaps).toContain("no design references");
  });

  it("ignores an all-whitespace brand identity", () => {
    expect(brandFooting(ctx({ brand_identity: { visual_style: "   " } as any })).none).toBe(true);
  });
});

describe("brandWarning", () => {
  it("says nothing when the client is properly set up", () => {
    expect(brandWarning(ctx({ design_references: ["a.png"] }))).toBeNull();
  });

  it("names the client and tells them where to fix it", () => {
    const w = brandWarning(ctx({ client_name: "MyRxProfile" }));
    expect(w).toContain("MyRxProfile");
    expect(w).toContain("Client Setup");
  });

  it("distinguishes weak footing from none", () => {
    const weak = brandWarning(ctx({ brand_identity: { visual_style: "Clean" } as any }))!;
    expect(weak).toContain("cannot match the real look");
    expect(weak).not.toContain("generic stock art");
  });
});

describe("verdict handling", () => {
  it("is not dirty when the check was skipped", () => {
    expect(verdictIsDirty({ has_logo: true, skipped: true })).toBe(false);
    expect(verdictIsDirty(null)).toBe(false);
    expect(verdictIsDirty({ has_hex_codes: false, has_logo: false, has_garbled_text: false })).toBe(false);
  });

  it("is dirty on any single flag", () => {
    expect(verdictIsDirty({ has_logo: true })).toBe(true);
    expect(verdictIsDirty({ has_garbled_text: true })).toBe(true);
    expect(verdictIsDirty({ has_hex_codes: true })).toBe(true);
  });

  it("summarises what was caught in plain words", () => {
    expect(verdictSummary({ has_logo: true, has_garbled_text: true })).toBe("an invented logo and malformed text");
  });

  it("writes a correction naming the specific failure", () => {
    const c = correctionFor({ has_logo: true });
    expect(c).toContain("NO logo");
    expect(c).not.toContain("colour codes");
    expect(correctionFor({})).toBe("");
  });
});

describe("noBrandFootingError", () => {
  it("surfaces the server refusal", () => {
    expect(noBrandFootingError({ code: "no_brand_footing", error: "X has no brand material" })).toBe("X has no brand material");
  });
  it("ignores anything else", () => {
    expect(noBrandFootingError({ error: "boom" })).toBeNull();
    expect(noBrandFootingError(null)).toBeNull();
  });
});
