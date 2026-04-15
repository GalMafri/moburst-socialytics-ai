import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Save, Scissors, Type } from "lucide-react";
import { toast } from "sonner";

export interface VideoTrimmerProps {
  videoUrl: string;
  onSave: (trimmedVideoUrl: string) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoTrimmer({ videoUrl, onSave, onClose }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "center" | "bottom">("bottom");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      const dur = video.duration || 0;
      setDuration(dur);
      setTrimEnd(dur);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [videoUrl]);

  const handleTrimStartChange = (value: number[]) => {
    const v = value[0];
    setTrimStart(v);
    if (videoRef.current) videoRef.current.currentTime = v;
  };

  const handleTrimEndChange = (value: number[]) => {
    const v = value[0];
    setTrimEnd(v);
    if (videoRef.current) videoRef.current.currentTime = v;
  };

  const handleSave = () => {
    // For now, return the original URL along with trim & overlay metadata
    // Full client-side video processing can be added later
    const metadata = {
      originalUrl: videoUrl,
      trimStart,
      trimEnd,
      overlayText: overlayText || null,
      overlayColor,
      overlayPosition,
    };
    console.log("VideoTrimmer metadata:", metadata);
    onSave(videoUrl);
    toast.success("Video saved with overlay settings.");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" /> Trim & Overlay
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video player */}
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="w-full rounded-md border"
            preload="metadata"
          />

          {/* Trim controls */}
          {duration > 0 && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Trim Start</Label>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(trimStart)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={Math.max(trimEnd - 0.1, 0)}
                  step={0.1}
                  value={[trimStart]}
                  onValueChange={handleTrimStartChange}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Trim End</Label>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(trimEnd)}
                  </span>
                </div>
                <Slider
                  min={Math.max(trimStart + 0.1, 0.1)}
                  max={duration}
                  step={0.1}
                  value={[trimEnd]}
                  onValueChange={handleTrimEndChange}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Selected: {formatTime(trimStart)} &ndash; {formatTime(trimEnd)}{" "}
                ({formatTime(trimEnd - trimStart)})
              </p>
            </div>
          )}

          {/* Text overlay */}
          <div className="space-y-2 border-t pt-3">
            <Label className="flex items-center gap-1.5 text-sm">
              <Type className="h-3.5 w-3.5" /> Text Overlay
            </Label>
            <Input
              placeholder="Title text (optional)"
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Color</Label>
                <Input
                  type="color"
                  value={overlayColor}
                  onChange={(e) => setOverlayColor(e.target.value)}
                  className="h-7 w-8 p-0.5 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Position</Label>
                <select
                  value={overlayPosition}
                  onChange={(e) =>
                    setOverlayPosition(
                      e.target.value as "top" | "center" | "bottom"
                    )
                  }
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="h-4 w-4 mr-1" /> Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
