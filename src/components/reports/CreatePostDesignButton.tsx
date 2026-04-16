import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Paintbrush, Download, Copy, Check, Plus, Minus, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DesignEditor } from "@/components/editor/DesignEditor";

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
  };
  brandIdentity?: BrandIdentity | null;
  designReferences?: string[];
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

export function CreatePostDesignButton({ post, brandIdentity, designReferences, brandBookFilePath, clientId, onImagesGenerated }: CreatePostDesignButtonProps) {
  const isCarousel = isCarouselFormat(post.format);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState("");
  const [slideCount, setSlideCount] = useState(isCarousel ? 5 : 1);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showEditor, setShowEditor] = useState(false);
  const [editableImageUrl, setEditableImageUrl] = useState<string | null>(null);
  const { toast } = useToast();

  const defaultPrompt =
    post.ai_visual_prompt ||
    (post.visual_direction
      ? `Create a social media post image for ${post.platform || "Instagram"}. Visual direction: ${post.visual_direction}. ${post.copy ? "Post context: " + post.copy.slice(0, 200) : ""}`
      : null);

  if (!defaultPrompt) return null;

  const generateImages = async () => {
    let designPrompt = editablePrompt || defaultPrompt;
    const count = isCarousel ? slideCount : 1;
    setLoading(true);
    setImageUrls([]);
    setRevisedPrompt(null);
    setCurrentSlide(0);

    const generated: string[] = [];

    try {
      // Detect format mismatch: post recommended video/reel but user is generating an image
      const postFormat = (post.format || "").toLowerCase();
      const isVideoRecommendation = postFormat.includes("video") || postFormat.includes("reel");
      if (isVideoRecommendation) {
        try {
          const { data: adapted } = await supabase.functions.invoke("adapt-creative-prompt", {
            body: {
              concept: post.copy || "",
              visual_direction: designPrompt,
              original_format: post.format,
              target_format: "Image",
              platform: post.platform,
            },
          });
          if (adapted?.adapted_prompt) {
            designPrompt = adapted.adapted_prompt;
          }
        } catch (e) {
          // Silently fall through — use original prompt
        }
      }

      for (let i = 0; i < count; i++) {
        setCurrentSlide(i + 1);
        const slidePrompt = count > 1
          ? `${designPrompt}\n\nThis is slide ${i + 1} of ${count} in a carousel post. ${i === 0 ? "This is the cover/hook slide — make it attention-grabbing." : `This is slide ${i + 1} — continue the visual story with a distinct but cohesive design.`} Maintain consistent brand colors and style across all slides.`
          : designPrompt;

        const { data, error } = await supabase.functions.invoke("generate-post-image", {
          body: {
            prompt: slidePrompt,
            platform: post.platform,
            format: post.format,
            brand_context: brandIdentity || undefined,
            design_references: designReferences || undefined,
            brand_book_file_path: brandBookFilePath || undefined,
          },
        });

        if (error) {
          const detail = typeof data === "object" && data?.error ? data.error : error.message;
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);

        if (data.image_url) {
          // Validate the generated image for visible hex codes
          let finalImageUrl = data.image_url;
          try {
            const { data: validation } = await supabase.functions.invoke("validate-design-output", {
              body: { image_data: data.image_url },
            });
            if (validation?.has_hex_codes) {
              toast({ title: "Refining design..." });
              const retryPrompt = slidePrompt + "\n\nCRITICAL: The previous generation contained visible hex color codes as text. Do NOT render any hex codes, color codes, RGB values, or technical color notation as readable text anywhere in the image. Colors should be applied visually only.";
              const { data: retryData } = await supabase.functions.invoke("generate-post-image", {
                body: {
                  prompt: retryPrompt,
                  platform: post.platform,
                  format: post.format,
                  brand_context: brandIdentity || undefined,
                  design_references: designReferences || undefined,
                  brand_book_file_path: brandBookFilePath || undefined,
                },
              });
              if (retryData?.image_url) {
                finalImageUrl = retryData.image_url;
              }
            }
          } catch {
            // Validation or retry failed — keep the original image
          }

          generated.push(finalImageUrl);
          setImageUrls([...generated]);
        }
        if (i === 0 && data.revised_prompt) {
          setRevisedPrompt(data.revised_prompt);
        }
      }

      // Upload generated images to persistent storage
      const persistentUrls: string[] = [];
      for (let i = 0; i < generated.length; i++) {
        try {
          const { data: uploaded } = await supabase.functions.invoke("upload-generated-media", {
            body: {
              client_id: clientId || "unknown",
              media_data: generated[i],
              media_type: "image",
              file_name: `design-${post.platform || "post"}-slide${i + 1}`,
            },
          });
          if (uploaded?.url) {
            console.log("Image uploaded to storage:", uploaded.url);
            persistentUrls.push(uploaded.url);
          } else {
            console.warn("Upload returned no URL, falling back to base64. Response:", uploaded);
            persistentUrls.push(generated[i]);
          }
        } catch (uploadErr) {
          console.error("Image upload failed:", uploadErr);
          persistentUrls.push(generated[i]);
        }
      }

      // Update local state with persistent URLs
      const finalUrls = persistentUrls.length > 0 ? persistentUrls : generated;
      setImageUrls(finalUrls);

      // Save to post_iterations with media_urls
      if (clientId) {
        supabase.from("post_iterations").insert({
          client_id: clientId,
          platform: post.platform || null,
          post_copy: post.copy || null,
          visual_direction: post.visual_direction || post.ai_visual_prompt || null,
          format: post.format || null,
          source: "calendar",
          media_urls: finalUrls,
        } as any).then(() => {}, (err: any) => console.error("post_iterations save failed:", err));
      }

      if (finalUrls.length > 0 && onImagesGenerated) {
        onImagesGenerated(finalUrls);
      }
    } catch (err: any) {
      // Keep any images generated so far
      if (generated.length > 0) {
        setImageUrls(generated);
        if (onImagesGenerated) onImagesGenerated(generated);
        toast({
          title: `Generated ${generated.length} of ${count} slides`,
          description: err.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Image generation failed",
          description: err.message || "Could not generate image. Check API key configuration.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
      setCurrentSlide(0);
    }
  };

  const handleOpen = () => {
    // Only reset prompt if no images exist yet — preserve generated designs
    if (imageUrls.length === 0) {
      setEditablePrompt(defaultPrompt);
      setSlideCount(isCarousel ? 5 : 1);
    }
    setOpen(true);
  };

  const handleStartOver = () => {
    setEditablePrompt(defaultPrompt);
    setImageUrls([]);
    setRevisedPrompt(null);
    setSlideCount(isCarousel ? 5 : 1);
    setEditableImageUrl(null);
    setShowEditor(false);
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(editablePrompt || defaultPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const brandColors = [
    brandIdentity?.primary_color,
    brandIdentity?.secondary_color,
    brandIdentity?.accent_color,
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
          </DialogHeader>

          <div className="space-y-4">
            {/* Brand context indicator */}
            {brandColors.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground rounded-lg bg-muted/50 px-3 py-2">
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
                {brandIdentity?.visual_style && (
                  <span className="text-muted-foreground ml-1">· {brandIdentity.visual_style}</span>
                )}
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
            {imageUrls.length === 0 && !loading && (
              <Button onClick={generateImages} className="w-full">
                <Paintbrush className="h-4 w-4 mr-2" />
                {isCarousel ? `Generate ${slideCount} Slides` : "Generate Design"}
              </Button>
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">
                  {isCarousel
                    ? `Generating slide ${currentSlide} of ${slideCount}...`
                    : "Generating on-brand design..."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {isCarousel ? `~${slideCount * 20} seconds total` : "This may take 15-30 seconds"}
                </p>
                {/* Show slides generated so far */}
                {imageUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-4 w-full">
                    {imageUrls.map((url, i) => (
                      <img key={i} src={url} alt={`Slide ${i + 1}`} className="w-full rounded border" />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Generated images */}
            {imageUrls.length > 0 && !loading && (
              <div className="space-y-3">
                {imageUrls.length === 1 ? (
                  <img src={imageUrls[0]} alt="Generated post design" className="w-full rounded-lg border" />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {imageUrls.map((url, i) => (
                      <div key={i} className="relative">
                        <img src={url} alt={`Slide ${i + 1}`} className="w-full rounded-lg border" />
                        <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                          {i + 1}/{imageUrls.length}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {revisedPrompt && (
                  <p className="text-xs text-muted-foreground italic">Refined prompt: {revisedPrompt}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {imageUrls.map((url, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `post-design-${post.platform || "image"}${imageUrls.length > 1 ? `-${i + 1}` : ""}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {imageUrls.length > 1 ? `Slide ${i + 1}` : "Download"}
                    </Button>
                  ))}
                  {imageUrls.length === 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditableImageUrl(imageUrls[0]);
                        setShowEditor(true);
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-1" /> Edit Design
                    </Button>
                  )}
                  {imageUrls.length > 1 &&
                    imageUrls.map((url, i) => (
                      <Button
                        key={`edit-${i}`}
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditableImageUrl(url);
                          setShowEditor(true);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-1" /> Edit {i + 1}
                      </Button>
                    ))}
                  <Button variant="outline" size="sm" onClick={generateImages}>
                    <Paintbrush className="h-4 w-4 mr-1" /> Regenerate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleStartOver}>
                    New Design
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showEditor && editableImageUrl && (
        <DesignEditor
          imageUrl={editableImageUrl}
          brandIdentity={brandIdentity}
          clientId={clientId || ""}
          onSave={(dataUrl) => {
            // Replace the edited image in the array
            setImageUrls((prev) => {
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
              onImagesGenerated(
                imageUrls.map((u) => (u === editableImageUrl ? dataUrl : u))
              );
            }
          }}
          onClose={() => setShowEditor(false)}
        />
      )}
    </>
  );
}
