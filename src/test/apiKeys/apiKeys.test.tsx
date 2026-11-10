/* eslint-disable @typescript-eslint/no-explicit-any -- Partial fetch and auth doubles. */
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { StaffOnlyRoute } from "@/components/StaffOnlyRoute";
import { ApiAccessCard } from "@/components/settings/ApiAccessCard";
import { activeNavigationSection } from "@/lib/navigationSection";
import { formatDate } from "@/lib/display";
import ApiKeys from "@/pages/ApiKeys";

// The "Your API keys" screen (plan: .superpowers/sdd/2026-11-09-personal-api-
// keys, task 3): Moburst staff make, see and revoke their own read-only keys
// at /api-keys; a client never reaches it; a new key is shown once; the
// server's words reach the screen only for a name it refused (400) and the
// 10-key limit (409); and the admin card names each key's owner.

const f = vi.hoisted(() => ({ role: "staff" as "admin" | "staff" | "client" }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isLoading: false, isAuthenticated: true,
    isAdmin: f.role === "admin", isMoburstStaff: f.role !== "client", isClient: f.role === "client",
    user: { name: "Neria", email: "neria@moburst.com" }, isGosSession: false,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));
vi.mock("@/lib/quietSend", async (original) => {
  const actual = await original<typeof import("@/lib/quietSend")>();
  // Sent again at once in tests: the waits are the real module's concern.
  return { ...actual, sendQuietly: vi.fn((send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: async () => {} })) };
});

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const now = Date.now();
// Midday, so the dates read the same in every time zone the suite runs in.
const created = new Date(now - 30 * DAY);
created.setUTCHours(12, 0, 0, 0);

const personal = (over: Record<string, unknown>) => ({
  id: "k", name: "Key", key_prefix: "soc_AbCdEfGh", scopes: ["read"],
  created_at: iso(created.getTime()), expires_at: iso(created.getTime() + 90 * DAY), last_used_at: null, revoked_at: null, ...over,
});
const ACTIVE = personal({ id: "k1", name: "Nightly export", key_prefix: "soc_Nightly1", last_used_at: iso(now - 2 * DAY) });
const NEVER = personal({ id: "k2", name: "Board deck", key_prefix: "soc_BoardDk2" });
const EXPIRED = personal({ id: "k3", name: "Old script", key_prefix: "soc_OldScrp3", created_at: iso(created.getTime() - 100 * DAY), expires_at: iso(created.getTime() - 10 * DAY) });
const REVOKED = personal({ id: "k4", name: "Spare", key_prefix: "soc_SpareKy4", revoked_at: iso(now - DAY) });

/** A reply, or "network" for a request whose reply never arrived (fetch rejects). */
type Handler = (method: string, url: string, body: any) => { status: number; body: unknown } | "network" | undefined;
const calls: Array<{ method: string; url: string; body: any; auth: string | undefined }> = [];
let handle: Handler;
function respond(h: Handler) {
  handle = h;
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    const r = handle(method, url, body) ?? { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
    if (r === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}
const list = (data: unknown[]) => ({ status: 200, body: { data, next_cursor: null } });

let qc: QueryClient;
beforeEach(() => {
  f.role = "staff";
  calls.length = 0;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); qc.clear(); });

function mountPage(path = "/api-keys") {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/api-keys" element={<StaffOnlyRoute><ApiKeys /></StaffOnlyRoute>} />
          <Route path="/" element={<p>Dashboard home</p>} />
          <Route path="/auth" element={<p>Sign in</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const sidebarLabels = () => {
  render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
  return screen.getAllByRole("link").map((a) => a.textContent?.trim()).filter(Boolean) as string[];
};

// What clientFacing.test.tsx bans on a client's screen (whole words, any case), plus en dashes and developer words.
const banned = /\bAI\b|\b(prompts?|models?|scores?|pipelines?|gates?)\b|Socialytics -|Rival ?IQ|Sprout|Apify|—|–/i;
const developer = /\b(endpoints?|tokens?|hash(es)?|scopes?|uuids?|api_keys|key_prefix|owner_user_id|null|undefined|jwt|conflict|invalid_request)\b|\bk\d\b/i;
const readsPlainly = () => {
  const text = document.body.textContent ?? "";
  expect(text).not.toMatch(banned);
  expect(text).not.toMatch(developer);
};

describe("who reaches it", () => {
  it("sends a client back to the dashboard and gives them no sidebar entry", async () => {
    f.role = "client";
    respond(() => list([ACTIVE]));
    mountPage();
    expect(await screen.findByText("Dashboard home")).toBeInTheDocument();
    expect(screen.queryByText("Nightly export")).toBeNull();
    expect(calls.filter((c) => c.url.includes("/me/keys"))).toEqual([]);
    cleanup();
    expect(sidebarLabels()).not.toContain("API keys");
  });

  it("is a staff route in the app, beside the other staff routes", () => {
    const app = readFileSync(join(__dirname, "..", "..", "App.tsx"), "utf8");
    expect(app).toContain('<Route path="/api-keys" element={<StaffOnlyRoute><ApiKeys /></StaffOnlyRoute>} />');
  });

  it("gives a Moburst user an API keys entry after Competitive, and an admin one before the admin pages", () => {
    const staff = sidebarLabels();
    expect(staff.indexOf("API keys")).toBe(staff.indexOf("Competitive") + 1);
    expect(screen.getByRole("link", { name: /API keys/ })).toHaveAttribute("href", "/api-keys");
    cleanup();
    f.role = "admin";
    const admin = sidebarLabels();
    expect(admin.indexOf("API keys")).toBe(admin.indexOf("Competitive") + 1);
    expect(admin.indexOf("User analytics")).toBe(admin.indexOf("API keys") + 1);
    expect(activeNavigationSection("/api-keys")).toBe("/api-keys");
  });
});

describe("a staff member's own keys", () => {
  it("lists each key with its name, prefix, dates and a Revoke button only while it works", async () => {
    respond((method, url) => (method === "GET" && url.endsWith("/me/keys") ? list([ACTIVE, NEVER, EXPIRED, REVOKED]) : undefined));
    mountPage();
    const active = (await screen.findByText("Nightly export")).closest("li")!;
    expect(calls[0].url).toMatch(/\/functions\/v1\/api\/v1\/me\/keys$/);
    expect(calls[0].auth).toBe("Bearer jwt");

    expect(within(active).getByText("Starts with soc_Nightly1…")).toBeInTheDocument();
    expect(within(active).getByText(`Created ${formatDate(ACTIVE.created_at)}`)).toBeInTheDocument();
    expect(within(active).getByText(`Expires ${formatDate(ACTIVE.expires_at)}`)).toBeInTheDocument();
    expect(within(active).getByText(`Last used ${formatDate(ACTIVE.last_used_at)}`)).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Revoke Nightly export" })).toBeInTheDocument();

    const never = screen.getByText("Board deck").closest("li")!;
    expect(within(never).getByText("Never used")).toBeInTheDocument();
    expect(within(never).getByRole("button", { name: "Revoke Board deck" })).toBeInTheDocument();

    const expired = screen.getByText("Old script").closest("li")!;
    expect(within(expired).getByText(`Expired ${formatDate(EXPIRED.expires_at)}`)).toBeInTheDocument();
    expect(within(expired).getByText("Expired", { selector: "[data-state-badge]" })).toBeInTheDocument();
    expect(within(expired).queryByRole("button", { name: /revoke/i })).toBeNull();

    const revoked = screen.getByText("Spare").closest("li")!;
    expect(within(revoked).getByText(`Revoked ${formatDate(REVOKED.revoked_at)}`)).toBeInTheDocument();
    expect(within(revoked).getByText("Revoked", { selector: "[data-state-badge]" })).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: /revoke/i })).toBeNull();

    // Two of the four still work.
    expect(screen.getByText("2 of 10 active")).toBeInTheDocument();
    expect(screen.getByText(/sees what you see/i)).toBeInTheDocument();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
    expect(screen.getByText(/90 days/)).toBeInTheDocument();
    readsPlainly();
  });

  it("says so when there are no keys yet", async () => {
    respond(() => list([]));
    mountPage();
    expect(await screen.findByText("No keys yet")).toBeInTheDocument();
    readsPlainly();
  });

  it("keeps loading quietly when the keys do not load, and never shows the server's words", async () => {
    respond(() => ({ status: 500, body: { error: { code: "internal", message: "relation api_keys does not exist" } } }));
    mountPage();
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(await screen.findByRole("status")).toHaveTextContent(/loading your keys/i);
    expect(screen.queryByText(/relation|does not exist/)).toBeNull();
    expect(screen.queryByText("No keys yet")).toBeNull();
  });
});

describe("making a key", () => {
  const PLAIN = "soc_NewKey99_the_rest_of_the_secret_shown_only_once";
  const NEW = personal({ id: "k9", name: "Reporting script", key_prefix: "soc_NewKey99" });

  async function openAndCreate(name: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  }

  it("shows the new key once with Copy, then only its prefix once the dialog is closed", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    let made = false;
    respond((method, url, body) => {
      if (method === "POST" && url.endsWith("/me/keys")) { made = true; return { status: 201, body: { data: { ...NEW, name: body.name, key: PLAIN } } }; }
      if (method === "GET" && url.endsWith("/me/keys")) return list(made ? [NEW, ACTIVE] : [ACTIVE]);
      return undefined;
    });
    mountPage();
    await openAndCreate("  Reporting script  ");

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(PLAIN)).toBeInTheDocument();
    expect(within(dialog).getByText("Copy this key now. You won't see it again.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ name: "Reporting script" });
    readsPlainly();

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PLAIN));
    expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const row = (await screen.findByText("Reporting script")).closest("li")!;
    expect(within(row).getByText("Starts with soc_NewKey99…")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PLAIN);
    // The plaintext is kept nowhere once the dialog is closed, the query cache included.
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(PLAIN);
    expect(JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(PLAIN);
  });

  it("shows the 10-key limit as the server words it, and keeps the name", async () => {
    respond((method, url) => {
      if (method === "POST") return { status: 409, body: { error: { code: "conflict", message: "You have 10 active keys. Revoke one to make another." } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([ACTIVE]);
      return undefined;
    });
    mountPage();
    await openAndCreate("Eleventh");
    expect(await screen.findByText("You have 10 active keys. Revoke one to make another.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Eleventh");
    expect(screen.queryByText(/Copy this key now/)).toBeNull();
    readsPlainly();
  });

  it("shows why a name was refused", async () => {
    respond((method, url) => {
      if (method === "POST") return { status: 400, body: { error: { code: "invalid_request", message: "Give the key a name of 1 to 80 characters." } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([]);
      return undefined;
    });
    mountPage();
    await openAndCreate("x".repeat(81));
    expect(await screen.findByText("Give the key a name of 1 to 80 characters.")).toBeInTheDocument();
  });

  it("says no key yet for anything else, never the server's own words", async () => {
    respond((method, url) => {
      if (method === "POST") return { status: 500, body: { error: { code: "internal", message: "insert failed: duplicate key value violates unique constraint" } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([]);
      return undefined;
    });
    mountPage();
    await openAndCreate("Reporting script");
    expect(await screen.findByText("No key yet. The name you typed is kept.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Reporting script");
    expect(screen.queryByText(/insert failed|duplicate|constraint/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a new key whose reply is lost, rate limited, or shown once", () => {
  const PLAIN = "soc_LostKey7_the_rest_of_the_secret_shown_only_once";
  const LOST = personal({ id: "k7", name: "Reporting script", key_prefix: "soc_LostKey7" });
  const posts = () => calls.filter((c) => c.method === "POST").length;
  const reads = () => calls.filter((c) => c.method === "GET" && c.url.endsWith("/me/keys")).length;

  async function create(name: string) {
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
  }

  it.each([
    ["no reply at all", "network" as const],
    ["a gateway's reply (502)", { status: 502, body: { message: "Bad gateway" } }],
  ])("after %s, never sends the key again: reads the list again and says to check it first", async (_what, lost) => {
    // The server made the key; only its reply was lost.
    let made = false;
    respond((method, url) => {
      if (method === "POST") { made = true; return lost; }
      if (method === "GET" && url.endsWith("/me/keys")) return list(made ? [LOST, ACTIVE] : [ACTIVE]);
      return undefined;
    });
    mountPage();
    await screen.findByText("Nightly export");
    const readsBefore = reads();
    await create("Reporting script");

    expect(await screen.findByText("We couldn't confirm the new key. Check your keys below before making another.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The key the server did make is in the list, by its prefix only.
    const row = (await screen.findByText("Reporting script")).closest("li")!;
    expect(within(row).getByText("Starts with soc_LostKey7…")).toBeInTheDocument();
    expect(reads()).toBeGreaterThan(readsBefore);
    expect(posts()).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Bad gateway|Failed to fetch|try again|refresh/i);
    readsPlainly();
  });

  it("sends again after a rate limit, which made nothing, and shows the key once", async () => {
    let tries = 0;
    respond((method, url, body) => {
      if (method === "POST") {
        tries++;
        if (tries === 1) return { status: 429, body: { error: { code: "rate_limited", message: "Too many requests" } } };
        return { status: 201, body: { data: { ...LOST, name: body.name, key: PLAIN } } };
      }
      if (method === "GET" && url.endsWith("/me/keys")) return list([]);
      return undefined;
    });
    mountPage();
    await create("Reporting script");
    expect(await within(await screen.findByRole("dialog")).findByText(PLAIN)).toBeInTheDocument();
    expect(posts()).toBe(2);
    expect(screen.queryByText(/Too many requests/)).toBeNull();
  });

  it("keeps the shown-once key through Escape and the corner close, until Done", async () => {
    respond((method, url, body) => {
      if (method === "POST") return { status: 201, body: { data: { ...LOST, name: body.name, key: PLAIN } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([]);
      return undefined;
    });
    mountPage();
    await create("Reporting script");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(PLAIN)).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByText(PLAIN)).toBeInTheDocument();

    // The corner close is hidden while the key is shown (jsdom has no stylesheet, so it is
    // still in the tree here), and pressing it anyway changes nothing.
    expect(dialog.className).toContain("[&>button]:hidden");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByText(PLAIN)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain(PLAIN);
  });

  it("leaves the end date out of the sentence when a key has none", async () => {
    respond((method, url, body) => {
      if (method === "POST") return { status: 201, body: { data: { ...LOST, expires_at: null, name: body.name, key: PLAIN } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([]);
      return undefined;
    });
    mountPage();
    await create("Reporting script");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("It sees what you see in Socialytics and is read only.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/stops working on|on \./);
  });
});

describe("revoking a key", () => {
  it("asks first, then shows the key as revoked with no Revoke button", async () => {
    const revokedAt = iso(now);
    let revoked = false;
    respond((method, url) => {
      if (method === "DELETE" && url.endsWith("/me/keys/k1")) { revoked = true; return { status: 200, body: { data: { id: "k1", revoked_at: revokedAt } } }; }
      if (method === "GET" && url.endsWith("/me/keys")) return list([revoked ? { ...ACTIVE, revoked_at: revokedAt } : ACTIVE, NEVER]);
      return undefined;
    });
    mountPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Nightly export" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Revoke Nightly export?")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    readsPlainly();

    fireEvent.click(within(confirm).getByRole("button", { name: "Yes, revoke" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/me/keys/k1"))).toBe(true));
    const row = (await screen.findByText(`Revoked ${formatDate(revokedAt)}`)).closest("li")!;
    expect(within(row).getByText("Nightly export")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /revoke/i })).toBeNull();
    expect(screen.getByText("1 of 10 active")).toBeInTheDocument();
  });

  it("keeps a key that was not revoked as it is, and says so plainly", async () => {
    respond((method, url) => {
      if (method === "DELETE") return { status: 500, body: { error: { code: "internal", message: "update failed" } } };
      if (method === "GET" && url.endsWith("/me/keys")) return list([ACTIVE]);
      return undefined;
    });
    mountPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Nightly export" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Yes, revoke" }));
    expect(await screen.findByText("Nightly export is not revoked yet.")).toBeInTheDocument();
    // Revoking twice answers the first revoke, so a server failure was sent again before saying so.
    expect(calls.filter((c) => c.method === "DELETE").length).toBe(4);
    expect(screen.getByRole("button", { name: "Revoke Nightly export" })).toBeInTheDocument();
    expect(screen.queryByText(/update failed/)).toBeNull();
  });
});

describe("the admin card", () => {
  it("names each key's owner: the person for a personal key, Tool for a tool key", async () => {
    f.role = "admin";
    const tool = { id: "t1", name: "gOS", key_prefix: "soc_AbCdEfGh", scopes: ["read", "demo"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_at: iso(now), expires_at: null, last_used_at: null, revoked_at: null, note: null, owner_user_id: null, owner_email: null };
    const mine = { ...tool, id: "p1", name: "Neria's script", key_prefix: "soc_NeriaKy1", scopes: ["read"], expires_at: iso(now + 90 * DAY), owner_user_id: "u1", owner_email: "neria@moburst.com" };
    const gone = { ...mine, id: "p2", name: "Left the team", owner_user_id: "u2", owner_email: null };
    respond((method, url) => (url.endsWith("/admin/keys") ? list([tool, mine, gone]) : undefined));
    render(<QueryClientProvider client={qc}><ApiAccessCard clientSlugs={[]} /></QueryClientProvider>);

    const toolRow = (await screen.findByText("gOS")).closest("li")!;
    expect(within(toolRow).getByText("Owner")).toBeInTheDocument();
    expect(within(toolRow).getByText("Tool")).toBeInTheDocument();
    expect(within(toolRow).getByText("All clients")).toBeInTheDocument();

    const mineRow = screen.getByText("Neria's script").closest("li")!;
    expect(within(mineRow).getByText("neria@moburst.com")).toBeInTheDocument();
    expect(within(mineRow).getByText("Owner's access")).toBeInTheDocument();
    expect(within(mineRow).queryByText("All clients")).toBeNull();

    const goneRow = screen.getByText("Left the team").closest("li")!;
    expect(within(goneRow).getByText("Unknown")).toBeInTheDocument();
    expect(within(goneRow).getByText("Owner's access")).toBeInTheDocument();
    // An admin can still revoke anyone's key here.
    expect(within(mineRow).getByRole("button", { name: "Revoke Neria's script" })).toBeInTheDocument();
  });
});
