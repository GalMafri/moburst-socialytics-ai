import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, X, Image } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fileKey } from "@/hooks/useQuietUpload";
import { uploadQuietly } from "@/lib/quietSend";

const TYPES = ["image/png", "image/jpeg", "image/jpg"];

interface DesignReferencesUploadProps {
  clientId?: string;
  clientName: string;
  designReferences: string[];
  onDesignReferencesChange: (refs: string[]) => void;
}

/**
 * Optional design references a person adds beside the ones the lifecycle
 * finds in the client's own posts. Each file is sent again quietly when it
 * does not go up, and a file that still has not stays selected.
 */
export function DesignReferencesUpload({
  clientId,
  clientName,
  designReferences,
  onDesignReferencesChange,
}: DesignReferencesUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const folder = clientName.replace(/[^a-zA-Z0-9]/g, "-");
  const pathFor = (file: File) => `${folder}/${clientId || "new"}-${fileKey(file)}`;

  const send = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const done: string[] = [];
    const left: File[] = [];
    for (const file of files) {
      const { error } = await uploadQuietly(() => supabase.storage.from("design-references").upload(pathFor(file), file, { upsert: true }));
      if (error) left.push(file);
      else done.push(pathFor(file));
    }
    setUploading(false);
    setPending(left);
    if (done.length) {
      onDesignReferencesChange([...designReferences, ...done.filter((p) => !designReferences.includes(p))]);
      toast.success(`${done.length} design reference${done.length === 1 ? "" : "s"} uploaded`);
    }
  };

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setSkipped(files.filter((f) => !TYPES.includes(f.type)).map((f) => f.name));
    void send(files.filter((f) => TYPES.includes(f.type)));
  };

  const handleRemove = (path: string) => {
    // The stored file stays until the form is saved without it.
    onDesignReferencesChange(designReferences.filter((r) => r !== path));
  };

  const getPublicUrl = (path: string) => supabase.storage.from("design-references").getPublicUrl(path).data.publicUrl;

  return (
    <div className="glass-inner p-inner space-y-4">
        <Label className="t-body font-semibold">Design references</Label>
        <p className="t-secondary">
          Example social posts, ads or designs (PNG or JPG), used as visual style references beside the client's own posts.
        </p>

        {designReferences.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {designReferences.map((path) => (
              <div key={path} className="relative group aspect-square rounded-[12px] overflow-hidden border border-white/10">
                <img src={getPublicUrl(path)} alt="Design reference" className="w-full h-full object-cover" />
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemove(path)}
                  aria-label="Remove this reference"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <label className="block">
          <div className="flex items-center gap-2 p-3 border border-dashed border-white/15 rounded-[12px] cursor-pointer hover:border-primary/50 transition-colors">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4 text-muted-foreground" />}
            <span className="t-secondary">{uploading ? "Uploading..." : "Upload design references (PNG, JPG)"}</span>
          </div>
          <input type="file" className="hidden" accept=".png,.jpg,.jpeg" multiple onChange={choose} disabled={uploading} />
        </label>
        {skipped.length > 0 && <p className="t-secondary" role="status">{skipped.join(", ")} {skipped.length === 1 ? "is not a PNG or JPG file" : "are not PNG or JPG files"}, so {skipped.length === 1 ? "it was" : "they were"} left out.</p>}
        {pending.length > 0 && !uploading && (
          <div className="flex items-center gap-2" role="status">
            <span className="t-secondary truncate">{pending.length === 1 ? `${pending[0].name} is` : `${pending.length} files are`} not uploaded yet.</span>
            <Button variant="outline" size="sm" onClick={() => void send(pending)}>Upload</Button>
          </div>
        )}
    </div>
  );
}
