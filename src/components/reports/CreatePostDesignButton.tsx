import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Paintbrush, Download, Copy, Check, Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

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
  onImagesGenerated?: (urls: string[]) => void;
}

const CAROUSEL_FORMATS = ["carousel", "album", "swipe", "slideshow", "multi-image", "gallery"];

function isCarouselFormat(format?: string): boolean {
  if (!format) return false;
  const f = format.toLowerCase();
  return CAROUSEL_FORMATS.some((cf) => f.includes(cf));
}

export function CreatePostDesignButton({ post, brandIdentity, designReferences, brandBookFilePath, onImagesGenerated }: CreatePostDesignButtonProps) {
  const isCarousel = isCarouselFormat(post.format);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState("");
  const [slideCount, setSlideCount] = useState(isCarousel ? 5 : 1);
  const [currentSlide, setCurrentSlide] = useState(0);
  const { toast } = useToast();

  const defaultPrompt =
    post.ai_visual_prompt ||
    (post.visual_direction
      ? `Create a social media post image for ${post.platform || "Instagram"}. Visual direction: ${post.visual_direction}. ${post.copy ? "Post context: " + post.copy.slice(0, 200) : ""}`
      : null);

  if (!defaultPrompt) return null;

  const generateImages = async () => {
    const prompt = editablePrompt || defaultPrompt;
    const count = isCarousel ? slideCount : 1;
    setLoading(true);
    setImageUrls([]);
    setRevisedPrompt(null);
    setCurrentSlide(0);

    const generated: string[] = [];

    try {
      for (let i = 0; i < count; i++) {
        setCurrentSlide(i + 1);
        const slidePrompt = count > 1
          ? `${prompt}\n\nThis is slide ${i + 1} of ${count} in a carousel post. ${i === 0 ? "This is the cover/hook slide — make it attention-grabbing." : `This is slide ${i + 1} — continue the visual story with a distinct but cohesive design.`} Maintain consistent brand colors and style across all slides.`
          : prompt;

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
          generated.push(data.image_url);
          setImageUrls([...generated]);
        }
        if (i === 0 && data.revised_prompt) {
          setRevisedPrompt(data.revised_prompt);
        }
      }

      if (generated.length > 0 && onImagesGenerated) {
        onImagesGenerated(generated);
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
    setEditablePrompt(defaultPrompt);
    setImageUrls([]);
    setRevisedPrompt(null);
    setSlideCount(isCarousel ? 5 : 1);
    setOpen(true);
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
                <div className="flex gap-2">
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
                  <Button variant="outline" size="sm" onClick={generateImages}>
                    <Paintbrush className="h-4 w-4 mr-1" /> Regenerate
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
