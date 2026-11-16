import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const st = vi.hoisted(() => ({
  objects: {} as Record<string, string[]>,
  deleted: [] as string[],
  clientRow: {} as Record<string, unknown>,
  deleteError: null as { message: string } | null,
}));

vi.mock("../../functions/_shared/auth/requireStaff.ts", async () => {
  const authz = await import("../../functions/_shared/auth/authz");
  return { AuthzError: authz.AuthzError, requireStaff: async () => ({ userId: "u", viaSecret: true, asCaller: {} }) };
});

// A storage whose list() answers like Supabase's: files carry an id, folders do not.
function listOf(bucket: string, prefix: string) {
  const seen = new Map<string, boolean>();
  for (const p of st.objects[bucket] ?? []) {
    if (!p.startsWith(`${prefix}/`)) continue;
    const rest = p.slice(prefix.length + 1).split("/");
    seen.set(rest[0], rest.length === 1);
  }
  return [...seen].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }));
}

vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: st.clientRow }) }) }),
      delete: () => ({ eq: async () => { st.deleted.push(table); return { error: table === "clients" ? st.deleteError : null }; } }),
    }),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({ data: listOf(bucket, prefix), error: null }),
        remove: async (paths: string[]) => {
          st.objects[bucket] = (st.objects[bucket] ?? []).filter((p) => !paths.includes(p));
          return { error: null };
        },
      }),
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeEach(async () => {
  st.deleted = []; st.deleteError = null;
  st.clientRow = { name: "Bader Law", brand_book_file_path: `${CID}/book.pdf`, strategy_doc_file_path: null, design_references: [], harvested_design_references: [{ path: `${CID}/harvested/a.png` }] };
  st.objects = {
    "generated-media": [`${CID}/brand/logo.png`, `${CID}/2026/11/deep/post.png`, `${OTHER}/keep.png`, "post-thumbnails/v2/shared.jpg"],
    "client-notes": [`${CID}/note.pdf`],
    "brand-books": [`${CID}/book.pdf`, `${OTHER}/book.pdf`],
    "design-references": [`${CID}/harvested/a.png`, `${CID}/candidates/b.png`],
    "report-decks": [`${CID}/r1/deck.pptx`],
    "brand-assets": [`assets/${CID}/x.png`, `previews/${CID}/y.png`, `reads/${CID}/r.json`, `logos/${CID}/l.png`, `assets/${OTHER}/keep.png`, `previews/${OTHER}/keep.png`],
  };
  vi.stubGlobal("Deno", { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } });
  vi.resetModules();
  await import("../../functions/delete-client/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

const del = () => handler(new Request("https://f/d", { method: "POST", body: JSON.stringify({ client_id: CID }) }));

describe("delete-client", () => {
  it("removes files in nested folders of every bucket, and only this client's", async () => {
    const r = await del();
    expect(r.status).toBe(200);
    expect(st.objects["generated-media"]).toEqual([`${OTHER}/keep.png`, "post-thumbnails/v2/shared.jpg"]);
    expect(st.objects["client-notes"]).toEqual([]);
    expect(st.objects["brand-books"]).toEqual([`${OTHER}/book.pdf`]);
    expect(st.objects["design-references"]).toEqual([]);
    expect(st.objects["report-decks"]).toEqual([]);
    // brand-assets keeps files under <kind>/<client id>, not under the id itself.
    expect(st.objects["brand-assets"]).toEqual([`assets/${OTHER}/keep.png`, `previews/${OTHER}/keep.png`]);
  });

  it("also removes this client's files from the client-name folders its stored paths name, and leaves another client's there", async () => {
    st.clientRow = { ...st.clientRow, design_references: ["Bader-Law/" + CID + "-ref1.png"], brand_book_file_path: "Bader-Law/strategy-" + CID + "-doc.pdf" };
    st.objects["design-references"].push(`Bader-Law/${CID}-ref1.png`, `Bader-Law/${CID}-old-upload.png`, `Bader-Law/harvested-${CID}-x.png`, `Bader-Law/${OTHER}-ref.png`);
    st.objects["brand-books"].push(`Bader-Law/strategy-${CID}-doc.pdf`, `Bader-Law/${CID}-book.pdf`, `Bader-Law/${OTHER}-book.pdf`);
    st.objects["generated-media"].push(`Bader Law/${CID}-1.png`, `Bader Law/${OTHER}-1.png`);
    await del();
    expect(st.objects["design-references"]).toEqual([`Bader-Law/${OTHER}-ref.png`]);
    expect(st.objects["brand-books"]).toEqual([`${OTHER}/book.pdf`, `Bader-Law/${OTHER}-book.pdf`]);
    expect(st.objects["generated-media"]).toContain(`Bader Law/${OTHER}-1.png`);
    expect(st.objects["generated-media"]).not.toContain(`Bader Law/${CID}-1.png`);
  });

  it("deletes only the client row and lets the cascades take the rest", async () => {
    await del();
    expect(st.deleted).toEqual(["clients"]);
  });

  it("keeps the files when the client row could not be deleted", async () => {
    st.deleteError = { message: "constraint" };
    const r = await del();
    expect(r.status).toBe(500);
    expect(st.objects["client-notes"]).toEqual([`${CID}/note.pdf`]);
  });
});
