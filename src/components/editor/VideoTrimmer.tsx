import { useState, useRef, useEffect, useCallback } from "react";
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
import { Save, Scissors, Type, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface VideoTrimmerProps {
  videoUrl: string;
  onSave: (trimmedVideoUrl: string) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
}

export function VideoTrimmer({ videoUrl, onSave, onClose }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [fontSize, setFontSize] = useState(32);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);

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

  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      if (!overlayText.trim()) return;

      ctx.save();
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";

      // Text shadow for readability
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      ctx.fillStyle = overlayColor;

      let y: number;
      if (overlayPosition === "top") y = fontSize + 20;
      else if (overlayPosition === "center") y = height / 2 + fontSize / 3;
      else y = height - 20;

      ctx.fillText(overlayText, width / 2, y);
      ctx.restore();
    },
    [overlayText, overlayColor, overlayPosition, fontSize],
  );

  // Preview with overlay
  const handlePreview = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    video.currentTime = trimStart;
    video.play();
    setIsPreviewing(true);

    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;

    const renderFrame = () => {
      if (video.paused || video.ended || video.currentTime >= trimEnd) {
        video.pause();
        setIsPreviewing(false);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawOverlay(ctx, canvas.width, canvas.height);
      requestAnimationFrame(renderFrame);
    };

    video.addEventListener("play", () => requestAnimationFrame(renderFrame), { once: true });
  };

  // Process and export video with trim + overlay
  const handleSave = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    // If no changes made, just return the original
    const noTrim = trimStart === 0 && Math.abs(trimEnd - duration) < 0.2;
    const noOverlay = !overlayText.trim();
    if (noTrim && noOverlay) {
      onSave(videoUrl);
      return;
    }

    setIsProcessing(true);
    toast.info("Processing video...");

    try {
      const ctx = canvas.getContext("2d")!;
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;

      // Use MediaRecorder to capture canvas stream
      const stream = canvas.captureStream(30);

      // Try to capture audio from the video element
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        source.connect(audioCtx.destination); // keep audible during processing
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } catch {
        // No audio capture support — video will be silent
      }

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const recordingDone = new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          resolve(new Blob(chunks, { type: mimeType }));
        };
      });

      // Start recording
      recorder.start();

      // Play video from trim start
      video.currentTime = trimStart;
      video.muted = true;
      await video.play();

      // Render frames with overlay
      const renderLoop = () => {
        if (video.currentTime >= trimEnd || video.paused || video.ended) {
          video.pause();
          recorder.stop();
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawOverlay(ctx, canvas.width, canvas.height);
        requestAnimationFrame(renderLoop);
      };
      requestAnimationFrame(renderLoop);

      // Wait for recording to finish
      const blob = await recordingDone;
      const exportUrl = URL.createObjectURL(blob);

      video.muted = false;
      onSave(exportUrl);
      toast.success("Video processed!");
    } catch (err: any) {
      console.error("Video processing error:", err);
      toast.error("Video processing failed — saving original");
      onSave(videoUrl);
    } finally {
      setIsProcessing(false);
    }
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
          {/* Video player (hidden when previewing canvas) */}
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className={`w-full rounded-md border ${isPreviewing ? "hidden" : ""}`}
            preload="metadata"
            crossOrigin="anonymous"
          />

          {/* Canvas for preview with overlay */}
          <canvas
            ref={canvasRef}
            className={`w-full rounded-md border ${isPreviewing ? "" : "hidden"}`}
          />

          {/* Trim controls */}
          {duration > 0 && (
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Scissors className="h-3.5 w-3.5" /> Trim
              </Label>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Start</span>
                  <span className="text-xs font-mono">{formatTime(trimStart)}</span>
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
                  <span className="text-xs text-muted-foreground">End</span>
                  <span className="text-xs font-mono">{formatTime(trimEnd)}</span>
                </div>
                <Slider
                  min={Math.max(trimStart + 0.1, 0.1)}
                  max={duration}
                  step={0.1}
                  value={[trimEnd]}
                  onValueChange={handleTrimEndChange}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Duration: {formatTime(trimEnd - trimStart)}
              </p>
            </div>
          )}

          {/* Text overlay */}
          <div className="space-y-2 border-t pt-3">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <Type className="h-3.5 w-3.5" /> Text Overlay
            </Label>
            <Input
              placeholder="Enter overlay text (optional)"
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
                <select
                  value={overlayPosition}
                  onChange={(e) =>
                    setOverlayPosition(e.target.value as "top" | "center" | "bottom")
                  }
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
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
          </div>

          {/* Preview button */}
          {(overlayText.trim() || trimStart > 0 || trimEnd < duration) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handlePreview}
              disabled={isPreviewing || isProcessing}
            >
              <Play className="h-3 w-3 mr-1" />
              {isPreviewing ? "Previewing..." : "Preview Changes"}
            </Button>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isProcessing}>
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-1" /> Save Video
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
