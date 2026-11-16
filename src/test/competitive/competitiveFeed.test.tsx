import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import CompetitiveFeed from "@/pages/CompetitiveFeed";

// The competitor feed page: the date a drafted take lands on, the names it
// shows, the reach note under the grid and the topic wording. The database and
// the functions are stand-ins; nothing leaves the test.
const fixture = vi.hoisted(() => ({
  client: { id: "client", name: "Moburst", timezone: "America/New_York", primary_platforms: ["instagram"] } as Record<string, unknown>,
  posts: [] as Array<Record<string, unknown>>,
  topics: [] as Array<Record<string, unknown>>,
  inserted: [] as Array<Record<string, unknown>>,
  invoked: [] as Array<{ name: string; body: Record<string, unknown> }>,
  answers: {} as Record<string, unknown>,
  toasts: [] as Array<{ title?: string; description?: string }>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string; description?: string }) => { fixture.toasts.push(t); } }) }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canRunAnalysis: true }) }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <main>{actions}{children}</main> }));
vi.mock("@/components/competitive/PostVisual", async () => {
  const platform = await import("@/lib/platform");
  return { usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: platform.normalizePlatform, platformLabel: platform.platformLabel };
});
vi.mock("@/lib/openTopics", () => ({ fetchOpenTopics: async () => fixture.topics }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
        fixture.invoked.push({ name, body: opts.body });
        if (name in fixture.answers) return { data: fixture.answers[name], error: null };
        return { data: { post: { platform: opts.body.platform, caption_angle: "Our angle", concept: "Concept" } }, error: null };
      },
    },
    from: (table: string) => {
      let single = false;
      const query: Record<string, unknown> = {
        select: () => query, eq: () => query, order: () => query, limit: () => query, update: () => query,
        insert: (row: Record<string, unknown>) => { fixture.inserted.push(row); return Promise.resolve({ error: null }); },
        maybeSingle: () => { single = true; return query; },
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "clients") return Promise.resolve({ data: fixture.client, error: null }).then(resolve);
          if (table === "rivaliq_snapshots") {
            const payload = { window: { start: "2026-11-05", end: "2026-11-11" }, socialPosts: fixture.posts };
            return Promise.resolve({ data: [{ id: "snap", fetched_at: "2026-11-12T08:00:00Z", landscape_id: "ls", payload }], error: null }).then(resolve);
          }
          return Promise.resolve({ data: single ? null : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  },
}));

const post = (over: Record<string, unknown>) => ({ companyId: "2", companyName: "Peer", channel: "instagram", type: "photo", message: "A post", publishedAt: "2026-11-10", postLink: `https://example.com/${Math.random()}`, engagementTotal: 10, ...over });

let qc: QueryClient;
beforeEach(() => {
  fixture.client = { id: "client", name: "Moburst", timezone: "America/New_York", primary_platforms: ["instagram"] };
  fixture.posts = [];
  fixture.topics = [];
  fixture.inserted = [];
  fixture.invoked = [];
  fixture.answers = {};
  fixture.toasts = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); qc.clear(); vi.useRealTimers(); });

function mount() {
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/clients/client/competitive/feed"]}><Routes><Route path="/clients/:id/competitive/feed" element={<CompetitiveFeed />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("Draft our take", () => {
  it("dates the calendar post in the client's zone, not by the UTC date", async () => {
    // 02:00 UTC on Nov 13 is still the evening of Nov 12 in New York.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T02:00:00Z"));
    fixture.posts = [post({ message: "Fall promo" })];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Draft our take/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Draft the post" }));
    await waitFor(() => expect(fixture.inserted).toHaveLength(1));
    expect(fixture.inserted[0].post_date).toBe("2026-11-12");
  });

  it("drafts a topic with no platform for the platform of the posts behind it", async () => {
    const link = "https://www.linkedin.com/posts/peer-1";
    fixture.posts = [post({ channel: "linkedin", postLink: link, message: "Hiring" })];
    fixture.topics = [{ id: "t1", topic: "Hiring push", summary: "Two companies hired.", companies: ["Peer", "Other"], platforms: [], post_urls: [link], confidence: 0.8, status: "open" }];
    mount();
    await screen.findByText("Hiring push");
    fireEvent.click(screen.getAllByRole("button", { name: /Draft our take/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Draft the post" }));
    await waitFor(() => expect(fixture.invoked.some((c) => c.name === "generate-ad-hoc-post")).toBe(true));
    expect(fixture.invoked.find((c) => c.name === "generate-ad-hoc-post")!.body.platform).toBe("LinkedIn");
  });

  it("falls back to the client's own platform when nothing behind the topic names one", async () => {
    fixture.client = { ...fixture.client, primary_platforms: ["tiktok"] };
    fixture.posts = [post({ channel: "instagram" })];
    fixture.topics = [{ id: "t1", topic: "Trend", summary: "", companies: ["Peer", "Other"], platforms: [], post_urls: [], confidence: 0.6, status: "open" }];
    mount();
    await screen.findByText("Trend");
    fireEvent.click(screen.getAllByRole("button", { name: /Draft our take/ })[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Draft the post" }));
    await waitFor(() => expect(fixture.invoked.length).toBeGreaterThan(0));
    expect(fixture.invoked[0].body.platform).toBe("TikTok");
  });
});

describe("company names", () => {
  it("shows the readable name in the filter, the topic chips and the post cards, and still filters by the stored one", async () => {
    fixture.posts = [post({ companyName: "reyeslaw.com", message: "Reyes post" }), post({ companyName: "Other Firm", message: "Other post" })];
    fixture.topics = [{ id: "t1", topic: "Shared", summary: "", companies: ["reyeslaw.com", "Other Firm"], platforms: ["instagram"], post_urls: [], confidence: 0.7, status: "open" }];
    mount();
    expect(await screen.findByRole("button", { name: "Reyes Law" })).toBeInTheDocument();
    expect(screen.queryByText("reyeslaw.com")).toBeNull();
    expect(screen.getAllByText("Reyes Law").length).toBeGreaterThanOrEqual(3);
    fireEvent.click(screen.getByRole("button", { name: "Reyes Law" }));
    expect(screen.getByText("Reyes post")).toBeInTheDocument();
    expect(screen.queryByText("Other post")).toBeNull();
  });
});

describe("reach", () => {
  it("says once that reach is not reported for a network whose posts carry no impressions or views", async () => {
    fixture.posts = [
      post({ channel: "linkedin", message: "Li one" }), post({ channel: "linkedin", message: "Li two" }),
      post({ channel: "instagram", message: "Ig one", estimatedImpressions: 1200 }),
    ];
    mount();
    await screen.findByText("Li one");
    expect(screen.getAllByText(/LinkedIn reach is not reported/)).toHaveLength(1);
    expect(screen.queryByText(/Instagram reach is not reported/)).toBeNull();
  });

  it("says nothing when every network's posts carry reach", async () => {
    fixture.posts = [post({ channel: "linkedin", views: 500, message: "Li one" })];
    mount();
    await screen.findByText("Li one");
    expect(screen.queryByText(/reach is not reported/)).toBeNull();
  });
});

describe("one reach definition for the cards and the note", () => {
  it("a client's own LinkedIn post with impressions next to competitor posts with none: the card shows it, the note says some report none", async () => {
    fixture.posts = [
      post({ channel: "linkedin", message: "Own li", companyName: "Moburst", ownedImpressions: 900 }),
      post({ channel: "linkedin", message: "Peer li" }),
    ];
    mount();
    await screen.findByText("Own li");
    expect(screen.getByText(/900 impr\./)).toBeTruthy();
    expect(screen.getAllByText(/impr\.|views/)).toHaveLength(1);
    expect(screen.getAllByText(/Some LinkedIn posts report no reach/)).toHaveLength(1);
    expect(screen.queryByText(/LinkedIn reach is not reported/)).toBeNull();
  });

  it("a post's estimated impressions and views show as its one reach figure", async () => {
    fixture.posts = [post({ channel: "instagram", message: "Ig est", estimatedImpressions: 1200 })];
    mount();
    await screen.findByText("Ig est");
    expect(screen.getByText(/1,200 est\. impr\./)).toBeTruthy();
    expect(screen.queryByText(/reach is not reported|report no reach/)).toBeNull();
  });
});

describe("topic wording", () => {
  it("asks 'Dismiss this topic?'", async () => {
    fixture.posts = [post({})];
    fixture.topics = [{ id: "t1", topic: "Shared", summary: "", companies: ["A", "B"], platforms: ["instagram"], post_urls: [], confidence: 0.7, status: "open" }];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
    expect(within(dialog).getByText("Dismiss this topic?")).toBeInTheDocument();
  });
});

describe("Refresh now", () => {
  const refreshWith = async (answer: Record<string, unknown>) => {
    fixture.posts = [post({})];
    fixture.answers["refresh-competitor-feed"] = answer;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Refresh now/ }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(fixture.toasts.length).toBe(1));
    return fixture.toasts[0].description || "";
  };

  it("never reports '0 shared topics' for a topic pass that got no answer", async () => {
    const text = await refreshWith({ posts: 2, alerts: 0, topics_not_detected: true });
    expect(text).not.toMatch(/0 shared topics/);
    expect(text).toBe("2 posts from the last week. Shared topics are still being found.");
  });

  it("counts the topics when the pass answered", async () => {
    expect(await refreshWith({ posts: 2, alerts: 1 })).toBe("2 posts from the last week, 1 shared topic detected.");
  });
});

describe("Draft our take, names and order", () => {
  it("asks the writer about companies by their readable names", async () => {
    fixture.posts = [post({ companyName: "reyeslaw.com", message: "Hello" })];
    fixture.topics = [{ id: "t1", topic: "Shared", summary: "", companies: ["reyeslaw.com", "B"], platforms: ["instagram"], post_urls: [], confidence: 0.7, status: "open" }];
    mount();
    const buttons = await screen.findAllByRole("button", { name: /Draft our take/ });
    for (const b of buttons) {
      fireEvent.click(b);
      fireEvent.click(await screen.findByRole("button", { name: "Draft the post" }));
      await waitFor(() => expect(fixture.invoked.some((i) => i.name === "generate-ad-hoc-post")).toBe(true));
      const topic = String(fixture.invoked.filter((i) => i.name === "generate-ad-hoc-post").at(-1)!.body.topic);
      expect(topic).not.toContain("reyeslaw.com");
      fixture.invoked = [];
    }
  });
});
