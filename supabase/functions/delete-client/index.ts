// Hard-deletes a client and everything hanging off it.
//
// Every function here runs with verify_jwt = false, so this one authenticates
// its own caller. It shipped without that check: the id of a client was
// enough to erase it. Hard delete is admin-only by the same written decision
// that keeps staff to archiving (migration 20260505000001), so the guard is
// staff-with-write-access AND admin.

import { createClient } from "../_shared/supabase.ts";
import { requireStaff, AuthzError } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Every bucket that keeps a client's files, with the folders a client's files
// live under (each one is the folder name plus the client's id). Most buckets
// keep them straight under the id; brand-assets groups them by kind first
// (assets/<id>, reads/<id>, previews/<id>, logos/<id>). The one list: a new
// bucket of client files is added here and nowhere else.
const CLIENT_BUCKETS: Record<string, string[]> = {
  "generated-media": [""],
  "design-references": [""],
  "brand-books": [""],
  "brand-assets": ["assets/", "reads/", "previews/", "logos/"],
  "client-notes": [""],
  "report-decks": [""],
  "post-footage": [""],
};

/** One entry of a storage listing: a file carries an id, a folder does not. */
type StoredEntry = { id?: string | null; name: string };

/** The part of the storage client used here. */
type StorageClient = {
  storage: {
    from(bucket: string): {
      list(folder: string, opts: { limit: number; offset: number }): PromiseLike<{ data: StoredEntry[] | null; error: { message: string } | null }>;
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

const PAGE = 100;
const MAX_DEPTH = 8;

/** Remove every object under a folder of a bucket, folders inside folders included. Failures are logged, never fatal: the rows are already gone. */
async function removeTree(storage: StorageClient, bucket: string, folder: string, depth = 0): Promise<void> {
  if (depth > MAX_DEPTH) return;
  try {
    for (let pass = 0; pass < 50; pass++) {
      // Always the first page: what was listed is removed, so the next page starts there.
      const { data, error } = await storage.storage.from(bucket).list(folder, { limit: PAGE, offset: 0 });
      if (error) { console.warn(`[delete-client] could not list ${bucket}/${folder}: ${error.message}`); return; }
      const entries = (data ?? []).filter((o: StoredEntry) => o.name);
      if (!entries.length) return;
      // An entry with no id is a folder.
      const files = entries.filter((o: StoredEntry) => o.id).map((o: StoredEntry) => `${folder}/${o.name}`);
      for (const sub of entries.filter((o: StoredEntry) => !o.id)) await removeTree(storage, bucket, `${folder}/${sub.name}`, depth + 1);
      if (files.length) {
        const { error: rmErr } = await storage.storage.from(bucket).remove(files);
        if (rmErr) { console.warn(`[delete-client] could not remove ${files.length} objects from ${bucket}/${folder}: ${rmErr.message}`); return; }
      }
      if (entries.length < PAGE) return;
    }
  } catch (e) {
    console.warn(`[delete-client] storage cleanup of ${bucket}/${folder} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Onboarding uploads go to a folder named after the client (<Name>/<id>-...),
 * not under its id, and the row stops listing some of them. In each such
 * folder, remove only the files whose name carries this client's id, so a
 * folder shared with another client is never swept blindly.
 */
async function removeIdNamedFiles(storage: StorageClient, bucket: string, folder: string, clientId: string): Promise<void> {
  try {
    const mine = [`${clientId}-`, `strategy-${clientId}-`, `harvested-${clientId}`];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await storage.storage.from(bucket).list(folder, { limit: PAGE, offset });
      if (error) { console.warn(`[delete-client] could not list ${bucket}/${folder}: ${error.message}`); return; }
      const entries = data ?? [];
      const files = entries.filter((o: StoredEntry) => o.id && mine.some((m) => o.name.startsWith(m))).map((o: StoredEntry) => `${folder}/${o.name}`);
      if (files.length) {
        const { error: rmErr } = await storage.storage.from(bucket).remove(files);
        if (rmErr) { console.warn(`[delete-client] could not remove ${files.length} objects from ${bucket}/${folder}: ${rmErr.message}`); return; }
        // Removed entries shift the listing: read this page again.
        offset -= files.length;
      }
      if (entries.length < PAGE) return;
    }
  } catch (e) {
    console.warn(`[delete-client] name-folder cleanup of ${bucket}/${folder} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authenticate before touching anything, including before looking the
    // client up: an unauthenticated caller learns nothing, not even whether
    // the id exists.
    const caller = await requireStaff(req, { writeClientId: client_id });
    // The project's own server calls (the api's discard of a demo client) count as admin.
    const { data: isAdmin, error: adminErr } = caller.viaSecret ? { data: true, error: null } : await caller.asCaller.rpc("is_admin");
    if (adminErr) throw new Error(`Access check failed: ${adminErr.message}`);
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Deleting a client permanently is an admin action. You can archive it instead." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get client info for storage cleanup
    const { data: client } = await supabase
      .from("clients")
      .select("name, brand_book_file_path, strategy_doc_file_path, design_references, harvested_design_references")
      .eq("id", client_id)
      .single();

    // Only the client row is deleted: every table that hangs off a client
    // cascades from it, so nothing is listed here that a new table could be
    // missing from.
    // Checked: an unchecked refused delete still returned success, so the
    // client vanished from the UI on the refetch and came back on the next load.
    const { error: clientDeleteError } = await supabase.from("clients").delete().eq("id", client_id);
    if (clientDeleteError) {
      console.error("[delete-client] delete failed:", clientDeleteError.message);
      return new Response(
        JSON.stringify({
          error: "The client could not be deleted.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Clean up storage: the files the row names, then everything under the
    // client's folder in every bucket of client files.
    const storedPaths = (bucket: string): string[] => {
      const c = client as Record<string, unknown> | null;
      if (bucket === "brand-books") return [c?.brand_book_file_path, c?.strategy_doc_file_path].filter((p): p is string => typeof p === "string" && !!p);
      if (bucket === "design-references") {
        const harvested = Array.isArray(c?.harvested_design_references) ? (c!.harvested_design_references as Array<{ path?: string }>).map((r) => r?.path) : [];
        const own = Array.isArray(c?.design_references) ? (c!.design_references as unknown[]) : [];
        return [...own, ...harvested].filter((p): p is string => typeof p === "string" && !!p);
      }
      return [];
    };
    for (const [bucket, prefixes] of Object.entries(CLIENT_BUCKETS)) {
      const named = storedPaths(bucket);
      if (named.length) await supabase.storage.from(bucket).remove(named).catch(() => null);
      for (const prefix of prefixes) await removeTree(supabase, bucket, `${prefix}${client_id}`);
      // The name folders: the ones the stored paths name, plus the client's own name.
      const name = typeof (client as Record<string, unknown> | null)?.name === "string" ? String((client as Record<string, unknown>).name) : "";
      const folders = new Set<string>(named.map((p) => p.split("/").slice(0, -1).join("/")).filter((d) => d && d.split("/")[0] !== client_id));
      if (name && prefixes.includes("")) { folders.add(name); folders.add(name.replace(/[^A-Za-z0-9_-]+/g, "-")); }
      for (const folder of folders) await removeIdNamedFiles(supabase, bucket, folder, client_id);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    if (error instanceof AuthzError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("Error deleting client:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
