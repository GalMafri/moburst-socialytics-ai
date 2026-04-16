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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Scissors, Type, Download } from "lucide-react";
import { toast } from "sonner";

export interface VideoTrimmerProps {
  videoUrl: string;
  onSave: (url: string, metadata?: VideoEditMetadata) => void;
  onClose: () => void;
}

export interface VideoEditMetadata {
  trimStart: number;
  trimEnd: number;
  overlayText?: string;
  overlayColor?: string;
  overlayPosition?: "top" | "center" | "bottom";
  fontSize?: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function VideoTrimmer({ videoUrl, onSave, onClose }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [fontSize, setFontSize] = useState(24);

  // Load video metadata
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => {
      const dur = video.duration || 0;
      setDuration(dur);
      setTrimEnd(dur);
    };
    video.addEventListener("loadedmetadata", onLoaded);
    if (video.readyState >= 1) onLoaded();
    return () => video.removeEventListener("loadedmetadata", onLoaded);
  }, [videoUrl]);

  // Track current playback time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      // Auto-pause at trim end
      if (video.currentTime >= trimEnd && !video.paused) {
        video.pause();
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [trimEnd]);

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

  const handlePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    video.play();
  };

  const handleSave = () => {
    const metadata: VideoEditMetadata = {
      trimStart,
      trimEnd,
      overlayText: overlayText.trim() || undefined,
      overlayColor,
      overlayPosition,
      fontSize,
    };

    const hasEdits = trimStart > 0.1 || Math.abs(trimEnd - duration) > 0.2 || overlayText.trim();
    if (hasEdits) {
      toast.success("Video edits saved");
    }
    onSave(videoUrl, hasEdits ? metadata : undefined);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `video-${Date.now()}.mp4`;
    link.target = "_blank";
    link.click();
  };

  // Overlay position CSS
  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: `${fontSize}px`,
    fontWeight: "bold",
    color: overlayColor,
    textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
    padding: "8px 12px",
    pointerEvents: "none",
    ...(overlayPosition === "top" && { top: "8px" }),
    ...(overlayPosition === "center" && { top: "50%", transform: "translateY(-50%)" }),
    ...(overlayPosition === "bottom" && { bottom: "48px" }), // above video controls
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" /> Edit Video
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video player with HTML text overlay */}
          <div className="relative rounded-md overflow-hidden border bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full"
              preload="metadata"
            />
            {/* Live text overlay preview */}
            {overlayText.trim() && (
              <div style={overlayStyle}>
                {overlayText}
              </div>
            )}
          </div>

          {/* Current time indicator */}
          <p className="text-xs text-center text-muted-foreground font-mono">
            {formatTime(currentTime)} / {formatTime(duration)}
          </p>

          {/* Trim controls */}
          {duration > 0 && (
            <div className="space-y-3 border rounded-lg p-3">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5" /> Trim
              </Label>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Start</span>
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formatTime(trimStart)}</span>
                </div>
                <Slider
                  min={0}
                  max={Math.max(trimEnd - 0.1, 0)}
                  step={0.1}
                  value={[trimStart]}
                  onValueChange={handleTrimStartChange}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">End</span>
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formatTime(trimEnd)}</span>
                </div>
                <Slider
                  min={Math.max(trimStart + 0.1, 0.1)}
                  max={duration}
                  step={0.1}
                  value={[trimEnd]}
                  onValueChange={handleTrimEndChange}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Duration: {formatTime(trimEnd - trimStart)}
                </p>
                <Button variant="outline" size="sm" onClick={handlePreview}>
                  Preview Trim
                </Button>
              </div>
            </div>
          )}

          {/* Text overlay */}
          <div className="space-y-3 border rounded-lg p-3">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <Type className="h-3.5 w-3.5" /> Text Overlay
            </Label>
            <Input
              placeholder="Enter overlay text (shows live on video)"
              value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)}
            />
            <div className="flex items-center gap-3 flex-wrap">
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
                <Select value={overlayPosition} onValueChange={(v) => setOverlayPosition(v as any)}>
                  <SelectTrigger className="h-7 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">Top</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="bottom">Bottom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Size</Label>
                <Input
                  type="number"
                  min={12}
                  max={72}
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="h-7 w-16 text-xs"
                />
              </div>
            </div>
            {overlayText.trim() && (
              <p className="text-xs text-muted-foreground">
                Text overlay is previewing live on the video above.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
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
