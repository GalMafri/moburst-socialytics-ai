import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * The client's logo as a file. It is the one brand input the design run
 * cannot read reliably from the posts: the model is handed this file and
 * places it as it is, and the review judges the designed logo against it.
 * Stored in the public generated-media bucket so the image provider can
 * fetch it; the URL is saved on the client row (clients.logo_url).
 */
export function LogoFileField({ clientId, clientName, logoUrl, onChange }: { clientId?: string; clientName: string; logoUrl: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { toast.error("The logo must be a PNG, JPG or WebP file; PNG with a transparent background is best."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("The logo file must be under 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const path = `${clientId || clientName.replace(/[^a-zA-Z0-9]/g, "-") || "client"}/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("generated-media").upload(path, file, { contentType: file.type, upsert: true });
      if (error) throw error;
      onChange(supabase.storage.from("generated-media").getPublicUrl(path).data.publicUrl);
      toast.success("Logo saved. Save the client to apply it to new designs.");
    } catch (err: any) {
      toast.error("The logo could not be uploaded: " + (err?.message || "unknown error"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label className="t-secondary">Logo file</Label>
      <p className="t-tertiary">PNG with a transparent background. Designs place this file as it is; without it the logo is read from the client's posts.</p>
      {logoUrl ? (
        <div className="flex items-center gap-3 p-3 rounded-md border glass-inner">
          <div className="h-12 w-28 rounded bg-[#0A1016] flex items-center justify-center overflow-hidden">
            <img src={logoUrl} alt={`${clientName} logo`} className="max-h-10 max-w-24 object-contain" />
          </div>
          <span className="t-secondary flex-1 truncate">Logo on file</span>
          <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}Replace
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange("")} aria-label="Remove logo file" disabled={uploading}>
            <X className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button type="button" className="w-full text-left" onClick={() => input.current?.click()} disabled={uploading}>
          <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 transition-colors">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
            <span className="t-secondary">{uploading ? "Uploading..." : "Click to upload the logo file"}</span>
          </div>
        </button>
      )}
      <input ref={input} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp" data-testid="logo-file-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} disabled={uploading} />
    </div>
  );
}
