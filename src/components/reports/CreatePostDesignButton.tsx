import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Paintbrush, Download, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface BrandIdentity {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  font_family?: string;
  visual_style?: string;
  logo_description?: string;
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
}

export function CreatePostDesignButton({ post, brandIdentity }: CreatePostDesignButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [revisedPrompt, setRevisedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const prompt =
    post.ai_visual_prompt ||
    (post.visual_direction
      ? `Create a social media post image for ${post.platform || "Instagram"}. Visual direction: ${post.visual_direction}. ${post.copy ? "Post context: " + post.copy.slice(0, 200) : ""}`
      : null);

  if (!prompt) return null;

  const generateImage = async () => {
    setLoading(true);
    setImageUrl(null);
    setRevisedPrompt(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-post-image", {
        body: {
          prompt,
          platform: post.platform,
          format: post.format,
          brand_context: brandIdentity || undefined,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setImageUrl(data.image_url);
      setRevisedPrompt(data.revised_prompt || null);
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
    setOpen(true);
    if (!imageUrl && !loading) {
      generateImage();
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
            {brandIdentity?.primary_color && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Brand colors:</span>
                {[brandIdentity.primary_color, brandIdentity.secondary_color, brandIdentity.accent_color]
                  .filter(Boolean)
                  .map((color, i) => (
                    <div
                      key={i}
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
              </div>
            )}

            {/* Prompt display */}
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-muted-foreground">AI Visual Prompt</span>
                <Button variant="ghost" size="sm" onClick={handleCopyPrompt}>
                  {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-sm">{prompt}</p>
            </div>

            {/* Loading state */}
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-sm text-muted-foreground">Generating on-brand image...</p>
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
                  <Button variant="outline" size="sm" onClick={() => {
                    const link = document.createElement("a");
                    link.href = imageUrl!;
                    link.download = `post-design-${post.platform || "image"}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}>
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
