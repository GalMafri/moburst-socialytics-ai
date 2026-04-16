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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Scissors, Type, Download, Play, Loader2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";

export interface VideoTrimmerProps {
  videoUrl: string;
  onSave: (url: string, metadata?: VideoEditMetadata) => void;
  onClose: () => void;
  onThumbnailReady?: (thumbnailDataUrl: string) => void;
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

export function VideoTrimmer({ videoUrl, onSave, onClose, onThumbnailReady }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const [overlayText, setOverlayText] = useState("");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [fontSize, setFontSize] = useState(28);

  const [isProcessing, setIsProcessing] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Step 1: Download video as blob to bypass CORS
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    (async () => {
      try {
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (err: any) {
        if (cancelled) return;
        // Fallback: use original URL directly (trim/overlay won't work but playback will)
        console.warn("Could not download video as blob:", err.message);
        setBlobUrl(videoUrl);
        setLoadError("Video editing limited — could not download for processing. You can still preview and download.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl && blobUrl.startsWith("blob:")) URL.revokeObjectURL(blobUrl);
    };
  }, [videoUrl]);

  // Step 2: Get duration once video loads
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
  }, [blobUrl]);

  // Track playback time + enforce trim boundaries
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (video.currentTime >= trimEnd && !video.paused) {
        video.pause();
        video.currentTime = trimStart;
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [trimStart, trimEnd]);

  const handleTrimStartChange = (value: number[]) => {
    setTrimStart(value[0]);
    if (videoRef.current) videoRef.current.currentTime = value[0];
  };

  const handleTrimEndChange = (value: number[]) => {
    setTrimEnd(value[0]);
    if (videoRef.current) videoRef.current.currentTime = value[0];
  };

  const handlePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    video.play();
  };

  // Draw overlay on canvas
  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (!overlayText.trim()) return;
      ctx.save();
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = overlayColor;
      let y: number;
      if (overlayPosition === "top") y = fontSize + 20;
      else if (overlayPosition === "center") y = h / 2 + fontSize / 3;
      else y = h - 30;
      ctx.fillText(overlayText, w / 2, y);
      ctx.restore();
    },
    [overlayText, overlayColor, overlayPosition, fontSize],
  );

  // Extract thumbnail at current time
  const extractThumbnail = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawOverlay(ctx, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    setThumbnailUrl(dataUrl);
    if (onThumbnailReady) onThumbnailReady(dataUrl);
    toast.success("Thumbnail captured!");
  };

  // Process video: trim + burn overlay using Canvas + MediaRecorder on blob URL
  const handleSave = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const noTrim = trimStart < 0.1 && Math.abs(trimEnd - duration) < 0.2;
    const noOverlay = !overlayText.trim();

    // If no edits, just save the original
    if (noTrim && noOverlay) {
      onSave(videoUrl);
      return;
    }

    // Check if we have a blob URL (required for canvas drawing)
    if (!blobUrl || !blobUrl.startsWith("blob:")) {
      toast.error("Cannot process — video wasn't downloaded as blob. Saving original.");
      onSave(videoUrl);
      return;
    }

    setIsProcessing(true);
    toast.info("Processing video...");

    try {
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      const ctx = canvas.getContext("2d")!;

      // Capture canvas as stream
      const stream = canvas.captureStream(30);

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "video/mp4";

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      // Seek to trim start and wait
      video.currentTime = trimStart;
      video.muted = true;
      await new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        video.addEventListener("seeked", onSeeked);
        setTimeout(resolve, 2000);
      });

      recorder.start();
      await video.play();

      // Render loop: draw video + overlay to canvas
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

      const blob = await done;
      const exportUrl = URL.createObjectURL(blob);

      video.muted = false;
      toast.success("Video processed!");
      onSave(exportUrl);
    } catch (err: any) {
      console.error("Video processing error:", err);
      toast.error("Processing failed — saving original video");
      onSave(videoUrl);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `video-${Date.now()}.mp4`;
    link.target = "_blank";
    link.click();
  };

  // CSS overlay for live preview
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
    ...(overlayPosition === "bottom" && { bottom: "48px" }),
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" /> Edit Video
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Preparing video for editing...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {loadError && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">{loadError}</p>
            )}

            {/* Video player with live text overlay */}
            <div className="relative rounded-md overflow-hidden border bg-black">
              <video
                ref={videoRef}
                src={blobUrl || videoUrl}
                controls
                className="w-full"
                preload="auto"
              />
              {overlayText.trim() && <div style={overlayStyle}>{overlayText}</div>}
            </div>

            {/* Hidden canvas for processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Current time */}
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
                  <Slider min={0} max={Math.max(trimEnd - 0.1, 0)} step={0.1} value={[trimStart]} onValueChange={handleTrimStartChange} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">End</span>
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formatTime(trimEnd)}</span>
                  </div>
                  <Slider min={Math.max(trimStart + 0.1, 0.1)} max={duration} step={0.1} value={[trimEnd]} onValueChange={handleTrimEndChange} />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Duration: {formatTime(trimEnd - trimStart)}</p>
                  <Button variant="outline" size="sm" onClick={handlePreview}>
                    <Play className="h-3 w-3 mr-1" /> Preview
                  </Button>
                </div>
              </div>
            )}

            {/* Text overlay */}
            <div className="space-y-3 border rounded-lg p-3">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Type className="h-3.5 w-3.5" /> Text Overlay
                {overlayText.trim() && <span className="text-xs text-green-600 ml-1">(Live preview on video)</span>}
              </Label>
              <Input
                placeholder="Enter text to burn into the video"
                value={overlayText}
                onChange={(e) => setOverlayText(e.target.value)}
              />
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Color</Label>
                  <Input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} className="h-7 w-8 p-0.5 cursor-pointer" />
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Position</Label>
                  <Select value={overlayPosition} onValueChange={(v) => setOverlayPosition(v as any)}>
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top">Top</SelectItem>
                      <SelectItem value="center">Center</SelectItem>
                      <SelectItem value="bottom">Bottom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Size</Label>
                  <Input type="number" min={12} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="h-7 w-16 text-xs" />
                </div>
              </div>
            </div>

            {/* Thumbnail extraction */}
            <div className="space-y-2 border rounded-lg p-3">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <ImageIcon className="h-3.5 w-3.5" /> Thumbnail
              </Label>
              <p className="text-xs text-muted-foreground">Seek the video to the frame you want, then capture it.</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={extractThumbnail}>
                  <ImageIcon className="h-3 w-3 mr-1" /> Capture Current Frame
                </Button>
                {thumbnailUrl && (
                  <a href={thumbnailUrl} download="thumbnail.png">
                    <Button variant="outline" size="sm">
                      <Download className="h-3 w-3 mr-1" /> Save Thumbnail
                    </Button>
                  </a>
                )}
              </div>
              {thumbnailUrl && (
                <img src={thumbnailUrl} alt="Thumbnail" className="w-32 h-auto rounded border" />
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={isProcessing}>
            <Download className="h-4 w-4 mr-1" /> Download Original
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isProcessing || isLoading}>
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...</>
            ) : (
              <><Save className="h-4 w-4 mr-1" /> Save Edited Video</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
