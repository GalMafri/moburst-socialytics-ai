import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Plus, Sparkles, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PlatformBadge } from "@/lib/platform-config";
import { CreatePostDesignButton } from "@/components/reports/CreatePostDesignButton";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";

interface CreateAdHocPostProps {
  clientId: string;
  platforms: string[];
  brandIdentity: any;
  onPostCreated?: (post: any) => void;
}

const CREATIVE_TYPES = [
  { value: "ai_decides", label: "AI Decides" },
  { value: "Image", label: "Image" },
  { value: "Carousel", label: "Carousel" },
  { value: "Video", label: "Video" },
  { value: "Reel", label: "Reel" },
  { value: "Story", label: "Story" },
];

export function CreateAdHocPost({
  clientId,
  platforms,
  brandIdentity,
  onPostCreated,
}: CreateAdHocPostProps) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("");
  const [topic, setTopic] = useState("");
  const [creativeType, setCreativeType] = useState("ai_decides");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPost, setGeneratedPost] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const resetForm = () => {
    setPlatform("");
    setTopic("");
    setCreativeType("ai_decides");
    setGeneratedPost(null);
    setCopied(false);
  };

  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) resetForm();
  };

  const handleGenerate = async () => {
    if (!platform || !topic.trim()) {
      toast.error("Please select a platform and enter a topic");
      return;
    }
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-ad-hoc-post",
        {
          body: {
            client_id: clientId,
            platform,
            topic: topic.trim(),
            creative_type:
              creativeType === "ai_decides" ? undefined : creativeType,
          },
        }
      );
      if (error) throw error;
      if (data?.post) {
        setGeneratedPost(data.post);
        // Save to post_iterations
        await supabase.from("post_iterations").insert({
          client_id: clientId,
          version: 1,
          platform: data.post.platform,
          post_copy: data.post.caption_angle,
          cta: data.post.CTA,
          concept: data.post.concept,
          visual_direction: data.post.visual_direction,
          format: data.post.format,
          source: "ad_hoc",
        });
        toast.success("Post generated!");
        onPostCreated?.(data.post);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to generate post");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCaptions = () => {
    if (!generatedPost) return;
    const fullText =
      (generatedPost.caption_angle || "") +
      (generatedPost.hashtags
        ? "\n\n" +
          (typeof generatedPost.hashtags === "string"
            ? generatedPost.hashtags
            : Array.isArray(generatedPost.hashtags)
              ? generatedPost.hashtags
                  .map((h: string) => (h.startsWith("#") ? h : `#${h}`))
                  .join(" ")
              : "")
        : "");
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGenerateAnother = () => {
    setGeneratedPost(null);
    setCopied(false);
  };

  const isVideoFormat =
    generatedPost?.format &&
    /video|reel|story/i.test(generatedPost.format);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" /> Create Post
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a New Post</DialogTitle>
          <DialogDescription>
            Generate an AI-powered post outside your content calendar
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Form fields */}
          {!generatedPost && (
            <>
              <div className="space-y-2">
                <Label>Platform</Label>
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a platform" />
                  </SelectTrigger>
                  <SelectContent>
                    {platforms.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Topic</Label>
                <Textarea
                  placeholder="What should this post be about? E.g., 'Our new summer menu launch' or 'Behind the scenes at the office'"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label>Creative Type</Label>
                <Select value={creativeType} onValueChange={setCreativeType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREATIVE_TYPES.map((ct) => (
                      <SelectItem key={ct.value} value={ct.value}>
                        {ct.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !platform || !topic.trim()}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Post
                  </>
                )}
              </Button>
            </>
          )}

          {/* Generated post result */}
          {generatedPost && (
            <div className="space-y-4">
              {/* Post card */}
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <PlatformBadge
                    platform={generatedPost.platform}
                    size="sm"
                  />
                  <Badge variant="outline">{generatedPost.format}</Badge>
                  {generatedPost.pillar && (
                    <Badge className="bg-accent text-accent-foreground text-xs">
                      {generatedPost.pillar}
                    </Badge>
                  )}
                </div>

                {generatedPost.hook && (
                  <blockquote className="border-l-2 border-primary pl-4 text-sm font-medium leading-relaxed">
                    {generatedPost.hook}
                  </blockquote>
                )}

                {generatedPost.concept && (
                  <p className="text-sm leading-relaxed">
                    {generatedPost.concept}
                  </p>
                )}

                {generatedPost.caption_angle && (
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">
                      Caption
                    </p>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                      {generatedPost.caption_angle}
                    </p>
                  </div>
                )}

                {generatedPost.CTA && (
                  <div className="text-sm">
                    <span className="font-medium text-foreground">CTA: </span>
                    <span className="text-muted-foreground">
                      {generatedPost.CTA}
                    </span>
                  </div>
                )}

                {generatedPost.visual_direction && (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Visual:{" "}
                    </span>
                    {generatedPost.visual_direction}
                  </p>
                )}

                {generatedPost.hashtags && (
                  <div className="flex flex-wrap gap-1.5">
                    {(typeof generatedPost.hashtags === "string"
                      ? generatedPost.hashtags.split(/\s+/)
                      : Array.isArray(generatedPost.hashtags)
                        ? generatedPost.hashtags
                        : []
                    ).map((tag: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tag.startsWith("#") ? tag : `#${tag}`}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <CreatePostDesignButton
                  post={{
                    visual_direction: generatedPost.visual_direction,
                    copy: generatedPost.caption_angle,
                    platform: generatedPost.platform,
                    format: generatedPost.format,
                  }}
                  brandIdentity={brandIdentity}
                />
                {isVideoFormat && (
                  <CreatePostVideoButton
                    post={{
                      visual_direction: generatedPost.visual_direction,
                      concept: generatedPost.concept,
                      copy: generatedPost.caption_angle,
                      platform: generatedPost.platform,
                      format: generatedPost.format,
                    }}
                    brandIdentity={brandIdentity}
                  />
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCaptions}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 mr-1" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-1" /> Copy Caption
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateAnother}
                >
                  <RefreshCw className="h-4 w-4 mr-1" /> Generate Another
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
