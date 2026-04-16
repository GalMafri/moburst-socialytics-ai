import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Type, Trash2, Download, Save, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface DesignEditorProps {
  imageUrl: string;
  brandIdentity?: {
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
    font_family?: string;
  } | null;
  clientId: string;
  onSave: (exportedDataUrl: string) => void;
  onClose: () => void;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
}

export function DesignEditor({ imageUrl, brandIdentity, clientId, onSave, onClose }: DesignEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overlays, setOverlays] = useState<TextOverlay[]>([]);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const brandColors = [
    brandIdentity?.primary_color,
    brandIdentity?.secondary_color,
    brandIdentity?.accent_color,
  ].filter(Boolean) as string[];

  // Drag overlay on image
  const handleOverlayDrag = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    setDragging(id);
    setSelectedOverlay(id);

    const rect = container.getBoundingClientRect();
    const onMove = (moveE: MouseEvent) => {
      const x = ((moveE.clientX - rect.left) / rect.width) * 100;
      const y = ((moveE.clientY - rect.top) / rect.height) * 100;
      setOverlays((prev) =>
        prev.map((o) => o.id === id ? { ...o, x: Math.max(2, Math.min(98, x)), y: Math.max(2, Math.min(98, y)) } : o)
      );
    };
    const onUp = () => {
      setDragging(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const addTextOverlay = () => {
    const newOv: TextOverlay = {
      id: `ov-${Date.now()}`,
      text: "Your text here",
      x: 50,
      y: 50,
      color: brandColors[0] || "#ffffff",
      fontSize: 24,
      fontWeight: "bold",
    };
    setOverlays((prev) => [...prev, newOv]);
    setSelectedOverlay(newOv.id);
  };

  const updateOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setOverlays((prev) => prev.map((o) => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedOverlay === id) setSelectedOverlay(null);
  };

  const selectedOv = overlays.find((o) => o.id === selectedOverlay);

  // Export: draw image + overlays to a temporary canvas, get data URL
  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Load the original image
      const img = new Image();
      img.crossOrigin = "anonymous";

      const loadedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => {
          // Try blob fallback for CORS
          fetch(imageUrl)
            .then((r) => r.blob())
            .then((blob) => {
              const retry = new Image();
              retry.onload = () => resolve(retry);
              retry.onerror = () => reject(new Error("Cannot load image"));
              retry.src = URL.createObjectURL(blob);
            })
            .catch(() => reject(new Error("Cannot fetch image")));
        };
        img.src = imageUrl;
      });

      // Draw to canvas
      const canvas = document.createElement("canvas");
      canvas.width = loadedImg.naturalWidth;
      canvas.height = loadedImg.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(loadedImg, 0, 0);

      // Draw text overlays
      for (const ov of overlays) {
        if (!ov.text.trim()) continue;
        ctx.save();
        ctx.font = `${ov.fontWeight} ${ov.fontSize * (canvas.width / 800)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = ov.color;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
        ctx.fillText(ov.text, (ov.x / 100) * canvas.width, (ov.y / 100) * canvas.height);
        ctx.restore();
      }

      const dataUrl = canvas.toDataURL("image/png");

      // If there were overlays, we have a modified image — pass it up
      // If no overlays, just pass the original URL
      if (overlays.length === 0) {
        onSave(imageUrl);
      } else {
        onSave(dataUrl);
      }
    } catch (err: any) {
      console.error("DesignEditor save error:", err);
      toast.error("Failed to export design: " + err.message);
      onSave(imageUrl); // fallback to original
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageUrl;
    a.download = `design-${Date.now()}.png`;
    a.target = "_blank";
    a.click();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Edit Design</DialogTitle>
          <DialogDescription>Add text overlays and position them on the image.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Image with draggable text overlays */}
          <div
            ref={containerRef}
            className="relative rounded-lg overflow-hidden border bg-gray-100 select-none"
            onClick={() => setSelectedOverlay(null)}
          >
            <img src={imageUrl} alt="Design" className="w-full" draggable={false} />

            {overlays.map((ov) => (
              <div
                key={ov.id}
                className={`absolute cursor-move select-none ${
                  selectedOverlay === ov.id ? "ring-2 ring-blue-500 ring-offset-1" : ""
                } ${dragging === ov.id ? "opacity-80" : ""}`}
                style={{
                  left: `${ov.x}%`,
                  top: `${ov.y}%`,
                  transform: "translate(-50%, -50%)",
                  fontSize: `${ov.fontSize}px`,
                  fontWeight: ov.fontWeight,
                  color: ov.color,
                  textShadow: "2px 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)",
                  whiteSpace: "nowrap",
                  zIndex: selectedOverlay === ov.id ? 20 : 10,
                }}
                onMouseDown={(e) => handleOverlayDrag(ov.id, e)}
                onClick={(e) => { e.stopPropagation(); setSelectedOverlay(ov.id); }}
              >
                {ov.text}
              </div>
            ))}
          </div>

          {/* Text overlays panel */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5" /> Text Overlays ({overlays.length})
              </Label>
              <Button variant="outline" size="sm" onClick={addTextOverlay}>
                <Plus className="h-3 w-3 mr-1" /> Add Text
              </Button>
            </div>

            {overlays.length === 0 && (
              <p className="text-xs text-muted-foreground">Click "Add Text" to place text on the design. Drag to position.</p>
            )}

            {overlays.map((ov) => (
              <div
                key={ov.id}
                className={`flex items-center gap-2 p-2 rounded border text-sm cursor-pointer ${
                  selectedOverlay === ov.id ? "border-primary bg-primary/5" : ""
                }`}
                onClick={() => setSelectedOverlay(ov.id)}
              >
                <div className="w-4 h-4 rounded-full border shrink-0" style={{ backgroundColor: ov.color }} />
                <span className="truncate flex-1 text-xs">{ov.text}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={(e) => { e.stopPropagation(); removeOverlay(ov.id); }}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}

            {selectedOv && (
              <div className="space-y-2 pt-2 border-t">
                <Input
                  value={selectedOv.text}
                  onChange={(e) => updateOverlay(selectedOv.id, { text: e.target.value })}
                  placeholder="Enter text"
                />
                <div className="flex gap-2 flex-wrap">
                  {brandColors.length > 0 && (
                    <div className="flex items-center gap-1">
                      {brandColors.map((c) => (
                        <button
                          key={c}
                          className={`w-6 h-6 rounded-full border-2 ${selectedOv.color === c ? "border-primary" : "border-transparent"}`}
                          style={{ backgroundColor: c }}
                          onClick={() => updateOverlay(selectedOv.id, { color: c })}
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Color</Label>
                    <Input type="color" value={selectedOv.color} onChange={(e) => updateOverlay(selectedOv.id, { color: e.target.value })} className="h-7 w-8 p-0.5 cursor-pointer" />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Size</Label>
                    <Input type="number" min={12} max={72} value={selectedOv.fontSize} onChange={(e) => updateOverlay(selectedOv.id, { fontSize: Number(e.target.value) })} className="h-7 w-16 text-xs" />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Weight</Label>
                    <Select value={selectedOv.fontWeight} onValueChange={(v) => updateOverlay(selectedOv.id, { fontWeight: v as any })}>
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="bold">Bold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Drag text on the image to reposition. Brand colors shown as swatches.</p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download Original
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-1" /> {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
