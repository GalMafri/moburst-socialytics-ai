// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND_BOOK_MAX_BYTES } from "../../functions/_shared/brand/brandBookLimits";

const st = vi.hoisted(() => ({
  files: {} as Record<string, Uint8Array>,
  publicUrlAsked: 0,
  openai: [] as Array<{ messages: Array<{ content: unknown }> }>,
}));

vi.mock("../../functions/_shared/auth/requireStaff.ts", () => ({ staffGate: async () => null }));
vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        getPublicUrl: () => { st.publicUrlAsked++; return { data: { publicUrl: "https://x/storage/v1/object/public/brand-books/a" } }; },
        download: async (p: string) => (st.files[p] ? { data: new Blob([st.files[p]]), error: null } : { data: null, error: { message: "missing" } }),
      }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  st.files = {}; st.publicUrlAsked = 0; st.openai = [];
  vi.stubGlobal("Deno", { env: { get: () => "key" }, serve: (h: typeof handler) => { handler = h; } });
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    st.openai.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"primary_color":"#112233"}' } }] }));
  });
  vi.resetModules();
  await import("../../functions/extract-brand-from-file/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

const call = (file_path: string) => handler(new Request("https://f/x", { method: "POST", body: JSON.stringify({ file_path, bucket: "brand-books", client_name: "Bader Law" }) }));
const parts = () => st.openai[0].messages[1].content as Array<Record<string, unknown>>;

describe("extract-brand-from-file", () => {
  it("sends an image from a download, never from a public address", async () => {
    st.files["Bader/logo.png"] = new Uint8Array([1, 2, 3]);
    const r = await call("Bader/logo.png");
    expect(r.status).toBe(200);
    expect(st.publicUrlAsked).toBe(0);
    expect(JSON.stringify(st.openai[0])).not.toContain("/object/public/");
    expect((parts()[1].image_url as { url: string }).url).toMatch(/^data:image\/png;base64,/);
  });

  it("accepts a 6 MB PDF and sends it as a document, never as an image", async () => {
    st.files["Bader/book.pdf"] = new Uint8Array(6 * 1024 * 1024).fill(7);
    const r = await call("Bader/book.pdf");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ brand_identity: { primary_color: "#112233" } });
    const doc = parts()[1] as { type: string; file?: { file_data: string }; image_url?: unknown };
    expect(doc.type).toBe("file");
    expect(doc.file!.file_data).toMatch(/^data:application\/pdf;base64,/);
    expect(JSON.stringify(st.openai[0])).not.toContain("image_url");
  });

  it("reads files up to the one shared limit and says which limit stopped a bigger one", async () => {
    st.files["Bader/big.pdf"] = new Uint8Array(BRAND_BOOK_MAX_BYTES + 1);
    const r = await call("Bader/big.pdf");
    expect(await r.json()).toEqual({ brand_identity: null, not_read: "too_large" });
    expect(st.openai).toEqual([]);
  });

  it("says which file type it does not read", async () => {
    st.files["Bader/book.docx"] = new Uint8Array([1]);
    const r = await call("Bader/book.docx");
    expect(await r.json()).toEqual({ brand_identity: null, not_read: "type" });
    expect(st.openai).toEqual([]);
  });
});
