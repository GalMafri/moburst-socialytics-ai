import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Video, Loader2, Download, RefreshCw, Scissors, Check, Ban } from "lucide-react";
import { VideoTrimmer } from "@/components/editor/VideoTrimmer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ClientContext } from "@/lib/clientContext";
import { Slider } from "@/components/ui/slider";
import { useGenerationContext, postKeyOf } from "@/components/reports/calendar/GenerationContext";

interface CreatePostVideoButtonProps {
  post: any;
  clientContext?: ClientContext;
  /** @deprecated — prefer clientContext.brand_identity */
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

type VariantSlot = string | null | "FAILED";

export function CreatePostVideoButton({ post, clientContext, brandIdentity, clientId, onVideoGenerated }: CreatePostVideoButtonProps) {
  const effectiveBrandIdentity = clientContext?.brand_identity ?? brandIdentity ?? null;
  const generation = useGenerationContext();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Legacy: holds the URL of whatever variant is currently being trimmed.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [showTrimmer, setShowTrimmer] = useState(false);
  // Phase 7 — multi-variant state.
  const [variantCount, setVariantCount] = useState(2);
  const [angles, setAngles] = useState<Array<{ label: string; instruction: string }>>([]);
  const [selectedAngleIdxs, setSelectedAngleIdxs] = useState<number[]>([]);
  const [fetchingAngles, setFetchingAngles] = useState(false);
  const [variantGroupId, setVariantGroupId] = useState<string | null>(null);
  const [favoriteIdxs, setFavoriteIdxs] = useState<Set<number>>(new Set());
  const [variantUrls, setVariantUrls] = useState<VariantSlot[]>([]);
  // Per-variant seed image (Gemini-generated anchor still that Veo animates
  // from). Surfacing this lets us SEE whether the seed itself was on-brand —
  // if seed is good but video drifts, that's Veo conditioning; if seed is
  // already generic, the multimodal context flow is the problem.
  const [variantSeeds, setVariantSeeds] = useState<Array<string | null>>([]);
  const [previewSeedUrl, setPreviewSeedUrl] = useState<string | null>(null);
  // Cancellation flag — checked when results return. Veo calls are 30-120s
  // each, so users may want to abort an accidental click while we're still
  // waiting on Google's servers.
  const cancelRef = useRef(false);

  const spec = getPlatformVideoSpec(post.platform, post.format);

  /**
   * Passthrough — the edge function now builds the full layered prompt from
   * `client_context`. The client sends only the distilled scene description.
   */
  const buildVideoPrompt = (sceneDescription: string) => sceneDescription;

  /**
   * Distill a complex storyboard/visual direction into a simple Veo scene description
   * using Claude. Falls back to extracting the first meaningful sentence.
   */
  const distillForVeo = async (rawDirection: string, postCopy: string): Promise<string> => {
    // Build brand context string for Claude
    const brandContext = [
      effectiveBrandIdentity?.visual_style ? `Visual style: ${effectiveBrandIdentity.visual_style}` : "",
      effectiveBrandIdentity?.tone_of_voice ? `Tone: ${effectiveBrandIdentity.tone_of_voice}` : "",
      effectiveBrandIdentity?.background_style ? `Environment: ${effectiveBrandIdentity.background_style}` : "",
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

  // Fetches creative-angle suggestions from the shared propose-design-angles edge function.
  const fetchAngles = async () => {
    setFetchingAngles(true);
    try {
      const { data } = await supabase.functions.invoke("propose-design-angles", {
        body: {
          brief: prompt,
          platform: post.platform,
          format: post.format,
          design_language: clientContext?.design_style_synthesis || null,
        },
      });
      if (data?.angles && Array.isArray(data.angles)) {
        const a = data.angles.slice(0, 6);
        setAngles(a);
        setSelectedAngleIdxs(Array.from({ length: Math.min(variantCount, a.length) }, (_, i) => i));
      }
    } catch (e) {
      console.warn("Failed to fetch angles:", e);
      setAngles([]);
    } finally {
      setFetchingAngles(false);
    }
  };

  // Toggle a variant's favorite state.
  const toggleFavorite = (i: number) => {
    setFavoriteIdxs((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // Insert a single variant row into post_iterations.
  const persistVariantRow = async (
    url: string,
    angle: string,
    groupId: string | null,
    isSelected: boolean,
  ) => {
    if (!clientId) {
      console.warn(
        "[CreatePostVideoButton] persistVariantRow skipped — no clientId. Variant will not persist across reloads.",
      );
      return;
    }
    const { error } = await supabase.from("post_iterations").insert({
      client_id: clientId,
      platform: post.platform || null,
      post_copy: post.copy || null,
      visual_direction: post.visual_direction || post.ai_visual_prompt || null,
      format: post.format || null,
      source: "calendar",
      media_urls: [url],
      variant_group_id: groupId,
      variant_angle: angle || null,
      is_selected: isSelected,
    } as any);
    if (error) {
      console.error("[CreatePostVideoButton] persistVariantRow failed:", error);
      toast.error(`Failed to save video variant: ${error.message}`);
    }
  };

  // "Use favorites" button: update is_selected on rows in the current variant group.
  const saveFavorites = async () => {
    if (!variantGroupId) return;
    const favoriteUrls = Array.from(favoriteIdxs)
      .map((i) => (typeof variantUrls[i] === "string" ? (variantUrls[i] as string) : null))
      .filter((u): u is string => !!u);

    await supabase
      .from("post_iterations")
      .update({ is_selected: false } as any)
      .eq("variant_group_id", variantGroupId);

    await Promise.all(
      favoriteUrls.map((url) =>
        supabase
          .from("post_iterations")
          .update({ is_selected: true } as any)
          .eq("variant_group_id", variantGroupId)
          .contains("media_urls", [url]),
      ),
    );

    if (favoriteUrls.length > 0 && onVideoGenerated) onVideoGenerated(favoriteUrls[0]);
    toast.success(`Saved ${favoriteUrls.length} favorite${favoriteUrls.length === 1 ? "" : "s"}`);
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

    if (angles.length === 0) {
      fetchAngles();
    }
  };

  const generateVideo = async () => {
    const count = Math.min(Math.max(variantCount, 1), 3);
    const groupId = crypto.randomUUID();
    setVariantGroupId(groupId);
    setLoading(true);
    setVideoUrl(null);
    setFavoriteIdxs(new Set());
    setVariantUrls(new Array(count).fill(null));
    setVariantSeeds(new Array(count).fill(null));
    cancelRef.current = false;

    // Build angle instructions for each variant.
    const angleInstructions: Array<{ label: string; instruction: string }> = [];
    if (angles.length > 0 && selectedAngleIdxs.length > 0) {
      for (let i = 0; i < count; i++) {
        const angleIdx = selectedAngleIdxs[i] ?? selectedAngleIdxs[selectedAngleIdxs.length - 1] ?? 0;
        angleInstructions.push(angles[angleIdx] || { label: "", instruction: "" });
      }
    } else {
      for (let i = 0; i < count; i++) angleInstructions.push({ label: "", instruction: "" });
    }

    // Page-level generation tracker — survives modal close so the user can
    // navigate away and still see progress / completion. Pass the groupId so
    // the "View videos" button resolves to this exact set on click. Register
    // an onCancel handler so the external Cancel button can flip our ref.
    const postKey = generation.startGeneration({
      post,
      type: "video",
      total: count,
      variantGroupId: groupId,
      onCancel: () => {
        cancelRef.current = true;
      },
    });

    // Fire all variants in parallel.
    const promises = angleInstructions.map((angle) =>
      supabase.functions.invoke("generate-post-video", {
        body: {
          prompt,
          platform: post.platform,
          format: post.format,
          brandIdentity: effectiveBrandIdentity,
          client_context: clientContext || undefined,
          post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
          variant_angle: angle.instruction || undefined,
        },
      }),
    );

    const results = await Promise.allSettled(promises);

    let firstSuccessUrl: string | null = null;

    for (let i = 0; i < results.length; i++) {
      if (cancelRef.current) {
        // User cancelled — don't persist further results or burn the
        // upload+DB writes. Whatever already finished before cancel stays.
        setVariantUrls((prev) => {
          const next = [...prev];
          if (next[i] === null) next[i] = "FAILED";
          return next;
        });
        continue;
      }
      const r = results[i];
      if (r.status === "fulfilled" && !r.value.error && r.value.data?.video_url) {
        const rawUrl = r.value.data.video_url;
        const seedUrl: string | null = r.value.data.seed_image_url || null;
        // Upload to persistent storage via upload-generated-media edge function.
        let persistentUrl = rawUrl;
        try {
          const { data: uploaded } = await supabase.functions.invoke("upload-generated-media", {
            body: {
              client_id: clientId || "unknown",
              media_data: rawUrl,
              media_type: "video",
              file_name: `video-${post.platform || "post"}-variant-${i}`,
            },
          });
          if (uploaded?.url) persistentUrl = uploaded.url;
        } catch {
          // Fall back to raw URL.
        }

        setVariantUrls((prev) => {
          const next = [...prev];
          next[i] = persistentUrl;
          return next;
        });
        setVariantSeeds((prev) => {
          const next = [...prev];
          next[i] = seedUrl;
          return next;
        });
        await persistVariantRow(persistentUrl, angleInstructions[i].instruction, groupId, false);
        generation.progressGeneration(postKey);

        if (firstSuccessUrl === null) firstSuccessUrl = persistentUrl;
      } else {
        setVariantUrls((prev) => {
          const next = [...prev];
          next[i] = "FAILED";
          return next;
        });
        generation.progressGeneration(postKey, { failed: true });
      }
    }

    generation.completeGeneration(postKey);
    setLoading(false);
    // Toast intentionally minimal — the floating GenerationProgress card now
    // surfaces the "ready" state with a View action that opens the panel.
  };

  const isVideoFormat = ["reel", "reels", "story", "stories", "tiktok", "video", "short"]
    .some((f) => (post.format || "").toLowerCase().includes(f));

  const brandColors = [
    effectiveBrandIdentity?.primary_color,
    effectiveBrandIdentity?.secondary_color,
    effectiveBrandIdentity?.accent_color,
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="h-4 w-4" /> Generate Video — {spec.label}
            </DialogTitle>
            <DialogDescription>
              Generate 2–3 video variants. Each takes 30–120 seconds.
            </DialogDescription>
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

            {/* Variant count slider — 2 to 3 (Veo is slow + expensive) */}
            <div className="space-y-2">
              <Label htmlFor="video-variant-count">Number of variants</Label>
              <div className="flex items-center gap-3">
                <Slider
                  id="video-variant-count"
                  min={2}
                  max={3}
                  step={1}
                  value={[variantCount]}
                  onValueChange={(v) => setVariantCount(v[0])}
                  disabled={loading}
                  className="flex-1"
                  aria-label="Number of video variants"
                />
                <span className="text-sm font-medium w-8 text-center">{variantCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Video generation takes 30-120 seconds per variant.
              </p>
            </div>

            {/* Suggested angles */}
            {angles.length > 0 && (
              <div className="space-y-2">
                <Label>Suggested angles</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {angles.map((a, i) => (
                    <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAngleIdxs.includes(i)}
                        disabled={loading}
                        onChange={(e) => {
                          setSelectedAngleIdxs((prev) =>
                            e.target.checked
                              ? [...prev, i].slice(0, variantCount)
                              : prev.filter((x) => x !== i),
                          );
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{a.label}.</span> {a.instruction}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {fetchingAngles && (
              <p className="text-xs text-muted-foreground">Fetching angle suggestions…</p>
            )}

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

            {/* Generate button — only when no variants yet */}
            {variantUrls.length === 0 && (
              <Button onClick={generateVideo} disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating {variantCount} variants (30-120s each)...
                  </>
                ) : (
                  <>
                    <Video className="h-4 w-4 mr-2" /> Generate {variantCount} Variants
                  </>
                )}
              </Button>
            )}

            {loading && (
              <div className="text-center py-6 space-y-3">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    {cancelRef.current
                      ? "Cancelling — waiting for in-flight Veo calls to return…"
                      : `Generating ${variantCount} ${spec.label} variants with Google Veo...`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">This may take 30-120 seconds per variant</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    cancelRef.current = true;
                    generation.cancelGeneration(postKeyOf(post));
                  }}
                  disabled={cancelRef.current}
                  className="text-red-300 hover:text-red-200 hover:bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.30)]"
                >
                  <Ban className="h-3.5 w-3.5 mr-1.5" />
                  {cancelRef.current ? "Cancelling…" : "Cancel"}
                </Button>
              </div>
            )}

            {/* Variant grid */}
            {variantUrls.length > 0 && !loading && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Tap a variant to mark it as a favorite.
                </p>
                <div className="grid gap-2 grid-cols-2">
                  {variantUrls.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleFavorite(i)}
                      disabled={url === "FAILED" || url === null}
                      className={`relative aspect-[9/16] rounded-md border overflow-hidden transition-all bg-black ${
                        favoriteIdxs.has(i) ? "ring-2 ring-primary border-primary" : ""
                      }`}
                    >
                      {url === null && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted/30">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          <span className="text-xs text-muted-foreground">~30-120s</span>
                        </div>
                      )}
                      {url === "FAILED" && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive p-2 text-center">
                          Failed
                        </div>
                      )}
                      {typeof url === "string" && url !== "FAILED" && (
                        <video src={url} className="w-full h-full object-cover" muted loop preload="metadata" />
                      )}
                      {favoriteIdxs.has(i) && (
                        <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      {angles[selectedAngleIdxs[i]] && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 truncate">
                          {angles[selectedAngleIdxs[i]].label}
                        </div>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {favoriteIdxs.size > 0 && (
                    <Button onClick={saveFavorites}>
                      Use {favoriteIdxs.size} favorite{favoriteIdxs.size === 1 ? "" : "s"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={generateVideo}>
                    <RefreshCw className="h-4 w-4 mr-1" /> Regenerate
                  </Button>
                  {variantUrls.map((url, i) => (
                    typeof url === "string" && url !== "FAILED" && (
                      <a
                        key={`dl-${i}`}
                        href={url}
                        download={`video-${post.platform || "post"}-${i + 1}.mp4`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-1" /> Variant {i + 1}
                        </Button>
                      </a>
                    )
                  ))}
                  {variantUrls.map((url, i) => (
                    typeof url === "string" && url !== "FAILED" && (
                      <Button
                        key={`edit-${i}`}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setVideoUrl(url);
                          setShowTrimmer(true);
                        }}
                      >
                        <Scissors className="h-4 w-4 mr-1" /> Trim Variant {i + 1}
                      </Button>
                    )
                  ))}
                </div>

                {/* Seed images — the brand-aligned anchor frame each video
                    was animated from. Surfacing these lets the user diagnose
                    off-brand video: if the seed itself is brand-aligned but
                    the video drifts, that's a Veo conditioning limitation; if
                    the seed is already generic, the multimodal context flow
                    needs fixing. */}
                {variantSeeds.some((s) => !!s) && (
                  <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                    <p className="text-xs text-muted-foreground tracking-[-0.2px]">
                      Seed frames (what the video was animated from). Click to view full size.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {variantSeeds.map((seedUrl, i) =>
                        seedUrl ? (
                          <button
                            key={`seed-${i}`}
                            type="button"
                            onClick={() => setPreviewSeedUrl(seedUrl)}
                            className="relative aspect-square w-16 rounded-md overflow-hidden border border-white/10 hover:border-primary/60 transition-colors"
                            title={`Variant ${i + 1} seed image`}
                          >
                            <img
                              src={seedUrl}
                              alt={`Variant ${i + 1} seed`}
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] font-bold px-1">
                              V{i + 1}
                            </span>
                          </button>
                        ) : null,
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Full-size seed image preview overlay. */}
            {previewSeedUrl && (
              <Dialog
                open={!!previewSeedUrl}
                onOpenChange={(o) => !o && setPreviewSeedUrl(null)}
              >
                <DialogContent className="max-w-3xl bg-black/95 border-white/10 p-0 overflow-hidden">
                  <img
                    src={previewSeedUrl}
                    alt="Seed image full size"
                    className="w-full h-auto max-h-[88vh] object-contain"
                  />
                </DialogContent>
              </Dialog>
            )}

            {showTrimmer && videoUrl && (
              <VideoTrimmer
                videoUrl={videoUrl}
                clientId={clientId}
                onSave={(updatedUrl, _edits) => {
                  // Replace the trimmed variant in the grid.
                  setVariantUrls((prev) => {
                    const idx = prev.indexOf(videoUrl);
                    if (idx >= 0) {
                      const next = [...prev];
                      next[idx] = updatedUrl;
                      return next;
                    }
                    return prev;
                  });
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
