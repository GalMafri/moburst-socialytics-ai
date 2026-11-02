/**
 * A post and its Story, in the Design tab (Stories for Facebook and
 * Instagram, Lital 2 Nov 2026; spec
 * docs/superpowers/specs/2026-11-02-stories-design.md):
 *   - a Facebook or Instagram post offers "Design as a Story" under its own
 *     design, or opens the Story it has;
 *   - a Story made from a post links back to it.
 * A press that does not finish leaves the button as it was, with a line that
 * says the Story isn't made yet.
 */

import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { Button } from "@/components/ui/button";
import { canBeStory, isStoryPost } from "@/lib/platform";
import { postCopyOf } from "@/lib/postCopy";
import { platformName } from "@/lib/display";
import { useDesignRequests } from "./DesignRequestsContext";

interface Props {
  post: { _calendarPostKey?: string; _storyOf?: string; platform?: string; format?: string; copy?: string; [k: string]: unknown };
  clientId?: string;
}

export function StoryLinks({ post, clientId }: Props) {
  const qc = useQueryClient();
  const designRequests = useDesignRequests();
  const key = post._calendarPostKey;
  const story = isStoryPost(post);
  const offered = !story && canBeStory(post.platform) && !!clientId && !!key;
  const [making, setMaking] = useState(false);
  const [notMade, setNotMade] = useState(false);
  /** A Story just made, opened as soon as the calendar has it. */
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { setNotMade(false); setOpening(null); }, [key]);
  useEffect(() => { if (opening) designRequests?.openDesigns(opening); }, [opening, designRequests]);

  // The Story this post already has (one per post, calendar_posts.story_of).
  const { data: made } = useQuery({
    queryKey: ["post-story", clientId, key],
    enabled: offered,
    queryFn: async () => {
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("calendar_posts" as never) as any).select("post_key").eq("client_id", clientId).eq("story_of", key).maybeSingle();
      if (error) throw error;
      return (data?.post_key as string | undefined) ?? null;
    },
  });

  if (story) {
    if (!post._storyOf) return null;
    return (
      <div className="glass-inner p-inner flex items-center justify-between gap-3 flex-wrap">
        <p className="t-secondary min-w-0">This Story is made from the {platformName(post.platform)} post on the same day.</p>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => designRequests?.openDesigns(post._storyOf!)}>Open the post</Button>
      </div>
    );
  }
  if (!offered) return null;

  const makeStory = async () => {
    setMaking(true);
    setNotMade(false);
    try {
      // The server answers with the same Story when the post has one, so sending it again is safe.
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", {
        body: { action: "story", client_id: clientId, calendar_post_key: key },
      }), { again: (e) => invokeResendable(e, { idempotent: true }) });
      const storyKey = data?.story?.post_key as string | undefined;
      if (error || !storyKey) throw new Error("not made");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["calendar-posts", clientId] }),
        qc.invalidateQueries({ queryKey: ["post-story", clientId, key] }),
      ]);
      designRequests?.refresh();
      setOpening(storyKey);
    } catch {
      setNotMade(true);
    } finally {
      setMaking(false);
    }
  };

  const storyKey = made ?? opening;
  return (
    <div className="glass-inner p-inner space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="t-h4">Story</p>
          <p className="t-secondary">{storyKey ? "This post has a Story, designed from its copy." : "A 9:16 Story frame designed from this post's copy, posted by hand."}</p>
        </div>
        {storyKey ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => designRequests?.openDesigns(storyKey)}>Open the Story</Button>
        ) : (
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => void makeStory()} disabled={making || !postCopyOf(post).trim()}>
            {making ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5 mr-1.5" />}
            Design as a Story
          </Button>
        )}
      </div>
      {notMade && <p role="status" className="t-secondary">The Story isn't made yet.</p>}
    </div>
  );
}
