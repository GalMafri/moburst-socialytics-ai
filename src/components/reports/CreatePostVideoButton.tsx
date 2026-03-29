import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Video, Loader2, Download, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreatePostVideoButtonProps {
  post: any;
  brandIdentity?: any;
}

export function CreatePostVideoButton({ post, brandIdentity }: CreatePostVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const visualPrompt = post.ai_visual_prompt || post.visual_direction || "";

  const buildVideoPrompt = () => {
    const parts: string[] = [];
    parts.push(visualPrompt);
    parts.push("\nCreate a short video (5-8 seconds) with smooth motion and transitions.");
    parts.push(`Format: ${post.format || "short-form video"} for ${post.platform || "social media"}.`);

    if (brandIdentity) {
      const colors = [brandIdentity.primary_color, brandIdentity.secondary_color, brandIdentity.accent_color]
        .filter(Boolean)
        .join(", ");
      if (colors) parts.push(`Brand colors: ${colors}`);
      if (brandIdentity.visual_style) parts.push(`Visual style: ${brandIdentity.visual_style}`);
    }

    parts.push("No text overlays, logos, or watermarks. Clean, professional motion design.");
    return parts.join("\n");
  };

  const handleOpen = () => {
    setPrompt(buildVideoPrompt());
    setOpen(true);
  };

  const generateVideo = async () => {
    setLoading(true);
    setVideoUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-post-video", {
        body: {
          prompt,
          platform: post.platform,
          format: post.format,
          brandIdentity,
        },
      });

      if (error) throw error;
      if (data?.video_url) {
        setVideoUrl(data.video_url);
        toast.success("Video generated!");
      } else {
        toast.error("Video generation failed — no video returned");
      }
    } catch (err: any) {
      toast.error("Video generation failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const isVideoFormat = ["reel", "reels", "story", "stories", "tiktok", "video", "short"]
    .some((f) => (post.format || "").toLowerCase().includes(f));

  return (
    <>
      <Button
        variant={isVideoFormat ? "default" : "outline"}
        size="sm"
        onClick={handleOpen}
      >
        <Video className="h-3 w-3 mr-1" /> Video
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="h-4 w-4" /> Generate Video
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Video Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={generateVideo} disabled={loading} className="flex-1">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating (30-120s)...
                  </>
                ) : (
                  <>
                    <Video className="h-4 w-4 mr-2" /> Generate Video
                  </>
                )}
              </Button>
              {videoUrl && (
                <Button variant="outline" onClick={generateVideo} disabled={loading}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>

            {loading && (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Generating video with Google Veo... This may take 30-120 seconds.
                </p>
              </div>
            )}

            {videoUrl && (
              <div className="space-y-2">
                <video
                  src={videoUrl}
                  controls
                  className="w-full rounded-md border"
                  autoPlay
                  loop
                  muted
                />
                <a href={videoUrl} download className="block">
                  <Button variant="outline" size="sm" className="w-full">
                    <Download className="h-3 w-3 mr-1" /> Download Video
                  </Button>
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
