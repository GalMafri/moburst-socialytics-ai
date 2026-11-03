/**
 * A post and its Story, in the post panel's header, which is also the post's
 * menu (Stories for Facebook and Instagram, Lital 2 Nov 2026; Stories you can
 * find, 3 Nov 2026; spec docs/superpowers/specs/2026-11-03-post-notes-stories-design.md):
 *   - every Facebook or Instagram calendar post shows "Add a Story" beside its
 *     format, on every tab, for staff and the client's own users;
 *   - a post with a Story shows a "Story" chip that opens it;
 *   - a Story made from a post shows "Open the post".
 * Before the brand's designs are set up, the Story is added with its message
 * and no design. A press that does not finish leaves the button as it was,
 * with a line that says the Story isn't added yet.
 */

import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { Button } from "@/components/ui/button";
import { canBeStory, isStoryPost } from "@/lib/platform";
import { postCopyOf } from "@/lib/postCopy";
import { useDesignRequests } from "./DesignRequestsContext";

interface Props {
  post: { _calendarPostKey?: string; _calendarPostId?: string; _storyOf?: string; platform?: string; format?: string; copy?: string; [k: string]: unknown };
  clientId?: string;
}

export function StoryLinks({ post, clientId }: Props) {
  const qc = useQueryClient();
  const designRequests = useDesignRequests();
  const key = post._calendarPostKey;
  const story = isStoryPost(post);
  // Only a post on the calendar (calendar_posts) can have a Story: a report's own board has none.
  const offered = !story && canBeStory(post.platform) && !!clientId && !!key && !!post._calendarPostId;
  const [adding, setAdding] = useState(false);
  const [notAdded, setNotAdded] = useState(false);
  /** A Story just added, opened as soon as the calendar has it. */
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => { setNotAdded(false); setOpening(null); }, [key]);
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
      <Button size="sm" variant="outline" className="h-7 px-2.5" onClick={() => designRequests?.openDesigns(post._storyOf!)}>Open the post</Button>
    );
  }
  if (!offered) return null;

  const addStory = async () => {
    setAdding(true);
    setNotAdded(false);
    try {
      // The server answers with the same Story when the post has one, so sending it again is safe.
      const { data, error } = await sendQuietly(() => supabase.functions.invoke("design-request", {
        body: { action: "story", client_id: clientId, calendar_post_key: key },
      }), { again: (e) => invokeResendable(e, { idempotent: true }) });
      const storyKey = data?.story?.post_key as string | undefined;
      if (error || !storyKey) throw new Error("not added");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["calendar-posts", clientId] }),
        qc.invalidateQueries({ queryKey: ["post-story", clientId, key] }),
      ]);
      designRequests?.refresh();
      setOpening(storyKey);
    } catch {
      setNotAdded(true);
    } finally {
      setAdding(false);
    }
  };

  const storyKey = made ?? opening;
  if (storyKey) {
    return (
      <button
        type="button"
        onClick={() => designRequests?.openDesigns(storyKey)}
        aria-label="Open the Story"
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-white/15 t-badge text-white hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Smartphone className="h-3 w-3" aria-hidden />Story
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" className="h-7 px-2.5" onClick={() => void addStory()} disabled={adding || !postCopyOf(post).trim()}>
        {adding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Smartphone className="h-3.5 w-3.5 mr-1.5" />}
        Add a Story
      </Button>
      {notAdded && <span role="status" className="t-secondary">The Story isn't added yet.</span>}
    </span>
  );
}
