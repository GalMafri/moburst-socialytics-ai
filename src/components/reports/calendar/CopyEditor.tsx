import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Pencil, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  post: any;
  clientId?: string;
  reportId?: string;
}

export function CopyEditor({ post, clientId, reportId }: Props) {
  const initialCopy = post.copy || post.caption_angle || post.concept || "";
  const [isEditing, setIsEditing] = useState(false);
  const [editedCopy, setEditedCopy] = useState(initialCopy);
  const [displayCopy, setDisplayCopy] = useState(initialCopy);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleSaveEdit = async () => {
    if (!clientId || !editedCopy.trim()) return;
    setIsSavingEdit(true);
    try {
      // Save original version (v1) and edited version (v2) to post_iterations
      await supabase.from("post_iterations").insert({
        client_id: clientId,
        report_id: reportId || null,
        version: 1,
        platform: post.platform || null,
        post_copy: displayCopy,
        hashtags: post.hashtags || null,
        cta: post.CTA || post.cta || null,
        concept: post.concept || null,
        visual_direction: post.visual_direction || null,
        format: post.format || null,
        source: "calendar",
      } as any);
      await supabase.from("post_iterations").insert({
        client_id: clientId,
        report_id: reportId || null,
        version: 2,
        platform: post.platform || null,
        post_copy: editedCopy,
        hashtags: post.hashtags || null,
        cta: post.CTA || post.cta || null,
        concept: post.concept || null,
        visual_direction: post.visual_direction || null,
        format: post.format || null,
        source: "calendar",
      } as any);

      // Fire-and-forget call to learn from this edit.
      supabase.functions.invoke("analyze-post-edits", {
        body: {
          client_id: clientId,
          original_copy: displayCopy,
          edited_copy: editedCopy,
        },
      });

      setDisplayCopy(editedCopy);
      setIsEditing(false);
      toast.success("Post updated and preferences saved");
    } catch (err: any) {
      toast.error("Failed to save edit: " + (err.message || "Unknown error"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRegenerate = async () => {
    if (!clientId) return;
    setIsRegenerating(true);
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
      if (newCopy) {
        await supabase.from("post_iterations").insert({
          client_id: clientId,
          report_id: reportId || null,
          version: 1,
          platform: post.platform || null,
          post_copy: newCopy,
          hashtags: postResult?.hashtags || post.hashtags || null,
          cta: postResult?.CTA || postResult?.cta || post.CTA || post.cta || null,
          concept: post.concept || null,
          visual_direction: post.visual_direction || null,
          format: post.format || null,
          source: "regeneration",
        } as any);

        setDisplayCopy(newCopy);
        setEditedCopy(newCopy);
        toast.success("Copy regenerated");
      }
    } catch (err: any) {
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
                setIsEditing(false);
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
                  setIsEditing(true);
                }}
                disabled={isRegenerating}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
              </Button>
              <Button
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
            <div className="bg-[rgba(255,255,255,0.03)] p-3.5 rounded-md text-sm leading-relaxed text-muted-foreground">
              💡 {post.rationale}
            </div>
          )}
        </>
      )}
    </div>
  );
}
