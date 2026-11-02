// Client setup, Brief tab, "Client notes" (client notes design, 2 Nov 2026:
// docs/superpowers/specs/2026-11-02-client-notes-import-design.md). Staff add
// what the client told them: a typed note with its date, or files (meeting
// notes, feedback, the files of the client's Claude project), many at once or
// a whole folder. The notes_read job reads each one into points, and every
// post the app writes follows the points in use: "What the copy follows now"
// shows exactly the selection the writers get (_shared/notes/notes.ts).
//
// Quiet throughout: uploads go up with quiet retries (uploadQuietly, as
// useQuietUpload does, keeping every file that has not gone up rather than
// one), actions are sent with sendQuietly, and the screen shows the true
// state: Reading, points learned, nothing for the copy, or not saved yet.
// Staff only; the tables and the bucket allow staff with write access.

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/ui/section";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fileKey } from "@/hooks/useQuietUpload";
import { invokeResendable, sendQuietly, uploadQuietly } from "@/lib/quietSend";
import { formatDate, noteReadLine, notePointKindName, noteStateLine, platformName } from "@/lib/display";
import {
  noteFileType, pointStates, pointsInUse, readNoteRows, selectForPrompt, todayIn,
  NOTE_FILE_MAX_BYTES, NOTE_FILES, NOTE_FILES_AT_ONCE, NOTE_TEXT_MAX, NOTES_BUCKET, POINT_KINDS,
  type DatedPoint, type PointState,
} from "../../../supabase/functions/_shared/notes/notes.ts";
import { NOTE_READ_MAX_CHARS } from "../../../supabase/functions/_shared/notes/read.ts";

interface NoteItem {
  id: string;
  title: string;
  note_date: string;
  state: string;
  text_chars: number | null;
  added_by_name: string | null;
  created_at: string;
}

const ACCEPT = Object.keys(NOTE_FILES).map((ext) => `.${ext}`).join(",");
const REFUSED_LINE = "not a PDF, Word, Excel, CSV, text, Markdown, PNG or JPG file up to 20 MB.";

const localToday = () => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date());
const tomorrowOf = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** What a drop holds: its files, and the files inside any folder dropped, read before the event ends. */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the file system entry API has no DOM types here.
  type Entry = any;
  const entries: Entry[] = Array.from(dt.items ?? []).map((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => Entry }).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dt.files ?? []);
  const out: File[] = [];
  const walk = async (entry: Entry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((resolve, reject) => entry.file(resolve, reject)));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch: Entry[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/** One point as the screen shows it, with when it was said and the platform it is for. */
function PointLine({ point, timeZone }: { point: DatedPoint; timeZone?: string }) {
  const when = point.kind === "upcoming" && point.until ? `Until ${formatDate(point.until, { timeZone })}` : formatDate(point.date, { timeZone });
  return (
    <>
      <span className="t-label shrink-0">{when}{point.platform ? `, ${platformName(point.platform)} only` : ""}</span>
      <span className="t-body">{point.text}</span>
    </>
  );
}

export function ClientNotes({ clientId, clientName, brandNotes, timeZone }: {
  clientId: string;
  clientName: string;
  /** The brief's brand notes as saved: the copy gets them first, as the team's standing notes. */
  brandNotes: string | null;
  timeZone?: string | null;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["client-notes", clientId];
  const [typed, setTyped] = useState("");
  const [date, setDate] = useState(localToday);
  const [dated, setDated] = useState(false);
  const draftId = useRef(crypto.randomUUID());
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; of: number } | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [refused, setRefused] = useState<string[]>([]);
  const [overflow, setOverflow] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<NoteItem | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const zone = timeZone || "UTC";

  const { data, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => readNoteRows(supabase, clientId),
    // A note being read is checked again until it is read.
    refetchInterval: (query) => (query.state.data?.notes.some((n) => n.state === "reading") ? 10_000 : false),
  });

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["client-notes", clientId] }), [queryClient, clientId]);

  /** Every action can be sent twice with the same result, so one that does not get through is sent again quietly. */
  const send = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setNotSaved(false);
    const { error: failed } = await sendQuietly(() => supabase.functions.invoke("client-notes", { body }), { again: (e) => invokeResendable(e, { idempotent: true }) });
    void refresh();
    if (failed) {
      console.warn("[client notes] not saved yet", failed);
      setNotSaved(true);
      return false;
    }
    return true;
  }, [refresh]);

  /** Upload each file to the path its own content names, then add them all in one call. Files that did not go up stay, ready to send again. */
  const sendFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading({ done: 0, of: files.length });
    const uploaded: Array<{ path: string; name: string }> = [];
    const sent: File[] = [];
    const left: File[] = [];
    for (const [i, file] of files.entries()) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const path = `${clientId}/${fileKey(file)}`;
      // The type the bucket takes, from the name: browsers give some files none, or another.
      const typed = new File([file], file.name, { type: NOTE_FILES[ext]?.mime ?? file.type, lastModified: file.lastModified });
      const reply = await uploadQuietly(() => supabase.storage.from(NOTES_BUCKET).upload(path, typed, { upsert: true }));
      if (reply.error) {
        console.warn("[client notes] not uploaded yet", file.name, reply.error);
        left.push(file);
      } else {
        uploaded.push({ path, name: file.name });
        sent.push(file);
      }
      setUploading({ done: i + 1, of: files.length });
    }
    if (uploaded.length && !(await send({ action: "add_files", client_id: clientId, files: uploaded }))) {
      left.push(...sent);
    }
    setPending(left);
    setUploading(null);
  }, [clientId, send]);

  const take = (all: File[]) => {
    // Hidden files from a folder (.DS_Store and the like) are not notes.
    const files = all.filter((f) => !f.name.startsWith("."));
    const fits = (f: File) => noteFileType(f.name) !== null && f.size <= NOTE_FILE_MAX_BYTES;
    const ok = files.filter(fits);
    setRefused(files.filter((f) => !fits(f)).map((f) => f.name));
    setOverflow(Math.max(0, ok.length - NOTE_FILES_AT_ONCE));
    void sendFiles(ok.slice(0, NOTE_FILES_AT_ONCE));
  };

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) take(files);
  };

  const drop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    void droppedFiles(e.dataTransfer).then((files) => files.length && take(files));
  };

  const addNote = async () => {
    const text = typed.trim();
    if (!text || adding) return;
    setAdding(true);
    if (await send({ action: "add_text", client_id: clientId, note_id: draftId.current, text, ...(dated ? { date } : {}) })) {
      setTyped("");
      setDate(localToday());
      setDated(false);
      draftId.current = crypto.randomUUID();
    }
    setAdding(false);
  };

  const today = todayIn(zone, new Date());
  const notes = ((data?.notes ?? []) as unknown as NoteItem[]).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const states: Map<string, PointState> = data ? pointStates(data.notes, data.points, data.links, today) : new Map();
  const follows = data ? selectForPrompt({ points: pointsInUse(data.notes, data.points, data.links, today), standing: brandNotes, today }).points : [];
  const pointsOf = (noteId: string) => (data?.points ?? []).filter((p) => p.note_id === noteId);

  return (
    <Section
      layout="split"
      eyebrow="Notes"
      title="Client notes"
      description={`Meeting notes, feedback and files from ${clientName || "the client"}. Every post written for them follows what these say, the newest first.`}
    >
      <div className="space-y-2">
        <Label htmlFor="client-note-text">Add a note</Label>
        <Textarea id="client-note-text" aria-label="New note" value={typed} maxLength={NOTE_TEXT_MAX} rows={4}
          onChange={(e) => setTyped(e.target.value)} placeholder="What the client said: words to use or avoid, what is coming up, what changed." />
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" aria-label="Date of the new note" className="w-auto" value={date} max={tomorrowOf(localToday())}
            onChange={(e) => { if (e.target.value) { setDate(e.target.value); setDated(true); } }} />
          <Button type="button" variant="outline" size="sm" onClick={() => void addNote()} disabled={adding || !typed.trim()}>
            {adding && <Loader2 className="h-4 w-4 animate-spin" />}
            Add note
          </Button>
        </div>
      </div>

      <div
        data-testid="client-notes-drop"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`glass-inner p-inner space-y-2 border border-dashed ${dragging ? "border-primary" : "border-white/10"}`}
      >
        <p className="t-secondary">
          Drop files or a folder here: PDF, Word, Excel, CSV, text, Markdown, or PNG and JPG screenshots, up to 20 MB each and {NOTE_FILES_AT_ONCE} at a time. Each file becomes its own note.
        </p>
        <label className="inline-flex">
          <input type="file" multiple accept={ACCEPT} className="sr-only" onChange={choose} disabled={!!uploading} />
          <span className={buttonVariants({ variant: "outline", size: "sm" })}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? `Uploading ${uploading.done} of ${uploading.of}…` : "Choose files"}
          </span>
        </label>
        {refused.length > 0 && (
          <p className="t-secondary" role="status">{refused.join(", ")} {refused.length === 1 ? "is" : "are"} {REFUSED_LINE}</p>
        )}
        {overflow > 0 && (
          <p className="t-secondary" role="status">The first {NOTE_FILES_AT_ONCE} files were added. Drop the other {overflow} next.</p>
        )}
        {pending.length > 0 && !uploading && (
          <div className="flex items-center gap-2" role="status">
            <span className="t-secondary truncate">{pending.map((f) => f.name).join(", ")} {pending.length === 1 ? "is" : "are"} not uploaded yet.</span>
            <Button variant="outline" size="sm" onClick={() => void sendFiles(pending)}>Upload</Button>
          </div>
        )}
      </div>

      {!data ? (
        // A list that did not answer says nothing about the notes: keep loading, quietly, and fill in when a try answers.
        isError
          ? <LoadRetry context="client notes" error={error} label="Loading client notes" onRetry={() => refetch()} />
          : <Loading label="Loading client notes" />
      ) : (
        <>
          <section aria-label="What the copy follows now" className="space-y-2">
            <Label>What the copy follows now</Label>
            {follows.length === 0 ? (
              <p className="t-secondary">Nothing from the notes yet. What a note teaches shows here once it is read.</p>
            ) : (
              POINT_KINDS.map((kind) => {
                const list = follows.filter((p) => p.kind === kind);
                return list.length ? (
                  <div key={kind} className="space-y-1">
                    <p className="t-label">{notePointKindName(kind)}</p>
                    <ul className="space-y-1">
                      {list.map((p) => <li key={p.id} className="flex flex-wrap gap-x-3 gap-y-0.5"><PointLine point={p} timeZone={zone} /></li>)}
                    </ul>
                  </div>
                ) : null;
              })
            )}
          </section>

          {notes.length > 0 && (
            <ul aria-label="Notes" className="space-y-2">
              {notes.map((note) => {
                const points = pointsOf(note.id);
                const counted = points.filter((p) => states.has(p.id)).length;
                const isOpen = open === note.id;
                const readLine = noteReadLine(note.text_chars, NOTE_READ_MAX_CHARS);
                return (
                  <li key={note.id} className="glass-inner p-inner space-y-2">
                    <div className="flex flex-wrap items-start gap-3">
                      <FileText className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <button type="button" aria-label={`Open ${note.title}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : note.id)}
                          className="t-body text-left truncate max-w-full hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          {note.title}
                        </button>
                        <p className="t-label">
                          {note.added_by_name ? `Added by ${note.added_by_name} on ${formatDate(note.created_at, { timeZone: zone })}` : `Added on ${formatDate(note.created_at, { timeZone: zone })}`}
                        </p>
                        <p className="t-secondary">{noteStateLine(note.state, counted)}</p>
                        {readLine && <p className="t-label">{readLine}</p>}
                      </div>
                      <Input type="date" key={note.note_date} aria-label={`Date of ${note.title}`} className="w-auto" defaultValue={note.note_date} max={tomorrowOf(today)}
                        onChange={(e) => { if (e.target.value && e.target.value !== note.note_date) void send({ action: "set_date", note_id: note.id, date: e.target.value }); }} />
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${note.title}`} onClick={() => setRemoving(note)}>
                        <X />
                      </Button>
                    </div>
                    {isOpen && (
                      <div role="group" aria-label={`Points from ${note.title}`} className="space-y-2 pl-7">
                        {points.length === 0 ? (
                          <p className="t-secondary">{note.state === "reading" ? "This note is being read." : "Nothing in this note for the copy."}</p>
                        ) : (
                          POINT_KINDS.map((kind) => {
                            const list = points.filter((p) => p.kind === kind);
                            return list.length ? (
                              <div key={kind} className="space-y-1">
                                <p className="t-label">{notePointKindName(kind)}</p>
                                <ul className="space-y-1">
                                  {list.map((p) => {
                                    const state = states.get(p.id);
                                    return (
                                      <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-0.5">
                                        <PointLine point={{ ...p, date: state?.date ?? note.note_date }} timeZone={zone} />
                                        {state?.replacedBy && <Badge variant="outline">Replaced by a newer note</Badge>}
                                        {state?.ended && <Badge variant="outline">Ended</Badge>}
                                        <Button variant="ghost" size="icon-sm" className="ml-auto shrink-0" aria-label="Remove this point"
                                          onClick={() => void send({ action: "remove_point", point_id: p.id })}>
                                          <X />
                                        </Button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ) : null;
                          })
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {notSaved && <p role="status" className="t-label">That change is not saved yet.</p>}

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(next) => { if (!next) setRemoving(null); }}
        title="Remove this note?"
        description={
          <>
            <strong>{removing?.title}</strong>, its file and everything it taught are removed for good. Copy already written stays as it is.
          </>
        }
        confirmLabel="Remove"
        onConfirm={async () => {
          const note = removing;
          setRemoving(null);
          if (note) await send({ action: "remove_note", note_id: note.id });
        }}
      />
    </Section>
  );
}
