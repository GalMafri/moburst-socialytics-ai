import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Paintbrush, Download, Copy, Check, Plus, Minus, Pencil, Ban } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DesignEditor } from "@/components/editor/DesignEditor";
import type { ClientContext } from "@/lib/clientContext";
import { useGenerationContext, postKeyOf } from "@/components/reports/calendar/GenerationContext";

export interface BrandIdentity {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  visual_style?: string;
  logo_description?: string;
  tone_of_voice?: string;
  design_elements?: string;
  background_style?: string;
}

interface CreatePostDesignButtonProps {
  post: {
    ai_visual_prompt?: string;
    visual_direction?: string;
    copy?: string;
    platform?: string;
    format?: string;
    pillar?: string;
    language?: string;
  };
  /**
   * Full client context. Pass the object built in ReportView. Optional only
   * for backwards compat — components without it fall back to brandIdentity.
   */
  clientContext?: ClientContext;
  /** @deprecated — prefer clientContext.brand_identity */
  brandIdentity?: BrandIdentity | null;
  /** @deprecated — prefer clientContext.design_references */
  designReferences?: string[];
  /** @deprecated — prefer clientContext.brand_book_file_path */
  brandBookFilePath?: string;
  clientId?: string;
  onImagesGenerated?: (urls: string[]) => void;
}

const CAROUSEL_FORMATS = ["carousel", "album", "swipe", "slideshow", "multi-image", "gallery"];

function isCarouselFormat(format?: string): boolean {
  if (!format) return false;
  const f = format.toLowerCase();
  return CAROUSEL_FORMATS.some((cf) => f.includes(cf));
}

type VariantSlot = string | null | "FAILED";

export function CreatePostDesignButton({ post, clientContext, brandIdentity, designReferences, brandBookFilePath, clientId, onImagesGenerated }: CreatePostDesignButtonProps) {
  const effectiveBrandIdentity = clientContext?.brand_identity ?? brandIdentity ?? null;
  const effectiveDesignReferences = clientContext?.design_references ?? designReferences ?? [];
  const effectiveBrandBookFilePath = clientContext?.brand_book_file_path ?? brandBookFilePath ?? null;
  const isCarousel = isCarouselFormat(post.format);
  const generation = useGenerationContext();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Variant slot tracking — null=loading, string=URL, "FAILED"=error.
  // For carousels these are slide slots; for non-carousels they are variant slots.
  const [variantUrls, setVariantUrls] = useState<VariantSlot[]>([]);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState("");
  const [slideCount, setSlideCount] = useState(isCarousel ? 5 : 1);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [editableImageUrl, setEditableImageUrl] = useState<string | null>(null);
  // Phase 6 — multi-variant state. For carousels, each variant is a whole
  // N-slide deck (so 2 variants × 5 slides = 10 images total). Capped at 3
  // for carousels to keep total generation time sane (5×3=15 sequential calls).
  const [variantCount, setVariantCount] = useState(isCarousel ? 2 : 4);
  const [angles, setAngles] = useState<Array<{ label: string; instruction: string }>>([]);
  const [selectedAngleIdxs, setSelectedAngleIdxs] = useState<number[]>([]);
  const [fetchingAngles, setFetchingAngles] = useState(false);
  const [variantGroupId, setVariantGroupId] = useState<string | null>(null);
  const [favoriteIdxs, setFavoriteIdxs] = useState<Set<number>>(new Set());
  // Cancellation flag — checked by the generation loops at every iteration
  // boundary. A ref (not state) so the loop sees the update synchronously
  // without re-rendering. Set to true via the registered onCancel handler
  // OR the inline Cancel button.
  const cancelRef = useRef(false);
  const { toast } = useToast();

  const defaultPrompt =
    post.ai_visual_prompt ||
    (post.visual_direction
      ? `Create a social media post image for ${post.platform || "Instagram"}. Visual direction: ${post.visual_direction}. ${post.copy ? "Post context: " + post.copy.slice(0, 200) : ""}`
      : null);

  if (!defaultPrompt) return null;

  // Fetches the 6 creative angles from the propose-design-angles edge function.
  const fetchAngles = async () => {
    setFetchingAngles(true);
    try {
      const { data } = await supabase.functions.invoke("propose-design-angles", {
        body: {
          brief: editablePrompt || defaultPrompt,
          platform: post.platform,
          format: post.format,
          design_language: clientContext?.design_style_synthesis || null,
        },
      });
      if (data?.angles && Array.isArray(data.angles)) {
        const a = data.angles.slice(0, 6);
        setAngles(a);
        // Pre-select top N matching variantCount.
        setSelectedAngleIdxs(Array.from({ length: Math.min(variantCount, a.length) }, (_, i) => i));
      }
    } catch (e) {
      console.warn("Failed to fetch angles:", e);
      setAngles([]);
    } finally {
      setFetchingAngles(false);
    }
  };

  // Upload a base64 image URL to Supabase storage, return a public URL.
  const uploadVariantToStorage = async (dataUrl: string, idx: number): Promise<string> => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `${clientId || "unknown"}/${Date.now()}-variant-${idx}.png`;
      const { error } = await supabase.storage
        .from("generated-media")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("generated-media").getPublicUrl(path);
      return data.publicUrl;
    } catch (e) {
      console.error("Upload failed:", e);
      return dataUrl;
    }
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
        "[CreatePostDesignButton] persistVariantRow skipped — no clientId. Variant will not persist across reloads.",
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
      console.error("[CreatePostDesignButton] persistVariantRow failed:", error);
      sonnerToast.error(`Failed to save variant: ${error.message}`);
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

  // "Use favorites" button: update is_selected on rows in the current variant group.
  const saveFavorites = async () => {
    if (!variantGroupId) return;
    const favoriteUrls = Array.from(favoriteIdxs)
      .map((i) => (typeof variantUrls[i] === "string" ? (variantUrls[i] as string) : null))
      .filter((u): u is string => !!u);

    // Mark all variants in this group as not selected.
    await supabase
      .from("post_iterations")
      .update({ is_selected: false } as any)
      .eq("variant_group_id", variantGroupId);

    // Then mark favorites as selected.
    for (const url of favoriteUrls) {
      await supabase
        .from("post_iterations")
        .update({ is_selected: true } as any)
        .eq("variant_group_id", variantGroupId)
        .contains("media_urls", [url]);
    }

    if (onImagesGenerated) onImagesGenerated(favoriteUrls);
    sonnerToast.success(`Saved ${favoriteUrls.length} favorite${favoriteUrls.length === 1 ? "" : "s"}`);
  };

  const generateImages = async () => {
    const groupId = crypto.randomUUID();
    setVariantGroupId(groupId);
    setLoading(true);
    setRevisedPrompt(null);
    setFavoriteIdxs(new Set());
    // Reset cancel flag at the start of every generation.
    cancelRef.current = false;

    if (isCarousel) {
      // Carousel path: sequential slide-by-slide generation, single variant set.
      return runCarouselGeneration(groupId);
    }

    // Non-carousel path: N parallel variant generations.
    const count = Math.min(Math.max(variantCount, 1), 6);

    // Pick angle instructions. If we got angles, use the selected ones; else empty.
    const angleInstructions: Array<{ label: string; instruction: string }> = [];
    if (angles.length > 0 && selectedAngleIdxs.length > 0) {
      for (let i = 0; i < count; i++) {
        const angleIdx = selectedAngleIdxs[i] ?? selectedAngleIdxs[selectedAngleIdxs.length - 1] ?? 0;
        angleInstructions.push(angles[angleIdx] || { label: "", instruction: "" });
      }
    } else {
      for (let i = 0; i < count; i++) angleInstructions.push({ label: "", instruction: "" });
    }

    // Initialize all slots as loading.
    setVariantUrls(new Array(count).fill(null));

    // Notify the page-level generation tracker so the floating progress card
    // and the per-post overlay can render. Pass the variantGroupId so the
    // "View designs" button can filter iterations to this exact group
    // (rather than relying on the platform+copy match heuristic). Register
    // an onCancel handler so the external "Cancel" button in
    // GenerationProgress can flip our local cancelRef.
    const postKey = generation.startGeneration({
      post,
      type: "design",
      total: count,
      variantGroupId: groupId,
      onCancel: () => {
        cancelRef.current = true;
      },
    });

    // Fire all N calls in parallel.
    const promises = angleInstructions.map((angle) =>
      supabase.functions.invoke("generate-post-image", {
        body: {
          prompt: editablePrompt || defaultPrompt,
          platform: post.platform,
          format: post.format,
          brand_context: effectiveBrandIdentity || undefined,
          design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
          brand_book_file_path: effectiveBrandBookFilePath || undefined,
          client_context: clientContext || undefined,
          post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
          variant_angle: angle.instruction || undefined,
        },
      }),
    );

    const results = await Promise.allSettled(promises);

    // Process each result in order; persist to storage + DB; update UI per slot.
    // If the user cancelled mid-flight, stop uploading/persisting the remaining
    // results. (The Gemini calls were already fired before await so we can't
    // recall those, but we can avoid the storage+DB writes for everything left.)
    for (let i = 0; i < results.length; i++) {
      if (cancelRef.current) {
        setVariantUrls((prev) => {
          const next = [...prev];
          if (next[i] === null) next[i] = "FAILED";
          return next;
        });
        continue;
      }
      const r = results[i];
      if (r.status === "fulfilled" && !r.value.error && r.value.data?.image_url) {
        const dataUrl = r.value.data.image_url;
        // Upload to persistent storage.
        const uploadedUrl = await uploadVariantToStorage(dataUrl, i);
        // Update the slot.
        setVariantUrls((prev) => {
          const next = [...prev];
          next[i] = uploadedUrl;
          return next;
        });
        // Persist a variant row (initially not selected).
        await persistVariantRow(uploadedUrl, angleInstructions[i].instruction, groupId, false);
        generation.progressGeneration(postKey);
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
  };

  // Carousel path lives in its own helper for clarity.
  //
  // Each variant is a complete N-slide deck rendered through a distinct
  // creative angle. So variantCount=2 + slideCount=5 = 10 images: variant 1
  // gets slides 1..5 of angle A, variant 2 gets slides 1..5 of angle B.
  // Each variant is persisted as its OWN post_iterations row with all N slide
  // URLs in media_urls; all variants share the variant_group_id so the panel
  // groups them together.
  //
  // Critical: each slide is generated as its OWN standalone image. If we just
  // pass the same multi-slide brief to N calls, Gemini happily returns a
  // contact sheet of all N slides for each call. So we first ask Claude to
  // decompose the brief into N focused per-slide briefs, then generate.
  const runCarouselGeneration = async (groupId: string) => {
    const slides = Math.min(Math.max(slideCount, 2), 10);
    const variants = Math.min(Math.max(variantCount, 1), 3);
    const totalImages = slides * variants;
    setVariantUrls(new Array(totalImages).fill(null));

    // Page-level generation tracker — survives modal close. Total = every
    // image across every variant deck. onCancel lets the floating progress
    // card request cancellation — we set the local ref and the loop below
    // checks it at every iteration.
    const postKey = generation.startGeneration({
      post,
      type: "design",
      total: totalImages,
      variantGroupId: groupId,
      onCancel: () => {
        cancelRef.current = true;
      },
    });

    // Sanitize the raw carousel brief in case we have to fall back to it for
    // a slide call (decomposition unavailable). We want each slide call to
    // receive a brief that does NOT scream "5 slides" — otherwise Gemini
    // composes a contact sheet even with the slide_context guardrail in
    // buildImagePrompt. Best-effort regex.
    const stripMultiSlideLanguage = (s: string): string =>
      s
        .replace(/\b\d+-?slide(s)?\b/gi, "single-slide")
        .replace(/\bcarousel\b/gi, "social post")
        .replace(/\bswipe\s+(through|across|to)\b/gi, "explore")
        .replace(/\bslides?\s+\d+\s*(-|–|to)\s*\d+\b/gi, "this slide")
        .replace(/\bnext slide\b/gi, "this image")
        .replace(/\bprevious slide\b/gi, "this image")
        .replace(/\ball\s+\d+\s+slides?\b/gi, "this slide");

    // Strip bullet-list / multi-concept structure from per-slide briefs so a
    // single slide doesn't get rendered as a multi-panel layout. The
    // propose-carousel-slides system prompt asks for ONE concept per slide,
    // but Claude can still slip in "X, Y, and Z" lists. This is defense in
    // depth — keep the first sentence and the first dependent clause only.
    const collapseListsInBrief = (s: string): string => {
      // Remove markdown bullets / numbered lists entirely.
      const noBullets = s
        .replace(/^\s*[-*•]\s+.*$/gm, "")
        .replace(/^\s*\d+[.)]\s+.*$/gm, "")
        .replace(/\n{2,}/g, "\n")
        .trim();
      // If the brief still reads like a list ("X, Y, and Z"), keep only the
      // first concept.
      if (/(,\s*[^,]+){2,}\s+and\s+/i.test(noBullets) && noBullets.length > 220) {
        const firstSentence = noBullets.split(/(?<=[.!?])\s+/)[0] || noBullets;
        return firstSentence;
      }
      return noBullets;
    };

    // Decompose the carousel brief into per-slide briefs ONCE — the same
    // slide-by-slide breakdown is reused across variants (variants differ by
    // creative angle, not by content). Falls back to a sanitized shared
    // brief if decomposition fails.
    let slideBriefs: Array<{ index: number; role: string; headline?: string; content_brief: string }> = [];
    try {
      const { data: decomposed } = await supabase.functions.invoke("propose-carousel-slides", {
        body: {
          brief: editablePrompt || defaultPrompt,
          total: slides,
          platform: post.platform,
          format: post.format,
          post_copy: post.copy,
          design_language: clientContext?.design_style_synthesis || null,
        },
      });
      if (decomposed?.slides && Array.isArray(decomposed.slides)) {
        slideBriefs = decomposed.slides.slice(0, slides);
      }
    } catch (e) {
      console.warn("[CreatePostDesignButton] carousel decomposition failed, falling back to shared brief:", e);
    }

    // Pick one creative angle per variant deck. If we have angles fetched,
    // use the user's selected ones (filling from the top if they picked
    // fewer than variantCount). Otherwise use empty instructions so the
    // variants only differ by Gemini's natural sampling variance.
    const variantAngles: Array<{ label: string; instruction: string }> = [];
    for (let v = 0; v < variants; v++) {
      if (angles.length > 0 && selectedAngleIdxs.length > 0) {
        const angleIdx = selectedAngleIdxs[v] ?? selectedAngleIdxs[selectedAngleIdxs.length - 1] ?? 0;
        variantAngles.push(angles[angleIdx] || { label: "", instruction: "" });
      } else if (angles.length > 0) {
        variantAngles.push(angles[v % angles.length] || { label: "", instruction: "" });
      } else {
        variantAngles.push({ label: "", instruction: "" });
      }
    }

    // Count how many slides hit the server-side contact-sheet retry path so
    // we can show the user "fixed N contact sheets" in the success toast.
    // Helps them trust that the system is fighting against the contact-sheet
    // failure mode rather than silently giving them bad output.
    let autoFixedCount = 0;

    try {
      // Outer loop: variants. Inner loop: slides within this variant.
      // Cancel checks at both loop boundaries — once cancel is set we stop
      // firing new requests immediately. Any partial variant whose slides
      // already completed is still persisted below (don't waste finished
      // work).
      for (let v = 0; v < variants; v++) {
        if (cancelRef.current) break;
        const variantAngle = variantAngles[v];
        const variantSlides: string[] = [];

        for (let s = 0; s < slides; s++) {
          if (cancelRef.current) break;
          const globalIdx = v * slides + s;
          setCurrentSlide(globalIdx + 1);

          // Per-slide brief if decomposition succeeded; otherwise the
          // sanitized overall brief. Defense-in-depth: collapse any
          // bullet-list / multi-concept structure that slipped through.
          const slideBrief = slideBriefs[s];
          const rawPerSlide = slideBrief
            ? `${slideBrief.headline ? `Headline: ${slideBrief.headline}\n\n` : ""}${slideBrief.content_brief}`
            : stripMultiSlideLanguage(editablePrompt || defaultPrompt);
          const perSlidePrompt = collapseListsInBrief(rawPerSlide);

          const { data, error } = await supabase.functions.invoke("generate-post-image", {
            body: {
              prompt: perSlidePrompt,
              platform: post.platform,
              format: post.format,
              brand_context: effectiveBrandIdentity || undefined,
              design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
              brand_book_file_path: effectiveBrandBookFilePath || undefined,
              client_context: clientContext || undefined,
              post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
              slide_context: { index: s, total: slides },
              variant_angle: variantAngle.instruction || undefined,
            },
          });

          if (error || data?.error) {
            setVariantUrls((prev) => {
              const next = [...prev];
              next[globalIdx] = "FAILED";
              return next;
            });
            generation.progressGeneration(postKey, { failed: true });
            continue;
          }

          if (data?.image_url) {
            // The edge function does its OWN server-side contact-sheet
            // detection + retry for carousel slides; if it triggered, the
            // returned image is already the fixed version. We still run the
            // hex-codes validator as a separate guardrail (different concern).
            let finalImageUrl = data.image_url;
            if (data.was_retried) {
              autoFixedCount++;
              console.log(
                `[CreatePostDesignButton] V${v + 1} S${s + 1}: contact-sheet auto-fixed (${data.validation_reason})`,
              );
            }
            try {
              const { data: validation } = await supabase.functions.invoke("validate-design-output", {
                body: { image_data: data.image_url },
              });
              if (validation?.has_hex_codes) {
                toast({ title: "Refining design..." });
                const retryPrompt = perSlidePrompt +
                  "\n\nCRITICAL: The previous generation contained visible hex color codes as text. Do NOT render any hex codes, color codes, RGB values, or technical color notation as readable text anywhere in the image. Colors should be applied visually only.";
                const { data: retryData } = await supabase.functions.invoke("generate-post-image", {
                  body: {
                    prompt: retryPrompt,
                    platform: post.platform,
                    format: post.format,
                    brand_context: effectiveBrandIdentity || undefined,
                    design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
                    brand_book_file_path: effectiveBrandBookFilePath || undefined,
                    client_context: clientContext || undefined,
                    post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
                    slide_context: { index: s, total: slides },
                    variant_angle: variantAngle.instruction || undefined,
                  },
                });
                if (retryData?.image_url) finalImageUrl = retryData.image_url;
              }
            } catch {
              // Validation/retry failed — keep the original image.
            }

            const uploadedUrl = await uploadVariantToStorage(finalImageUrl, globalIdx);
            variantSlides.push(uploadedUrl);
            setVariantUrls((prev) => {
              const next = [...prev];
              next[globalIdx] = uploadedUrl;
              return next;
            });
            if (globalIdx === 0 && data.revised_prompt) setRevisedPrompt(data.revised_prompt);
            generation.progressGeneration(postKey);
          }
        }

        // Persist THIS variant's deck as ONE row with all its slide URLs.
        // All variants share the same variant_group_id so the panel groups
        // them together; first variant is pre-selected for the SchedulePost
        // path that picks one set to publish.
        if (clientId && variantSlides.length > 0) {
          const { error: insertErr } = await supabase.from("post_iterations").insert({
            client_id: clientId,
            platform: post.platform || null,
            post_copy: post.copy || null,
            visual_direction: post.visual_direction || post.ai_visual_prompt || null,
            format: post.format || null,
            source: "calendar",
            media_urls: variantSlides,
            variant_group_id: groupId,
            variant_angle: variantAngle.instruction || null,
            is_selected: v === 0,
          } as any);
          if (insertErr) {
            console.error("[CreatePostDesignButton] carousel variant persist failed:", insertErr);
            sonnerToast.error(`Failed to save carousel variant ${v + 1}: ${insertErr.message}`);
          }
        }

        if (v === 0 && variantSlides.length > 0 && onImagesGenerated) {
          onImagesGenerated(variantSlides);
        }
      }
      // Toast the auto-fix count so the user knows the system caught + fixed
      // contact sheets. Without this they'd never know the retry path ran.
      if (autoFixedCount > 0 && !cancelRef.current) {
        sonnerToast.success(
          `Auto-fixed ${autoFixedCount} slide${autoFixedCount === 1 ? "" : "s"} that came back as a contact sheet.`,
        );
      }
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
      generation.completeGeneration(postKey);
      setLoading(false);
      setCurrentSlide(0);
    }
  };

  const handleOpen = () => {
    // Only reset prompt if no images exist yet — preserve generated designs
    if (variantUrls.length === 0) {
      setEditablePrompt(defaultPrompt);
      setSlideCount(isCarousel ? 5 : 1);
    }
    setOpen(true);

    // Pre-fetch creative angles in the background so they're ready when the
    // user clicks Generate. For carousels each angle drives a separate
    // N-slide variant deck; for non-carousels each angle drives a single
    // variant image.
    if (angles.length === 0) {
      fetchAngles();
    }
  };

  const handleStartOver = () => {
    setEditablePrompt(defaultPrompt);
    setVariantUrls([]);
    setRevisedPrompt(null);
    setSlideCount(isCarousel ? 5 : 1);
    setEditableImageUrl(null);
    setShowEditor(false);
    setVariantGroupId(null);
    setFavoriteIdxs(new Set());
    setVariantCount(isCarousel ? 2 : 4);
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(editablePrompt || defaultPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const brandColors = [
    effectiveBrandIdentity?.primary_color,
    effectiveBrandIdentity?.secondary_color,
    effectiveBrandIdentity?.accent_color,
  ].filter(Boolean);

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleOpen}>
        <Paintbrush className="h-4 w-4 mr-1" /> Design
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>AI Post Design {isCarousel && "(Carousel)"}</DialogTitle>
            <DialogDescription>
              {isCarousel
                ? "Generate a brand-aligned carousel. Slides share a single design system."
                : "Generate brand-aligned design variants. Star the ones you want to keep."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Brand context indicator */}
            {brandColors.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
                <span className="font-medium">Brand:</span>
                <div className="flex items-center gap-1.5">
                  {brandColors.map((color, i) => (
                    <div
                      key={i}
                      className="h-5 w-5 rounded-full border shadow-sm"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
                {effectiveBrandIdentity?.visual_style && (
                  <span className="text-muted-foreground ml-1">· {effectiveBrandIdentity.visual_style}</span>
                )}
              </div>
            )}

            {/* Variant count slider — works for both single-image and carousel.
                For carousels, each variant is a whole N-slide deck — so the
                cap is lower (3) to keep total latency reasonable. */}
            <div className="space-y-2">
              <Label htmlFor="variant-count">Number of variants</Label>
              <div className="flex items-center gap-3">
                <Slider
                  id="variant-count"
                  min={isCarousel ? 1 : 2}
                  max={isCarousel ? 3 : 6}
                  step={1}
                  value={[variantCount]}
                  onValueChange={(v) => setVariantCount(v[0])}
                  disabled={loading}
                  className="flex-1"
                  aria-label="Number of design variants"
                />
                <span className="text-sm font-medium w-8 text-center">{variantCount}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {isCarousel
                  ? `Each variant = a complete ${slideCount}-slide carousel using a different creative angle. ${variantCount * slideCount} images total.`
                  : "More variants = more options to pick from. Generation runs in parallel."}
              </p>
            </div>

            {/* Slide count for carousel */}
            {isCarousel && (
              <div className="space-y-2">
                <Label>Number of slides</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setSlideCount(Math.max(2, slideCount - 1))}
                    disabled={loading}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <Input
                    type="number" min={2} max={10}
                    value={slideCount}
                    onChange={(e) => setSlideCount(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                    className="w-16 text-center"
                    disabled={loading}
                  />
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setSlideCount(Math.min(10, slideCount + 1))}
                    disabled={loading}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground">slides</span>
                </div>
              </div>
            )}

            {/* Suggested angles — used by both single-image and carousel.
                For carousels, each selected angle drives a separate N-slide
                variant deck. */}
            {angles.length > 0 && (
              <div className="space-y-2">
                <Label>
                  {isCarousel ? "Creative angles for each variant deck" : "Suggested angles"}
                </Label>
                <div className="space-y-1 max-h-40 overflow-y-auto">
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
              <div className="flex items-center justify-between">
                <Label>Visual Prompt (edit before generating)</Label>
                <Button variant="ghost" size="sm" onClick={handleCopyPrompt}>
                  {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Textarea
                value={editablePrompt}
                onChange={(e) => setEditablePrompt(e.target.value)}
                rows={5}
                className="text-sm"
              />
            </div>

            {/* Generate button */}
            {variantUrls.length === 0 && !loading && (
              <Button onClick={generateImages} className="w-full">
                <Paintbrush className="h-4 w-4 mr-2" />
                {isCarousel
                  ? `Generate ${variantCount} variant${variantCount === 1 ? "" : "s"} × ${slideCount} slides`
                  : `Generate ${variantCount} Variants`}
              </Button>
            )}

            {/* Loading state — with inline Cancel for accidental clicks. */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-6 space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground text-center">
                  {cancelRef.current
                    ? "Cancelling — finishing current request…"
                    : isCarousel
                    ? `Generating ${variantCount} variant${variantCount === 1 ? "" : "s"} (slide ${currentSlide} of ${slideCount * variantCount})…`
                    : `Generating ${variantCount} variants in parallel...`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    cancelRef.current = true;
                    // Also mark the page-level tracker as cancelled so the
                    // floating progress card reflects it immediately.
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

            {/* Variant/slide grid */}
            {variantUrls.length > 0 && !loading && (
              <div className="space-y-3">
                {!isCarousel && (
                  <p className="text-xs text-muted-foreground">
                    Tap a variant to mark it as a favorite. Favorites are saved with the post; the rest stay in the variant history.
                  </p>
                )}
                <div className={`grid gap-2 ${variantUrls.length <= 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
                  {variantUrls.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => !isCarousel && toggleFavorite(i)}
                      disabled={url === "FAILED" || url === null || isCarousel}
                      className={`relative aspect-square rounded-md border overflow-hidden transition-all ${
                        favoriteIdxs.has(i) ? "ring-2 ring-primary border-primary" : ""
                      }`}
                    >
                      {url === null && (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      )}
                      {url === "FAILED" && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive p-2 text-center">
                          Failed
                        </div>
                      )}
                      {typeof url === "string" && url !== "FAILED" && (
                        <img src={url} alt={isCarousel ? `Slide ${i + 1}` : `Variant ${i + 1}`} className="w-full h-full object-cover" />
                      )}
                      {favoriteIdxs.has(i) && (
                        <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      {!isCarousel && angles[selectedAngleIdxs[i]] && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 truncate">
                          {angles[selectedAngleIdxs[i]].label}
                        </div>
                      )}
                      {isCarousel && (() => {
                        // Map global tile index → variant + slide indices so
                        // the label shows "V1 S1", "V1 S2", ..., "V2 S1" etc.
                        // Makes it obvious which slides belong together.
                        const variantIdx = Math.floor(i / slideCount);
                        const slideIdx = (i % slideCount) + 1;
                        const variantLabelObj = (() => {
                          if (angles.length === 0) return null;
                          if (selectedAngleIdxs.length > 0) {
                            return angles[
                              selectedAngleIdxs[variantIdx] ??
                                selectedAngleIdxs[selectedAngleIdxs.length - 1] ??
                                0
                            ] || null;
                          }
                          return angles[variantIdx % angles.length] || null;
                        })();
                        return (
                          <>
                            <span className="absolute top-1 left-1 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                              V{variantIdx + 1} · S{slideIdx}/{slideCount}
                            </span>
                            {variantLabelObj && (
                              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate">
                                {variantLabelObj.label}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </button>
                  ))}
                </div>

                {revisedPrompt && (
                  <p className="text-xs text-muted-foreground italic">Refined prompt: {revisedPrompt}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {/* Favorites action — non-carousel only */}
                  {!isCarousel && favoriteIdxs.size > 0 && (
                    <Button onClick={saveFavorites}>
                      Use {favoriteIdxs.size} favorite{favoriteIdxs.size === 1 ? "" : "s"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={generateImages}>
                    <Paintbrush className="h-4 w-4 mr-1" /> Regenerate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleStartOver}>
                    New Design
                  </Button>
                  {variantUrls.map((url, i) => (
                    typeof url === "string" && url !== "FAILED" && (
                      <Button
                        key={`dl-${i}`}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const link = document.createElement("a");
                          link.href = url;
                          link.download = `post-design-${post.platform || "image"}-${i + 1}.png`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        {isCarousel ? `Slide ${i + 1}` : `Variant ${i + 1}`}
                      </Button>
                    )
                  ))}
                  {variantUrls.map((url, i) => (
                    typeof url === "string" && url !== "FAILED" && (
                      <Button
                        key={`edit-${i}`}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditableImageUrl(url);
                          setShowEditor(true);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Edit {isCarousel ? `Slide ${i + 1}` : `Variant ${i + 1}`}
                      </Button>
                    )
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showEditor && editableImageUrl && (
        <DesignEditor
          imageUrl={editableImageUrl}
          brandIdentity={effectiveBrandIdentity}
          clientId={clientId || ""}
          onSave={(dataUrl) => {
            // Replace the edited image in the variants array
            setVariantUrls((prev) => {
              const idx = prev.indexOf(editableImageUrl);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = dataUrl;
                return next;
              }
              return prev;
            });
            setEditableImageUrl(dataUrl);
            setShowEditor(false);
            sonnerToast.success("Design saved!");
            if (onImagesGenerated) {
              const stringUrls = variantUrls
                .map((u) => (u === editableImageUrl ? dataUrl : u))
                .filter((u): u is string => typeof u === "string" && u !== "FAILED");
              onImagesGenerated(stringUrls);
            }
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </>
  );
}
