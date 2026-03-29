import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, X, Image } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DesignReferencesUploadProps {
  clientId?: string;
  clientName: string;
  designReferences: string[];
  onDesignReferencesChange: (refs: string[]) => void;
}

export function DesignReferencesUpload({
  clientId,
  clientName,
  designReferences,
  onDesignReferencesChange,
}: DesignReferencesUploadProps) {
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/jpg"];
    const validFiles = files.filter((f) => allowedTypes.includes(f.type));
    if (validFiles.length !== files.length) {
      toast.error("Only PNG and JPG files are allowed");
    }
    if (validFiles.length === 0) return;

    setUploading(true);
    try {
      const newPaths: string[] = [];
      const folder = clientName.replace(/[^a-zA-Z0-9]/g, "-");

      for (const file of validFiles) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${clientId || "new"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${fileExt}`;
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabase.storage
          .from("design-references")
          .upload(filePath, file);

        if (error) throw error;
        newPaths.push(filePath);
      }

      onDesignReferencesChange([...designReferences, ...newPaths]);
      toast.success(`${newPaths.length} design reference(s) uploaded`);
    } catch (err: any) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemove = async (path: string) => {
    await supabase.storage.from("design-references").remove([path]);
    onDesignReferencesChange(designReferences.filter((r) => r !== path));
  };

  const getPublicUrl = (path: string) => {
    const { data } = supabase.storage.from("design-references").getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <Label className="text-sm font-semibold">Design References</Label>
        <p className="text-xs text-muted-foreground">
          Upload example social posts, ads, or designs. These will be used as visual style references when generating new designs.
        </p>

        {designReferences.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {designReferences.map((path) => (
              <div key={path} className="relative group aspect-square rounded-md overflow-hidden border">
                <img
                  src={getPublicUrl(path)}
                  alt="Design reference"
                  className="w-full h-full object-cover"
                />
                <Button
                  variant="destructive"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemove(path)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <label className="block">
          <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 transition-colors">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Image className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm text-muted-foreground">
              {uploading ? "Uploading..." : "Upload design references (PNG, JPG)"}
            </span>
          </div>
          <input
            type="file"
            className="hidden"
            accept=".png,.jpg,.jpeg"
            multiple
            onChange={handleFileUpload}
            disabled={uploading}
          />
        </label>
      </CardContent>
    </Card>
  );
}
