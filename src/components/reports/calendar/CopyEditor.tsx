import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { track, editDistancePct } from "@/lib/telemetry";
import { postCopyOf } from "@/lib/postCopy";
import { useAuth } from "@/hooks/useAuth";
import type { CalendarPost } from "@/lib/calendarRevision";

interface Props {
  post: any;
  clientId?: string;
  reportId?: string;
  onCopySaved?: (post: CalendarPost) => void;
}

export function CopyEditor({ post, clientId, reportId, onCopySaved }: Props) {
  const { isMoburstStaff } = useAuth();
  const initialCopy = postCopyOf(post);
  const [isEditing, setIsEditing] = useState(false);
  const [editedCopy, setEditedCopy] = useState(initialCopy);
  const [displayCopy, setDisplayCopy] = useState(initialCopy);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  useEffect(() => {
    setDisplayCopy(initialCopy);
    setEditedCopy(initialCopy);
    setIsEditing(false);
  }, [initialCopy, post._calendarPostKey]);

  const saveRevision = async (copy: string, generated?: any) => {
    if (!clientId || !reportId || !post._calendarPostKey) {
      throw new Error("Open this post from its report calendar before saving changes.");
    }
    const updated = {
      ...post, copy, _originalCopy: post._originalCopy ?? initialCopy,
      _copyVersion: (post._copyVersion || 0) + 1,
      _copyHistory: [...(post._copyHistory || [initialCopy]), copy],
      hashtags: generated?.hashtags ?? post.hashtags,
      CTA: generated?.CTA ?? generated?.cta ?? post.CTA ?? post.cta,
    };
    const { error } = await supabase.from("post_iterations").insert({
      client_id: clientId, report_id: reportId, calendar_post_key: post._calendarPostKey,
      version: updated._copyVersion, platform: post.platform || null, post_copy: copy,
      hashtags: updated.hashtags || null, cta: updated.CTA || null,
      concept: post.concept || null, visual_direction: post.visual_direction || null,
      format: post.format || null, source: generated ? "regeneration" : "calendar",
    });
    if (error) throw error;
    onCopySaved?.(updated);
    return updated;
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
    const distance = editDistancePct(displayCopy, editedCopy);
    try {
      await saveRevision(editedCopy);

      // Fire-and-forget call to learn from this edit.
      if (isMoburstStaff) void supabase.functions.invoke("analyze-post-edits", {
        body: {
          client_id: clientId,
          original_copy: displayCopy,
          edited_copy: editedCopy,
        },
      }).catch(() => undefined);

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
      toast.success("Post copy saved");
    } catch (err: any) {
      track("post_copy_edited", {
        client_id: clientId,
        platform: post.platform || null,
        ok: false,
        error_code: String(err?.message || "unknown").slice(0, 80),
      });
      toast.error("Failed to save edit: " + (err.message || "Unknown error"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRegenerate = async () => {
    if (!clientId || !isMoburstStaff) return;
    setIsRegenerating(true);
    regenCount.current += 1;
    const t0 = performance.now();
    const previousCopy = displayCopy;
    try {
      const { data, error } = await supabase.functions.invoke("regenerate-post-copy", {
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
          current_copy: displayCopy,
          current_cta: post.CTA || post.cta || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const postResult = data?.post || data;
      const newCopy = postResult?.caption_angle || postResult?.copy || postResult?.post_copy;
      if (!newCopy?.trim()) throw new Error("No copy was returned. Your existing copy is unchanged.");
      if (newCopy) {
        await saveRevision(newCopy, postResult);

        // A high regeneration count on one post is the clearest "the model is
        // not giving them what they want" signal the product emits.
        track("post_copy_regenerated", {
          client_id: clientId,
          platform: post.platform || null,
          attempt: regenCount.current,
          changed_pct: editDistancePct(previousCopy, newCopy),
          chars: String(newCopy).length,
          duration_ms: performance.now() - t0,
          ok: true,
        });

        setDisplayCopy(newCopy);
        setEditedCopy(newCopy);
        toast.success("Copy regenerated");
      }
    } catch (err: any) {
      track("post_copy_regenerated", {
        client_id: clientId,
        platform: post.platform || null,
        attempt: regenCount.current,
        duration_ms: performance.now() - t0,
        ok: false,
        error_code: String(err?.message || "unknown").slice(0, 80),
      });
      toast.error("Failed to regenerate: " + (err.message || "Unknown error"));
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editedCopy}
            onChange={(e) => setEditedCopy(e.target.value)}
            rows={6}
            className="text-sm"
            placeholder="Edit post copy..."
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
                cancelEdit();
              }}
              disabled={isSavingEdit}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="bg-background rounded-md p-4 border">
            <p className="text-base leading-relaxed whitespace-pre-line">{displayCopy}</p>
            {post.hashtags?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
                {post.hashtags.map((h: string) => (
                  <span key={h} className="text-sm text-primary">
                    {h.startsWith("#") ? h : `#${h}`}
                  </span>
                ))}
              </div>
            )}
          </div>
          {clientId && (
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
              {isMoburstStaff && <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerate}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                {isRegenerating ? "Regenerating..." : "Regenerate"}
              </Button>}
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
        </>
      )}
    </div>
  );
}
