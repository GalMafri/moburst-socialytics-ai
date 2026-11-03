import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { toast } from "sonner";
import { track, editDistancePct } from "@/lib/telemetry";
import { postCopyOf } from "@/lib/postCopy";
import type { CalendarPost } from "@/lib/calendarRevision";
import { PostReason } from "@/components/calendar/PostReason";
import type { PostReason as Reason } from "@/lib/calendarPosts";
import { isStoryPost } from "@/lib/platform";
import { NOTE_PLACEHOLDER, cleanNote, copyLearnedLine, notStartedLine, undoCopyNote, type LearnedChange } from "@/lib/postNotes";
import { LearnedNote, NoteBox } from "./NoteBox";

interface Props {
  post: any;
  clientId?: string;
  reportId?: string;
  /** The brand, for the line that says what a note taught it. */
  brand?: string | null;
  onCopySaved?: (post: CalendarPost) => void;
}

/** What the last rewrite with a note taught, for its line and its Undo. */
interface NoteResult { learned: { changes?: LearnedChange[] } | null; undone: boolean }

export function CopyEditor({ post, clientId, reportId, brand, onCopySaved }: Props) {
  // A Story's copy is the message its frame's words are written from. Staff
  // and the client's own users can rewrite it, or a post's copy, with a note
  // (Lital, 3 Nov 2026, decision 1).
  const story = isStoryPost(post);
  const initialCopy = postCopyOf(post);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCopy, setEditedCopy] = useState(initialCopy);
  const [displayCopy, setDisplayCopy] = useState(initialCopy);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  /** An edit that has not reached the server yet; the editor keeps it open with the person's text. */
  const [notSaved, setNotSaved] = useState(false);
  /** Regenerate's note box: open, its note, and whether the last press did not start. */
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [notRewritten, setNotRewritten] = useState(false);
  const [noteResult, setNoteResult] = useState<NoteResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  useEffect(() => {
    setDisplayCopy(initialCopy);
    setEditedCopy(initialCopy);
    setIsEditing(false);
  }, [initialCopy, post._calendarPostKey]);
  useEffect(() => {
    setNoteOpen(false);
    setNote("");
    setNotRewritten(false);
    setNoteResult(null);
  }, [post._calendarPostKey]);

  const saveRevision = async (copy: string, generated?: any, rewriteNote?: string): Promise<{ updated: CalendarPost; learned: { changes?: LearnedChange[] } | null }> => {
    if (!clientId || !post._calendarPostKey) {
      throw new Error("This post can't be edited here.");
    }
    const updated = {
      ...post, copy, _originalCopy: post._originalCopy ?? initialCopy,
      _copyVersion: (post._copyVersion || 0) + 1,
      _copyHistory: [...(post._copyHistory || [initialCopy]), copy],
      hashtags: generated?.hashtags ?? post.hashtags,
      CTA: generated?.CTA ?? generated?.cta ?? post.CTA ?? post.cta,
    };
    // Saved through calendar-posts, which checks the caller belongs to the
    // client: a client's own users can edit their posts' copy too. A save is
    // versioned, so sending it again saves it once.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("calendar-posts", {
      body: {
        action: "save_copy",
        client_id: clientId, report_id: reportId ?? null, calendar_post_key: post._calendarPostKey,
        version: updated._copyVersion, platform: post.platform || null, post_copy: copy,
        hashtags: Array.isArray(updated.hashtags) ? updated.hashtags : typeof updated.hashtags === "string" ? updated.hashtags.split(/[\s,]+/).filter(Boolean) : null,
        cta: updated.CTA || null, concept: post.concept || null, visual_direction: post.visual_direction || null,
        format: post.format || null, source: generated ? "regeneration" : "calendar",
        // The note a rewrite was asked with: the server decides whether it is a lasting preference.
        ...(generated && rewriteNote ? { note: rewriteNote, previous_copy: displayCopy } : {}),
      },
    }), { again: (e) => invokeResendable(e, { idempotent: true }) });
    if (error || data?.error) throw new Error("The copy is not saved yet.");
    onCopySaved?.(updated);
    return { updated, learned: data?.learned && Array.isArray(data.learned.changes) ? data.learned : null };
  };

  // How much of the AI draft survives, and how long people deliberate before
  // committing, are the two signals that separate "trusted" from "rewritten".
  const editOpenedAt = useRef(0);
  const regenCount = useRef(0);

  const beginEdit = () => {
    editOpenedAt.current = performance.now();
    track("post_copy_edit_started", {
      client_id: clientId,
      platform: post.platform || null,
      chars: String(displayCopy).length,
      regenerations_so_far: regenCount.current,
    });
    setIsEditing(true);
  };

  const cancelEdit = () => {
    track("post_copy_edit_cancelled", {
      client_id: clientId,
      platform: post.platform || null,
      duration_ms: editOpenedAt.current ? performance.now() - editOpenedAt.current : null,
    });
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!clientId || !editedCopy.trim()) return;
    setIsSavingEdit(true);
    setNotSaved(false);
    const distance = editDistancePct(displayCopy, editedCopy);
    try {
      await saveRevision(editedCopy);

      // The save teaches the client's preference memory on the server (calendar-posts save_copy).

      // distance 0 means the draft was accepted verbatim ("strong acceptance");
      // anything above ~50 means the user effectively rewrote it.
      track("post_copy_edited", {
        client_id: clientId,
        platform: post.platform || null,
        edit_distance_pct: distance,
        chars_before: String(displayCopy).length,
        chars_after: String(editedCopy).length,
        regenerations_first: regenCount.current,
        duration_ms: editOpenedAt.current ? performance.now() - editOpenedAt.current : null,
        ok: true,
      });

      setDisplayCopy(editedCopy);
      setIsEditing(false);
      toast.success(story ? "Message saved" : "Post copy saved");
    } catch {
      track("post_copy_edited", { client_id: clientId, platform: post.platform || null, ok: false, error_code: "not_saved" });
      // The editor stays open with the person's text.
      setNotSaved(true);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRegenerate = async () => {
    if (!clientId) return;
    const rewriteNote = cleanNote(note);
    setIsRegenerating(true);
    setNotRewritten(false);
    regenCount.current += 1;
    const t0 = performance.now();
    const previousCopy = displayCopy;
    try {
      // A new draft each time, so it is sent again only when it never reached the server.
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("regenerate-post-copy", {
        body: {
          client_id: clientId,
          platform: post.platform || null,
          concept:
            post.concept ||
            post.copy ||
            post.caption_angle ||
            post.rationale ||
            displayCopy ||
            "social media post",
          pillar: post.pillar || null,
          format: post.format || null,
          current_copy: displayCopy,
          current_cta: post.CTA || post.cta || null,
          ...(rewriteNote ? { note: rewriteNote } : {}),
        },
      }));
      if (error || data?.error) throw new Error("not rewritten");

      const postResult = data?.post || data;
      const newCopy = postResult?.caption_angle || postResult?.copy || postResult?.post_copy;
      if (!newCopy?.trim()) throw new Error("not rewritten");
      if (newCopy) {
        const { learned } = await saveRevision(newCopy, postResult, rewriteNote);

        // A high regeneration count on one post is the clearest "the model is
        // not giving them what they want" signal the product emits.
        track("post_copy_regenerated", {
          client_id: clientId,
          platform: post.platform || null,
          attempt: regenCount.current,
          changed_pct: editDistancePct(previousCopy, newCopy),
          chars: String(newCopy).length,
          duration_ms: performance.now() - t0,
          with_note: !!rewriteNote,
          ok: true,
        });

        setDisplayCopy(newCopy);
        setEditedCopy(newCopy);
        setNoteOpen(false);
        setNote("");
        // A rewrite with a note says what the note taught the brand, with Undo.
        setNoteResult(rewriteNote ? { learned, undone: false } : null);
        toast.success(story ? "Message regenerated" : "Copy regenerated");
      }
    } catch (err: any) {
      // The copy on the post stays as it was.
      track("post_copy_regenerated", {
        client_id: clientId,
        platform: post.platform || null,
        attempt: regenCount.current,
        duration_ms: performance.now() - t0,
        with_note: !!rewriteNote,
        ok: false,
        error_code: String(err?.message || "unknown").slice(0, 80),
      });
      // The box stays open with the note.
      setNotRewritten(true);
    } finally {
      setIsRegenerating(false);
    }
  };

  const undoNote = async () => {
    const changes = noteResult?.learned?.changes;
    if (!clientId || !changes?.length) return;
    setUndoing(true);
    // Sent again quietly; the line changes once the server has taken it back.
    if (await undoCopyNote(clientId, changes)) setNoteResult((r) => (r ? { ...r, undone: true } : r));
    setUndoing(false);
  };
  const learnedLine = noteResult ? copyLearnedLine(noteResult.learned, brand, { undone: noteResult.undone }) : null;

  return (
    <div className="space-y-3">
      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editedCopy}
            onChange={(e) => setEditedCopy(e.target.value)}
            rows={6}
            className="text-sm"
            placeholder={story ? "Edit the message..." : "Edit post copy..."}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={isSavingEdit || !editedCopy.trim()}
            >
              {isSavingEdit ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditedCopy(displayCopy);
                setNotSaved(false);
                cancelEdit();
              }}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
            {notSaved && <span role="status" className="t-secondary">Not saved yet. Your text is kept here.</span>}
          </div>
        </div>
      ) : (
        <>
          {story && <p className="t-secondary">The words on the Story are written from this message.</p>}
          <div className="bg-background rounded-md p-4 border">
            <p className="text-base leading-relaxed whitespace-pre-line">{displayCopy}</p>
            {/* Hashtags the copy does not already end with; most copy carries its own. */}
            {post.hashtags?.length > 0 && post.hashtags.some((h: string) => !String(displayCopy || "").toLowerCase().includes((h.startsWith("#") ? h : `#${h}`).toLowerCase())) && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
                {post.hashtags.filter((h: string) => !String(displayCopy || "").toLowerCase().includes((h.startsWith("#") ? h : `#${h}`).toLowerCase())).map((h: string) => (
                  <span key={h} className="text-sm text-primary">
                    {h.startsWith("#") ? h : `#${h}`}
                  </span>
                ))}
              </div>
            )}
          </div>
          {learnedLine && <LearnedNote text={learnedLine.text} onUndo={learnedLine.undo ? () => void undoNote() : undefined} undoing={undoing} />}
          {clientId && noteOpen && (
            <NoteBox
              value={note}
              onChange={setNote}
              onSubmit={() => void handleRegenerate()}
              onCancel={() => { setNoteOpen(false); setNote(""); setNotRewritten(false); }}
              busy={isRegenerating}
              kept={notRewritten ? notStartedLine("copy", note) : null}
              placeholder={story ? NOTE_PLACEHOLDER.story : NOTE_PLACEHOLDER.copy}
            />
          )}
          {clientId && !noteOpen && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditedCopy(displayCopy);
                  beginEdit();
                }}
                disabled={isRegenerating}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setNoteOpen(true)}
                disabled={isRegenerating}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Regenerate
              </Button>
            </div>
          )}
          {post.visual_direction && (
            <p className="text-base text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">Visual: </span>
              {post.visual_direction}
            </p>
          )}
          {post.rationale && (
            <div className="bg-[rgba(255,255,255,0.03)] p-3.5 rounded-md t-body text-muted-foreground">
              💡 {post.rationale}
            </div>
          )}
          <PostReason reasons={(post as { _reasons?: Reason[] })._reasons} />
        </>
      )}
    </div>
  );
}
