import { useEffect, useRef, useState, useCallback } from "react";
import { Canvas, FabricImage, Textbox, Rect, Circle } from "fabric";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Type,
  Square,
  CircleIcon,
  Trash2,
  Undo2,
  Download,
  Save,
  Shapes,
  Loader2,
} from "lucide-react";
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

const MAX_CANVAS_WIDTH = 800;
const MAX_CANVAS_HEIGHT = 700;
const DEFAULT_FONT = "Inter, sans-serif";

export function DesignEditor({
  imageUrl,
  brandIdentity,
  clientId,
  onSave,
  onClose,
}: DesignEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState(
    brandIdentity?.primary_color || "#000000"
  );
  const [undoStack, setUndoStack] = useState<string[]>([]);

  const brandFont = brandIdentity?.font_family || DEFAULT_FONT;

  const brandColors = [
    brandIdentity?.primary_color,
    brandIdentity?.secondary_color,
    brandIdentity?.accent_color,
  ].filter(Boolean) as string[];

  // -- save snapshot for undo --
  const saveSnapshot = useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const json = JSON.stringify(canvas.toJSON());
    setUndoStack((prev) => [...prev.slice(-19), json]);
  }, []);

  // -- initialize canvas & load image --
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      backgroundColor: "#f0f0f0",
    });
    fabricRef.current = canvas;

    const loadImage = async () => {
      try {
        const img = await FabricImage.fromURL(imageUrl, {
          crossOrigin: "anonymous",
        });
        if (!img || !img.width || !img.height) {
          setLoadError("Failed to load image — invalid image data.");
          return;
        }

        // scale to fit
        const scale = Math.min(
          MAX_CANVAS_WIDTH / img.width,
          MAX_CANVAS_HEIGHT / img.height,
          1
        );
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        canvas.setDimensions({ width: w, height: h });

        img.scaleX = scale;
        img.scaleY = scale;
        img.selectable = false;
        img.evented = false;
        canvas.backgroundImage = img;
        canvas.renderAll();

        saveSnapshot();
        setReady(true);
      } catch (err) {
        console.error("DesignEditor: image load error", err);
        setLoadError(
          "Could not load the image. It may be a cross-origin or invalid URL."
        );
      }
    };

    loadImage();

    // track changes for undo
    const onChange = () => saveSnapshot();
    canvas.on("object:modified", onChange);
    canvas.on("object:added", onChange);

    return () => {
      canvas.off("object:modified", onChange);
      canvas.off("object:added", onChange);
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // -- toolbar actions --

  const addText = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const text = new Textbox("Your text here", {
      left: 50,
      top: 50,
      fontSize: 28,
      fontFamily: brandFont,
      fill: activeColor,
      width: 250,
      editable: true,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  };

  const addRect = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const rect = new Rect({
      left: 80,
      top: 80,
      width: 150,
      height: 100,
      fill: activeColor,
      opacity: 0.7,
      rx: 8,
      ry: 8,
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  };

  const addCircle = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const circle = new Circle({
      left: 100,
      top: 100,
      radius: 60,
      fill: activeColor,
      opacity: 0.7,
    });
    canvas.add(circle);
    canvas.setActiveObject(circle);
    canvas.renderAll();
  };

  const deleteSelected = () => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.renderAll();
    saveSnapshot();
  };

  const undo = () => {
    const canvas = fabricRef.current;
    if (!canvas || undoStack.length < 2) return;
    const newStack = [...undoStack];
    newStack.pop(); // remove current state
    const prev = newStack[newStack.length - 1];
    if (!prev) return;
    setUndoStack(newStack);
    canvas.loadFromJSON(prev).then(() => {
      canvas.renderAll();
    });
  };

  const applyColorToSelected = (color: string) => {
    setActiveColor(color);
    const canvas = fabricRef.current;
    if (!canvas) return;
    const obj = canvas.getActiveObject();
    if (obj) {
      obj.set("fill", color);
      canvas.renderAll();
      saveSnapshot();
    }
  };

  // -- export --

  const exportDataUrl = (): string | null => {
    const canvas = fabricRef.current;
    if (!canvas) return null;
    return canvas.toDataURL({ format: "png", multiplier: 2 });
  };

  const handleSaveAndClose = () => {
    const dataUrl = exportDataUrl();
    if (!dataUrl) return;
    onSave(dataUrl);

    // fire-and-forget: save design state to Supabase
    const canvas = fabricRef.current;
    if (canvas && clientId) {
      const stateJson = JSON.stringify(canvas.toJSON());
      supabase
        .from("design_states" as any)
        .upsert(
          {
            client_id: clientId,
            canvas_json: stateJson,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: "client_id" }
        )
        .then(() => {}, () => {});
    }
  };

  const handleDownload = () => {
    const dataUrl = exportDataUrl();
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `design-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Image downloaded!");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[90vw] w-fit max-h-[95vh] overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Edit Design</DialogTitle>
        </DialogHeader>

        {loadError ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-destructive mb-2">{loadError}</p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : !ready ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
            <p className="text-sm text-muted-foreground">Loading image...</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b pb-3 mb-3">
              {/* Add Text */}
              <Button variant="outline" size="sm" onClick={addText}>
                <Type className="h-4 w-4 mr-1" /> Text
              </Button>

              {/* Add Shape dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Shapes className="h-4 w-4 mr-1" /> Shape
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={addRect}>
                    <Square className="h-4 w-4 mr-2" /> Rectangle
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={addCircle}>
                    <CircleIcon className="h-4 w-4 mr-2" /> Circle
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Color picker */}
              <div className="flex items-center gap-1.5 ml-2">
                <Label className="text-xs text-muted-foreground sr-only">
                  Color
                </Label>
                {brandColors.map((color) => (
                  <button
                    key={color}
                    className="h-6 w-6 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: color,
                      borderColor:
                        activeColor === color
                          ? "hsl(var(--ring))"
                          : "transparent",
                    }}
                    onClick={() => applyColorToSelected(color)}
                    title={color}
                  />
                ))}
                <Input
                  type="color"
                  value={activeColor}
                  onChange={(e) => applyColorToSelected(e.target.value)}
                  className="h-7 w-8 p-0.5 cursor-pointer border rounded"
                />
              </div>

              {/* Delete */}
              <Button
                variant="outline"
                size="sm"
                onClick={deleteSelected}
                className="ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>

              {/* Undo */}
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={undoStack.length < 2}
              >
                <Undo2 className="h-4 w-4 mr-1" /> Undo
              </Button>
            </div>

            {/* Canvas */}
            <div className="flex justify-center bg-muted/30 rounded-lg p-2">
              <canvas ref={canvasRef} />
            </div>
          </>
        )}

        {/* Action buttons */}
        {ready && !loadError && (
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
            <Button size="sm" onClick={handleSaveAndClose}>
              <Save className="h-4 w-4 mr-1" /> Save & Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
