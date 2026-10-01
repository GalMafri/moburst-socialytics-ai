import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiAccessCard } from "./ApiAccessCard";

const keys = [
  { id: "k1", name: "gOS", key_prefix: "soc_AbCdEfGh", scopes: ["read", "demo"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_at: "2026-09-30T10:00:00.000Z", expires_at: null, last_used_at: "2026-09-30T11:00:00.000Z", revoked_at: null, note: null },
  { id: "k2", name: "Bader agent", key_prefix: "soc_ZyXwVuTs", scopes: ["read"], company_slugs: ["bader-law"], client_ids: null, rate_limit_per_minute: 60, created_at: "2026-09-29T10:00:00.000Z", expires_at: null, last_used_at: null, revoked_at: null, note: null },
];

const calls: Array<{ url: string; init?: RequestInit }> = [];
function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const body = handler(u, init);
    return new Response(body === null ? null : JSON.stringify(body), { status: body === null ? 204 : (init?.method === "POST" ? 201 : 200), headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ApiAccessCard clientSlugs={["bader-law", "tilt-app"]} /></QueryClientProvider>);
}

describe("ApiAccessCard", () => {
  beforeEach(() => { calls.length = 0; });

  it("shows the live key count and one row per key with its scopes and reach", async () => {
    mockFetch(() => ({ data: keys, next_cursor: null }));
    renderCard();
    expect(await screen.findByText("gOS")).toBeInTheDocument();
    expect(screen.getByTestId("api-keys-count")).toHaveTextContent("2");
    expect(screen.getByText("soc_AbCdEfGh…")).toBeInTheDocument();
    expect(screen.getAllByText("read")).toHaveLength(2);
    expect(screen.getByText("bader-law")).toBeInTheDocument();
    expect(screen.getByText("All clients")).toBeInTheDocument();
    expect(calls[0].url).toMatch(/\/functions\/v1\/api\/v1\/admin\/keys$/);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("creates a key with the chosen scopes and companies and shows it once", async () => {
    mockFetch((url, init) => (init?.method === "POST" ? { data: { ...keys[0], id: "k3", name: "New", key: "soc_NEWKEY_value_that_is_shown_once_only_43chars", warning: "Copy the key now; it is not shown again." } } : { data: [], next_cursor: null }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /create key/i }));
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "New" } });
    fireEvent.click(screen.getByLabelText(/demo/i));
    fireEvent.click(screen.getByRole("button", { name: /bader-law/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(await screen.findByText("soc_NEWKEY_value_that_is_shown_once_only_43chars")).toBeInTheDocument();
    expect(screen.getByText(/not shown again/i)).toBeInTheDocument();
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(post.init!.body as string)).toEqual({ name: "New", scopes: ["read", "demo"], company_slugs: ["bader-law"], expires_at: null });
  });

  it("revokes a key after confirmation", async () => {
    mockFetch((url, init) => (init?.method === "DELETE" ? null : { data: keys, next_cursor: null }));
    renderCard();
    fireEvent.click((await screen.findAllByRole("button", { name: /revoke/i }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: /yes, revoke/i }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "DELETE" && c.url.endsWith("/admin/keys/k1"))).toBe(true));
  });

  it("says so when there are no keys", async () => {
    mockFetch(() => ({ data: [], next_cursor: null }));
    renderCard();
    expect(await screen.findByText(/no keys yet/i)).toBeInTheDocument();
  });
});
