import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Video, Loader2, Download, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreatePostVideoButtonProps {
  post: any;
  brandIdentity?: any;
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

export function CreatePostVideoButton({ post, brandIdentity, onVideoGenerated }: CreatePostVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const spec = getPlatformVideoSpec(post.platform, post.format);

  const buildVideoPrompt = (adaptedDirection?: string) => {
    const visualDirection = adaptedDirection || post.ai_visual_prompt || post.visual_direction || "";
    const postCopy = post.copy || "";

    const sections: string[] = [];

    // 1. Video-specific creative direction
    sections.push(`Create a ${spec.duration} ${spec.aspect} video for ${spec.label}.`);

    // 2. Scene description from the post's visual direction
    if (visualDirection) {
      sections.push(`SCENE: ${visualDirection}`);
    }

    // 3. Post context for thematic alignment
    if (postCopy) {
      sections.push(`CONTEXT: This video accompanies this post: "${postCopy.slice(0, 150)}${postCopy.length > 150 ? '...' : ''}"`);
    }

    // 4. Platform-specific motion and style direction
    sections.push(`MOTION & STYLE: ${spec.style}`);

    // 5. Brand identity
    if (brandIdentity) {
      const brandParts: string[] = [];
      const colors = [brandIdentity.primary_color, brandIdentity.secondary_color, brandIdentity.accent_color].filter(Boolean);
      if (colors.length > 0) {
        brandParts.push(`Use this color palette in the video design (apply these colors, NEVER show them as text): ${colors.join(", ")}. IMPORTANT: Do not render any hex codes, color values, or technical notation as visible text in the video.`);
      }
      if (brandIdentity.visual_style) brandParts.push(`Visual style: ${brandIdentity.visual_style}`);
      if (brandIdentity.tone_of_voice) brandParts.push(`Tone: ${brandIdentity.tone_of_voice}`);
      if (brandIdentity.design_elements) brandParts.push(`Design elements: ${brandIdentity.design_elements}`);
      if (brandIdentity.background_style) brandParts.push(`Background: ${brandIdentity.background_style}`);

      if (brandParts.length > 0) {
        sections.push(`BRAND GUIDELINES:\n${brandParts.join("\n")}`);
      }
    }

    // 6. Video-specific constraints
    sections.push(`REQUIREMENTS:
- Smooth, professional camera motion (slow pan, dolly, or gentle zoom)
- No text overlays, watermarks, or logos
- No jarring cuts — use smooth transitions
- Photorealistic quality, cinematic lighting
- Content must be appropriate for ${spec.label} audience`);

    // 7. Final hex-code guard
    sections.push(`CRITICAL: No hex codes, color codes, or technical color notation should appear as visible text in any frame of this video.`);

    return sections.join("\n\n");
  };

  const handleOpen = async () => {
    setOpen(true);

    // Detect format mismatch: post recommended image/carousel but user is generating a video
    let baseDirection = post.ai_visual_prompt || post.visual_direction || "";
    const postFormat = (post.format || "").toLowerCase();
    const isImageRecommendation =
      postFormat.includes("image") ||
      postFormat.includes("carousel") ||
      postFormat.includes("static");
    if (isImageRecommendation && baseDirection) {
      try {
        const { data: adapted } = await supabase.functions.invoke("adapt-creative-prompt", {
          body: {
            concept: post.concept || post.hook || post.copy || "",
            visual_direction: baseDirection,
            original_format: post.format,
            target_format: "Video",
            platform: post.platform,
          },
        });
        if (adapted?.adapted_prompt) {
          baseDirection = adapted.adapted_prompt;
        }
      } catch (e) {
        // Silently fall through — use original prompt
      }
    }

    setPrompt(buildVideoPrompt(isImageRecommendation ? baseDirection : undefined));
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
        if (onVideoGenerated) onVideoGenerated(data.video_url);
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
