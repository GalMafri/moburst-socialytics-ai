/**
 * Add a post to the calendar at any time (Lital, 12 Oct: "the team might want
 * to produce a post ad-hoc"). The post is written in the client's voice from
 * the idea, lands on its date, and gets its design like every other post.
 */

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const FORMATS = [
  { value: "auto", label: "Best fit for the idea" },
  { value: "Image", label: "Single image" },
  { value: "Carousel", label: "Carousel" },
  { value: "Reel", label: "Reel or short video" },
  { value: "Story", label: "Story" },
];

export function NewPostDialog({ clientId, platforms, defaultDate, onCreated }: {
  clientId: string;
  platforms: string[];
  defaultDate: string;
  onCreated?: (postDate: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [platform, setPlatform] = useState("");
  const [format, setFormat] = useState("auto");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => { setDate(defaultDate); setPlatform(""); setFormat("auto"); setIdea(""); };

  const create = async () => {
    if (!date || !platform || !idea.trim()) {
      toast.error("Choose a date and platform, and describe the idea.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-ad-hoc-post", {
        body: { client_id: clientId, platform, topic: idea.trim(), creative_type: format === "auto" ? undefined : format },
      });
      if (error || !data?.post) throw new Error(await describeInvokeError(error, data));
      const p = data.post;
      const hashtags = Array.isArray(p.hashtags) ? p.hashtags.map(String) : typeof p.hashtags === "string" ? p.hashtags.split(/[\s,]+/).filter(Boolean) : [];
      const { data: auth } = await supabase.auth.getUser();
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: insertError } = await (supabase.from("calendar_posts" as never) as any).insert({
        client_id: clientId,
        post_date: date,
        platform: p.platform || platform,
        format: p.format || (format === "auto" ? null : format),
        pillar: p.pillar || null,
        copy: p.caption_angle || p.concept || "",
        hashtags,
        cta: p.CTA || null,
        visual_direction: p.visual_direction || null,
        rationale: p.concept || null,
        reasons: [{ type: "idea", label: idea.trim() }],
        source: "ad_hoc",
        raw: p,
        created_by: auth?.user?.id ?? null,
      });
      if (insertError) throw insertError;
      await qc.invalidateQueries({ queryKey: ["calendar-posts", clientId] });
      toast.success("Post added to the calendar");
      setOpen(false);
      reset();
      onCreated?.(date);
    } catch (e) {
      toast.error("Could not add the post", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); else setDate(defaultDate); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1.5" />New post</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="t-h3">New post</DialogTitle>
          <DialogDescription>Describe the idea. The post is written in the client's voice and added to the calendar on its date.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-post-date">Date</Label>
              <Input id="new-post-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                <SelectContent>
                  {platforms.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Format</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-post-idea">Idea</Label>
            <Textarea id="new-post-idea" rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="For example: our new guide on measuring visibility in AI answers" />
          </div>
          <Button className="w-full" onClick={create} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            {busy ? "Writing the post…" : "Add to calendar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
