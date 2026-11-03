// supabase/functions/client-notes/index.ts
//
// Client notes: what staff add so every post follows what the client told
// the team (docs/superpowers/specs/2026-11-02-client-notes-import-design.md).
// Staff with write access to the client only. Every action can be sent twice
// with the same result, so the screen sends again quietly.
//
//   POST {action:"add_text", client_id, note_id, text, date?}
//        a typed note (at most 20,000 characters). note_id is made by the
//        screen, so a resend never adds it twice. date: the meeting's day;
//        without it the note is dated today and may take a date its text gives
//   POST {action:"add_files", client_id, files:[{path, name}], date?}
//        files already uploaded to the client-notes bucket at
//        {client_id}/{fileKey}, up to 50; each becomes its own note, and the
//        same file is stored and read once
//   POST {action:"set_date", note_id, date}
//        a person's date for a note; it beats any date the reading found,
//        and the note's points follow it
//   POST {action:"remove_note", note_id}
//        the note, its file, its points and their links, for good; copy
//        already written stays as it is
//   POST {action:"remove_point", point_id}
//        one point stops counting for anything
//
// Adding queues the client's notes_read job (run-scheduled-jobs,
// _shared/notes/run.ts), which reads the notes one at a time.

import { createClient } from "../_shared/supabase.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { clipText } from "../_shared/text/clip.ts";
import { isNotePath, noteFileType, todayIn, validNoteDate, NOTE_FILES_AT_ONCE, NOTES_BUCKET } from "../_shared/notes/notes.ts";
import { addTextNote, noteWrites } from "../_shared/notes/add.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function must<T = unknown>(p: PromiseLike<{ data?: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data as T;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "add_text") {
      const clientId = String(body.client_id || "");
      if (!UUID.test(clientId)) return json({ error: "client_id is required." }, 400);
      const caller = await requireStaff(req, { writeClientId: clientId });
      // The one path for a typed note, the app's and Claude's (_shared/notes/add.ts).
      const added = await addTextNote(noteWrites(admin), { clientId, noteId: body.note_id, text: body.text, date: body.date, source: "app", userId: caller.userId, now: new Date() });
      if (!added.ok) return json({ error: added.error }, added.status);
      return json({ ok: true, added: added.added ? 1 : 0 }, 202);
    }

    if (action === "add_files") {
      const clientId = String(body.client_id || "");
      if (!UUID.test(clientId)) return json({ error: "client_id is required." }, 400);
      const caller = await requireStaff(req, { writeClientId: clientId });
      const writes = noteWrites(admin);
      const client = await writes.client(clientId);
      if (!client) return json({ error: "No such client." }, 404);
      const today = todayIn(String(client.timezone || "UTC"), new Date());
      const date = body.date ? validNoteDate(body.date, today) : null;
      if (body.date && !date) return json({ error: "date must be a day no later than tomorrow (YYYY-MM-DD)." }, 400);
      const by = { added_by: caller.userId, added_by_name: await writes.authorName(caller.userId) };
      // A date a person gave beats any date the reading finds; the day it was added does not.
      const dated = { note_date: date ?? today, date_set_by: date ? "person" : "app" };
      const files = (Array.isArray(body.files) ? body.files : []).slice(0, NOTE_FILES_AT_ONCE) as Array<{ path?: unknown; name?: unknown }>;
      const rows = files.filter((f) => isNotePath(clientId, String(f?.path ?? ""))).map((f) => ({
        client_id: clientId, kind: "file", title: clipText(String(f.name || f.path).trim(), 200), file_path: String(f.path), file_type: noteFileType(String(f.path)), ...dated, ...by,
      }));
      if (!rows.length) return json({ error: "files must hold the paths of uploaded note files." }, 400);
      // The same file dropped twice is stored and read once.
      const inserted = await must<Array<{ id: string }>>(admin.from("client_notes").upsert(rows, { onConflict: "client_id,file_path", ignoreDuplicates: true }).select("id"), "Could not add the files");
      await writes.queueRead(clientId);
      return json({ ok: true, added: inserted?.length ?? 0 }, 202);
    }

    if (action === "set_date" || action === "remove_note") {
      const noteId = String(body.note_id || "");
      if (!UUID.test(noteId)) return json({ error: "note_id is required." }, 400);
      const { data: note } = await admin.from("client_notes").select("id, client_id, file_path").eq("id", noteId).maybeSingle();
      // Already removed: what was asked for is true.
      if (!note) return action === "remove_note" ? json({ ok: true }) : json({ error: "No such note." }, 404);
      await requireStaff(req, { writeClientId: note.client_id });
      if (action === "set_date") {
        const { data: client } = await admin.from("clients").select("timezone").eq("id", note.client_id).maybeSingle();
        const date = validNoteDate(body.date, todayIn(String(client?.timezone || "UTC"), new Date()));
        if (!date) return json({ error: "date must be a day no later than tomorrow (YYYY-MM-DD)." }, 400);
        await must(admin.from("client_notes").update({ note_date: date, date_set_by: "person", updated_at: new Date().toISOString() }).eq("id", noteId), "Could not date the note");
        return json({ ok: true });
      }
      // The file first: a removal that stops between the two is sent again and finds the file gone.
      if (note.file_path) await must(admin.storage.from(NOTES_BUCKET).remove([note.file_path]), "Could not remove the note's file");
      await must(admin.from("client_notes").delete().eq("id", noteId), "Could not remove the note");
      return json({ ok: true });
    }

    if (action === "remove_point") {
      const pointId = String(body.point_id || "");
      if (!UUID.test(pointId)) return json({ error: "point_id is required." }, 400);
      const { data: point } = await admin.from("client_note_points").select("id, client_id").eq("id", pointId).maybeSingle();
      if (!point) return json({ ok: true });
      const caller = await requireStaff(req, { writeClientId: point.client_id });
      await must(admin.from("client_note_points").update({ removed_at: new Date().toISOString(), removed_by: caller.userId }).eq("id", pointId).is("removed_at", null), "Could not remove the point");
      return json({ ok: true });
    }

    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[client-notes]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
