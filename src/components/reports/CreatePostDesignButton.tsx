import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Paintbrush, Download, Copy, Check, Plus, Minus, Pencil } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DesignEditor } from "@/components/editor/DesignEditor";
import type { ClientContext } from "@/lib/clientContext";

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
  // Phase 6 — multi-variant state.
  const [variantCount, setVariantCount] = useState(isCarousel ? 1 : 4);
  const [angles, setAngles] = useState<Array<{ label: string; instruction: string }>>([]);
  const [selectedAngleIdxs, setSelectedAngleIdxs] = useState<number[]>([]);
  const [fetchingAngles, setFetchingAngles] = useState(false);
  const [variantGroupId, setVariantGroupId] = useState<string | null>(null);
  const [favoriteIdxs, setFavoriteIdxs] = useState<Set<number>>(new Set());
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
    if (!clientId) return;
    await supabase.from("post_iterations").insert({
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
    for (let i = 0; i < results.length; i++) {
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
      } else {
        setVariantUrls((prev) => {
          const next = [...prev];
          next[i] = "FAILED";
          return next;
        });
      }
    }

    setLoading(false);
  };

  // Carousel path lives in its own helper for clarity.
  const runCarouselGeneration = async (groupId: string) => {
    const count = slideCount;
    const generated: string[] = [];
    setVariantUrls(new Array(count).fill(null));

    try {
      for (let i = 0; i < count; i++) {
        setCurrentSlide(i + 1);
        const { data, error } = await supabase.functions.invoke("generate-post-image", {
          body: {
            prompt: editablePrompt || defaultPrompt,
            platform: post.platform,
            format: post.format,
            brand_context: effectiveBrandIdentity || undefined,
            design_references: effectiveDesignReferences.length > 0 ? effectiveDesignReferences : undefined,
            brand_book_file_path: effectiveBrandBookFilePath || undefined,
            client_context: clientContext || undefined,
            post: { pillar: post.pillar, language: post.language, visual_direction: post.visual_direction, copy: post.copy },
            slide_context: count > 1 ? { index: i, total: count } : undefined,
          },
        });
        if (error || data?.error) {
          setVariantUrls((prev) => {
            const next = [...prev];
            next[i] = "FAILED";
            return next;
          });
          continue;
        }
        if (data?.image_url) {
          // Existing hex validation/retry path preserved.
          let finalImageUrl = data.image_url;
          try {
            const { data: validation } = await supabase.functions.invoke("validate-design-output", {
              body: { image_data: data.image_url },
            });
            if (validation?.has_hex_codes) {
              toast({ title: "Refining design..." });
              const retryPrompt = (editablePrompt || defaultPrompt) +
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
                  slide_context: count > 1 ? { index: i, total: count } : undefined,
                },
              });
              if (retryData?.image_url) finalImageUrl = retryData.image_url;
            }
          } catch {
            // Validation or retry failed — keep the original image
          }

          const uploadedUrl = await uploadVariantToStorage(finalImageUrl, i);
          generated.push(uploadedUrl);
          setVariantUrls((prev) => {
            const next = [...prev];
            next[i] = uploadedUrl;
            return next;
          });
          if (i === 0 && data.revised_prompt) setRevisedPrompt(data.revised_prompt);
        }
      }

      // Carousel: persist ONE row with all slide URLs, marked selected by default.
      if (clientId && generated.length > 0) {
        await supabase.from("post_iterations").insert({
          client_id: clientId,
          platform: post.platform || null,
          post_copy: post.copy || null,
          visual_direction: post.visual_direction || post.ai_visual_prompt || null,
          format: post.format || null,
          source: "calendar",
          media_urls: generated,
          variant_group_id: groupId,
          variant_angle: null,
          is_selected: true,
        } as any);
        if (onImagesGenerated) onImagesGenerated(generated);
      }
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    } finally {
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

    // For non-carousels: pre-fetch angles in the background so they're ready when user clicks Generate.
    if (!isCarousel && angles.length === 0) {
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
    setVariantCount(isCarousel ? 1 : 4);
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

            {/* Variant count slider — non-carousel only */}
            {!isCarousel && (
              <div className="space-y-2">
                <Label htmlFor="variant-count">Number of variants</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    id="variant-count"
                    min={2}
                    max={6}
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
                  More variants = more options to pick from. Generation runs in parallel.
                </p>
              </div>
            )}

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

            {/* Suggested angles — non-carousel only */}
            {!isCarousel && angles.length > 0 && (
              <div className="space-y-2">
                <Label>Suggested angles</Label>
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

            {!isCarousel && fetchingAngles && (
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
                {isCarousel ? `Generate ${slideCount} Slides` : `Generate ${variantCount} Variants`}
              </Button>
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">
                  {isCarousel
                    ? `Generating slide ${currentSlide} of ${slideCount}...`
                    : `Generating ${variantCount} variants in parallel...`}
                </p>
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
                      {isCarousel && (
                        <span className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                          {i + 1}/{variantUrls.length}
                        </span>
                      )}
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
