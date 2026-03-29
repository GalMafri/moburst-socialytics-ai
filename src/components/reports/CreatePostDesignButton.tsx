import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Paintbrush, Download, Copy, Check } from "lucide-react";
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
  onImageGenerated?: (url: string) => void;
}

export function CreatePostDesignButton({ post, brandIdentity, designReferences, brandBookFilePath, onImageGenerated }: CreatePostDesignButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editablePrompt, setEditablePrompt] = useState("");
  const { toast } = useToast();

  const defaultPrompt =
    post.ai_visual_prompt ||
    (post.visual_direction
      ? `Create a social media post image for ${post.platform || "Instagram"}. Visual direction: ${post.visual_direction}. ${post.copy ? "Post context: " + post.copy.slice(0, 200) : ""}`
      : null);

  if (!defaultPrompt) return null;

  const generateImage = async () => {
    const prompt = editablePrompt || defaultPrompt;
    setLoading(true);
    setImageUrl(null);
    setRevisedPrompt(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-post-image", {
        body: {
          prompt: editablePrompt || defaultPrompt,
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

      setImageUrl(data.image_url);
      setRevisedPrompt(data.revised_prompt || null);
      if (data.image_url && onImageGenerated) {
        onImageGenerated(data.image_url);
      }
    } catch (err: any) {
      toast({
        title: "Image generation failed",
        description: err.message || "Could not generate image. Check API key configuration.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    if (!editablePrompt) {
      setEditablePrompt(defaultPrompt);
    }
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Post Design</DialogTitle>
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
            {!imageUrl && !loading && (
              <Button onClick={generateImage} className="w-full">
                <Paintbrush className="h-4 w-4 mr-2" /> Generate Design
              </Button>
            )}

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">Generating on-brand design...</p>
                <p className="text-xs text-muted-foreground mt-1">This may take 15-30 seconds</p>
              </div>
            )}

            {/* Generated image */}
            {imageUrl && !loading && (
              <div className="space-y-3">
                <img src={imageUrl} alt="Generated post design" className="w-full rounded-lg border" />
                {revisedPrompt && (
                  <p className="text-xs text-muted-foreground italic">Refined prompt: {revisedPrompt}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const link = document.createElement("a");
                      link.href = imageUrl!;
                      link.download = `post-design-${post.platform || "image"}.png`;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                    }}
                  >
                    <Download className="h-4 w-4 mr-1" /> Download
                  </Button>
                  <Button variant="outline" size="sm" onClick={generateImage}>
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
