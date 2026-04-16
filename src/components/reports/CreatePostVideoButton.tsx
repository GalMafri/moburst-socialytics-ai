import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Video, Loader2, Download, RefreshCw, Scissors } from "lucide-react";
import { VideoTrimmer } from "@/components/editor/VideoTrimmer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreatePostVideoButtonProps {
  post: any;
  brandIdentity?: any;
  clientId?: string;
  onVideoGenerated?: (url: string) => void;
}

/** Platform-specific video specs and creative guidance */
function getPlatformVideoSpec(platform?: string, format?: string) {
  const p = (platform || "").toLowerCase();
  const f = (format || "").toLowerCase();

  if (p.includes("tiktok")) {
    return {
      aspect: "9:16 vertical",
      duration: "5-8 seconds",
      style: "Fast-paced, trend-driven, raw/authentic feel. Quick cuts, dynamic transitions. Hook in first 1 second. Mobile-first vertical framing with subject centered.",
      label: "TikTok",
    };
  }
  if (f.includes("reel") || (p.includes("instagram") && f.includes("video"))) {
    return {
      aspect: "9:16 vertical",
      duration: "5-8 seconds",
      style: "Polished but dynamic. Smooth transitions, cinematic color grading. Hook in first 1.5 seconds. Vertical framing, subject fills frame. Instagram-quality aesthetic.",
      label: "Instagram Reel",
    };
  }
  if (f.includes("story") || f.includes("stories")) {
    return {
      aspect: "9:16 vertical",
      duration: "5 seconds",
      style: "Quick, eye-catching, ephemeral feel. Single scene or 2-3 quick cuts. Bold motion, simple concept. Full-screen vertical with key content in center safe zone.",
      label: "Story",
    };
  }
  if (p.includes("linkedin")) {
    return {
      aspect: "16:9 horizontal",
      duration: "6-8 seconds",
      style: "Professional, clean, corporate-friendly. Subtle motion, smooth transitions. Business-appropriate pacing. Text-safe zones for captions. Horizontal widescreen framing.",
      label: "LinkedIn Video",
    };
  }
  if (p.includes("youtube")) {
    return {
      aspect: "16:9 horizontal",
      duration: "6-8 seconds",
      style: "Cinematic, high production value. Dynamic camera movement, dramatic lighting. YouTube thumbnail-worthy opening frame. Widescreen cinematic framing.",
      label: "YouTube Short/Video",
    };
  }
  if (p.includes("facebook")) {
    return {
      aspect: "1:1 square",
      duration: "5-8 seconds",
      style: "Scroll-stopping, shareable. Works with sound off — visual storytelling. Bold motion, clear subject. Square format optimized for feed.",
      label: "Facebook Video",
    };
  }
  return {
    aspect: "9:16 vertical",
    duration: "5-8 seconds",
    style: "Dynamic, engaging, mobile-first. Smooth transitions, clear visual narrative.",
    label: "Social Video",
  };
}

export function CreatePostVideoButton({ post, brandIdentity, clientId, onVideoGenerated }: CreatePostVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showTrimmer, setShowTrimmer] = useState(false);

  const spec = getPlatformVideoSpec(post.platform, post.format);

  /**
   * Build a clean, concise Veo-compatible video prompt.
   * Veo works best with 1-3 sentence scene descriptions — not storyboards.
   */
  const buildVideoPrompt = (sceneDescription: string) => {
    const parts: string[] = [];

    // 1. Core scene description (from Claude distillation)
    parts.push(sceneDescription);

    // 2. Brand color palette
    const colors = [brandIdentity?.primary_color, brandIdentity?.secondary_color, brandIdentity?.accent_color].filter(Boolean);
    if (colors.length > 0) {
      parts.push(`Color palette: ${colors.join(", ")} — apply these colors throughout backgrounds, lighting gels, objects, and environment.`);
    }

    // 3. Brand visual style and tone
    const brandNotes: string[] = [];
    if (brandIdentity?.visual_style) brandNotes.push(`Visual style: ${brandIdentity.visual_style}`);
    if (brandIdentity?.tone_of_voice) brandNotes.push(`Tone: ${brandIdentity.tone_of_voice}`);
    if (brandIdentity?.design_elements) brandNotes.push(`Design language: ${brandIdentity.design_elements}`);
    if (brandIdentity?.background_style) brandNotes.push(`Environment: ${brandIdentity.background_style}`);
    if (brandNotes.length > 0) {
      parts.push(brandNotes.join(". ") + ".");
    }

    // 4. Platform + format specs
    parts.push(`${spec.aspect} format, ${spec.duration}. ${spec.style}`);

    // 5. Constraints
    parts.push("No text overlays, watermarks, logos, or color codes visible in any frame. No real people's names or celebrity likenesses.");

    return parts.join("\n\n");
  };

  /**
   * Distill a complex storyboard/visual direction into a simple Veo scene description
   * using Claude. Falls back to extracting the first meaningful sentence.
   */
  const distillForVeo = async (rawDirection: string, postCopy: string): Promise<string> => {
    // Build brand context string for Claude
    const brandContext = [
      brandIdentity?.visual_style ? `Visual style: ${brandIdentity.visual_style}` : "",
      brandIdentity?.tone_of_voice ? `Tone: ${brandIdentity.tone_of_voice}` : "",
      brandIdentity?.background_style ? `Environment: ${brandIdentity.background_style}` : "",
    ].filter(Boolean).join(". ");

    // Try Claude first for best results
    try {
      const { data } = await supabase.functions.invoke("adapt-creative-prompt", {
        body: {
          concept: `${postCopy || rawDirection.slice(0, 200)}${brandContext ? `\n\nBrand context: ${brandContext}` : ""}`,
          visual_direction: rawDirection,
          original_format: post.format || "Storyboard",
          target_format: `${spec.duration} ${spec.aspect} AI-generated video clip (Google Veo)`,
          platform: post.platform,
        },
      });
      if (data?.adapted_prompt && data.adapted_prompt.length > 20) {
        return data.adapted_prompt;
      }
    } catch {
      // Fall through to manual extraction
    }

    // Fallback: strip markdown and extract the core scene description
    const cleaned = rawDirection
      .replace(/#+\s*/g, "")            // remove markdown headers
      .replace(/\*\*([^*]+)\*\*/g, "$1") // remove bold markers
      .replace(/\*([^*]+)\*/g, "$1")     // remove italic markers
      .replace(/\([^)]*\)/g, "")         // remove parenthetical notes
      .replace(/\d+-\d+s?:?\s*/g, "")    // remove timestamp markers like "0-3s:"
      .replace(/\n{2,}/g, ". ")          // collapse double newlines
      .replace(/\n/g, " ")              // collapse single newlines
      .replace(/\s{2,}/g, " ")          // collapse spaces
      .trim();

    // Take the first 2-3 sentences that describe the visual scene
    const sentences = cleaned.split(/\.\s+/).filter(s => s.length > 15).slice(0, 3);
    return sentences.join(". ") + ".";
  };

  const handleOpen = async () => {
    setOpen(true);
    setPrompt("Generating video prompt...");

    // Get the raw visual direction from whichever field the post has
    const rawDirection = post.ai_visual_prompt || post.visual_direction || post.copy || post.concept || "";
    const postCopy = post.copy || post.caption_angle || "";

    // Distill the complex storyboard into a simple Veo-compatible scene description
    const sceneDescription = await distillForVeo(rawDirection, postCopy);

    setPrompt(buildVideoPrompt(sceneDescription));
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
        // Upload video to persistent storage
        let persistentUrl = data.video_url;
        try {
          const { data: uploaded } = await supabase.functions.invoke("upload-generated-media", {
            body: {
              client_id: clientId || "unknown",
              media_data: data.video_url,
              media_type: "video",
              file_name: `video-${post.platform || "post"}`,
            },
          });
          if (uploaded?.url) {
            persistentUrl = uploaded.url;
          }
        } catch {
          // Fallback to original URL
        }

        setVideoUrl(persistentUrl);

        // Save to post_iterations with media_urls
        if (clientId) {
          supabase.from("post_iterations").insert({
            client_id: clientId,
            platform: post.platform || null,
            post_copy: post.copy || null,
            visual_direction: post.visual_direction || post.ai_visual_prompt || null,
            format: post.format || null,
            source: "calendar",
            media_urls: [persistentUrl],
          } as any).then(() => {}, (err: any) => console.error("post_iterations save failed:", err));
        }

        if (onVideoGenerated) onVideoGenerated(persistentUrl);
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

  const brandColors = [
    brandIdentity?.primary_color,
    brandIdentity?.secondary_color,
    brandIdentity?.accent_color,
  ].filter(Boolean);

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
              <Video className="h-4 w-4" /> Generate Video — {spec.label}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Platform & format info */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{spec.aspect}</Badge>
              <Badge variant="outline">{spec.duration}</Badge>
              {brandColors.length > 0 && (
                <div className="flex items-center gap-1 ml-auto">
                  {brandColors.map((color, i) => (
                    <div
                      key={i}
                      className="h-4 w-4 rounded-full border shadow-sm"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Editable prompt */}
            <div className="space-y-2">
              <Label>Video Prompt (edit before generating)</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                className="text-xs font-mono"
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
                  Generating {spec.label} video with Google Veo...
                </p>
                <p className="text-xs text-muted-foreground mt-1">This may take 30-120 seconds</p>
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
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowTrimmer(true)}
                  >
                    <Scissors className="h-3 w-3 mr-1" /> Edit Video
                  </Button>
                  <a href={videoUrl} download className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">
                      <Download className="h-3 w-3 mr-1" /> Download
                    </Button>
                  </a>
                </div>
              </div>
            )}

            {showTrimmer && videoUrl && (
              <VideoTrimmer
                videoUrl={videoUrl}
                clientId={clientId}
                onSave={(updatedUrl) => {
                  setVideoUrl(updatedUrl);
                  setShowTrimmer(false);
                  toast.success("Video edits saved");
                }}
                onClose={() => setShowTrimmer(false)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
