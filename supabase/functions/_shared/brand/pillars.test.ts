import { afterEach, describe, expect, it, vi } from "vitest";
import { briefFromStrategyDoc, checkPostIds, derivePillars, isGenericPillars, trimBrief, type PillarPost } from "./pillars";
import { fakeDb } from "../lifecycle/fakeDb";

const asked = vi.hoisted(() => ({ bodies: [] as Array<Record<string, unknown>>, reply: "" }));
vi.mock("../anthropic.ts", () => ({ anthropicMessages: async (a: { body: Record<string, unknown> }) => { asked.bodies.push(a.body); return { text: asked.reply, stopReason: "end_turn" }; } }));
afterEach(() => { asked.bodies = []; asked.reply = ""; });

describe("briefFromStrategyDoc", () => {
  it("takes a text document's own words, without a model call", async () => {
    const db = fakeDb();
    db.uploads.set("brand-books/acme/strategy.md", "# Acme strategy\n\nAcme makes   rec league scheduling simple for captains across North America.\n\n\n\nVoice: confident, direct.");
    // No AI key: a text document never needs one.
    expect(await briefFromStrategyDoc(db, "acme/strategy.md", null)).toEqual({ text: "# Acme strategy\n\nAcme makes rec league scheduling simple for captains across North America.\n\nVoice: confident, direct.", via: "text" });
  });
  it("answers null for a document it cannot read here, and needs the AI connection for a PDF", async () => {
    const db = fakeDb();
    db.uploads.set("brand-books/acme/strategy.docx", "PK");
    expect(await briefFromStrategyDoc(db, "acme/strategy.docx", null)).toBeNull();
    expect(await briefFromStrategyDoc(db, "acme/missing.pdf", null)).toBeNull();
    db.uploads.set("brand-books/acme/strategy.pdf", "%PDF-1.7");
    await expect(briefFromStrategyDoc(db, "acme/strategy.pdf", null)).rejects.toThrow(/not configured/);
  });
});

describe("trimBrief", () => {
  it("cuts a long brief at the last paragraph that fits", () => {
    const text = `${"First paragraph sentence. ".repeat(10).trim()}\n\n${"Second paragraph sentence. ".repeat(10).trim()}`;
    const cut = trimBrief(text, 400);
    expect(cut).toBe("First paragraph sentence. ".repeat(10).trim());
    expect(trimBrief("Short.", 400)).toBe("Short.");
  });
});

describe("isGenericPillars", () => {
  it("counts the five generic pillars with no descriptions as none", () => {
    expect(isGenericPillars(["Thought Leadership", "Product Education", "Client Wins", "Industry Trends", "Team Culture"].map((name) => ({ name, description: "" })))).toBe(true);
    expect(isGenericPillars([{ name: "Thought Leadership", description: "Our CEO's takes" }, { name: "Product Education" }, { name: "Client Wins" }, { name: "Industry Trends" }, { name: "Team Culture" }])).toBe(false);
    expect(isGenericPillars([])).toBe(true);
  });
});

describe("pillars and a brief from the client's posts (onboarding from social profiles)", () => {
  const POSTS: PillarPost[] = [
    { id: "P1", platform: "Instagram", format: "carousel", date: "2026-10-20", text: "Skip the line: order ahead in two taps", label: "2.4x its platform's median for carousels", top: true },
    { id: "P2", platform: "LinkedIn", format: "image", date: "2026-10-25", text: "Restaurants grow digital orders with us", label: null, top: false },
    { id: "P3", platform: "LinkedIn", format: "image", date: "2026-10-28", text: "Meet our team in Austin", label: null, top: false },
    { id: "P4", platform: "Instagram", format: "image", date: "2026-10-30", text: "New menu items this week", label: null, top: false },
  ];
  const REPLY = JSON.stringify({
    pillars: [
      { name: "Order ahead", description: "How ordering ahead saves time (P1).", rationale: "Its top carousel [P1]", posts: ["P1"] },
      { name: "Restaurant growth", description: "Results for restaurants.", rationale: "Three posts", posts: ["P2", "P3", "P4"] },
      { name: "Team life", description: "The team.", rationale: "One post", posts: ["P3"] },
      { name: "Invented", description: "Nothing behind it.", rationale: "None", posts: ["P9"] },
    ],
    keywords: ["online ordering"], notes: "Read from the posts.",
    brief: [{ text: "Olo sells online ordering to restaurants (P2).", posts: ["P2"] }, { text: "Its voice is quick and friendly.", posts: ["P1", "P4"] }, { text: "A line with no post.", posts: [] }],
  });
  it("reads the social read's posts with their labels instead of the reports, and asks for a brief from them", async () => {
    asked.reply = REPLY;
    const db = fakeDb({ reports: [{ client_id: "c1", report_data: { sprout_performance: { top_posts: [{ text: "Old report post" }] } } }] });
    const out = await derivePillars(db, { id: "c1", name: "Olo" }, "key", { posts: POSTS, briefFromPosts: true, bio: "Order ahead. Austin, TX" });
    const content = (asked.bodies[0].messages as Array<{ content: Array<{ text?: string }> }>)[0].content.map((c) => c.text ?? "").join("\n");
    expect(content).toContain("P1 [Instagram carousel, 2026-10-20, 2.4x its platform's median for carousels] Skip the line");
    expect(content).toContain("Order ahead. Austin, TX");
    expect(content).not.toContain("Old report post");
    expect(content).toContain('"brief"');
    // A client with only its posts: a pillar stands on one top post or three posts; ids are checked, then removed.
    expect(out.pillars).toEqual([
      { name: "Order ahead", description: "How ordering ahead saves time.", rationale: "Its top carousel" },
      { name: "Restaurant growth", description: "Results for restaurants.", rationale: "Three posts" },
    ]);
    expect(out.brief).toBe("Olo sells online ordering to restaurants.\nIts voice is quick and friendly.");
    expect(out.source).toBe("social_posts");
  });
  it("keeps every pillar when the client has other evidence, the ids still removed", () => {
    const parsed = { pillars: [{ name: "Team life", description: "The team (P3).", rationale: "r", posts: ["P3"] }], brief: [] };
    expect(checkPostIds(parsed, POSTS, { postsOnly: false })).toEqual({ pillars: [{ name: "Team life", description: "The team.", rationale: "r" }], brief: null });
    expect(checkPostIds(parsed, POSTS, { postsOnly: true }).pillars).toEqual([]);
  });
});
