import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "../../functions/_shared/auth/authz";

const st = vi.hoisted(() => ({ canWrite: true, signedIn: true, uploads: [] as string[], buckets: [] as string[] }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

vi.mock("../../functions/_shared/auth/requireStaff.ts", async () => {
  const authz = await import("../../functions/_shared/auth/authz");
  return {
    AuthzError: authz.AuthzError,
    requireStaff: async (_req: Request, opts: { writeClientId?: string } = {}) => {
      if (!st.signedIn) throw new authz.AuthzError(401, "Sign in to continue.");
      if (opts.writeClientId && opts.writeClientId !== A) throw new authz.AuthzError(403, "You do not have access to this client.");
      return { userId: "u1" };
    },
  };
});
vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    storage: {
      createBucket: async (n: string) => { st.buckets.push(n); return { error: null }; },
      from: () => ({
        upload: async (p: string) => { st.uploads.push(p); return { error: null }; },
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://store.example/${p}` } }),
      }),
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
const send = vi.fn();

beforeEach(async () => {
  st.uploads = []; st.buckets = []; st.signedIn = true; send.mockReset();
  vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://proj.supabase.co" : "k") }, serve: (h: typeof handler) => { handler = h; } });
  vi.stubGlobal("fetch", send);
  if (!AbortSignal.timeout) (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
  // Imported once: the module registers its handler on first import, and a reset would give the handler a different AuthzError class than the mocked guard throws.
  if (!handler) await import("../../functions/upload-generated-media/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

const ask = (body: Record<string, unknown>) => handler(new Request("https://f/u", { method: "POST", body: JSON.stringify(body) }));
void AuthzError;

describe("upload-generated-media", () => {
  it("answers 403 for staff without write access to the named client", async () => {
    const r = await ask({ client_id: B, media_data: "data:image/png;base64,AAAA", media_type: "image" });
    expect(r.status).toBe(403);
    expect(st.uploads).toEqual([]);
  });

  it("answers 401 to a caller who is not signed in, before reading the body", async () => {
    st.signedIn = false;
    expect((await ask({})).status).toBe(401);
    expect((await ask({ client_id: "unknown", media_data: "x" })).status).toBe(401);
    expect(st.uploads).toEqual([]);
  });

  it("refuses a client_id that is not a uuid", async () => {
    const r = await ask({ client_id: "../" + A, media_data: "data:image/png;base64,AAAA" });
    expect(r.status).toBe(400);
  });

  it("refuses a private address before any fetch", async () => {
    const r = await ask({ client_id: A, media_data: "http://169.254.169.254/", media_type: "video" });
    expect(r.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a host that is not one the generators return", async () => {
    const r = await ask({ client_id: A, media_data: "https://example.org/a.mp4", media_type: "video" });
    expect(r.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("fetches from the project's own storage and checks redirects", async () => {
    send.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/x" } }));
    const r = await ask({ client_id: A, media_data: "https://proj.supabase.co/storage/v1/object/public/generated-media/a.mp4", media_type: "video" });
    expect(r.status).toBe(400);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stores an allowed file under the client's folder with a safe name", async () => {
    send.mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { "content-type": "video/mp4" } }));
    const r = await ask({ client_id: A, media_data: "https://proj.supabase.co/storage/v1/object/public/generated-media/a.mp4", media_type: "video", file_name: "../" + B + "/x" });
    expect(r.status).toBe(200);
    expect(st.uploads[0].startsWith(`${A}/`)).toBe(true);
    expect(st.uploads[0]).not.toContain("..");
    expect(st.uploads[0].split("/")).toHaveLength(2);
  });

  it("never creates a bucket", async () => {
    await ask({ client_id: A, media_data: "data:image/png;base64,AAAA" });
    expect(st.buckets).toEqual([]);
  });
});
