import { useCallback, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fileKey, useQuietUpload } from "@/hooks/useQuietUpload";

const TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * The client's logo as a file. The lifecycle takes it from the client's
 * website on its own (brand_read); a person may replace it here. Designs
 * place this file as it is. Stored in the public generated-media bucket so
 * the image provider can fetch it; the URL is saved on the client row
 * (clients.logo_url). An upload that does not go through is sent again
 * quietly, and the chosen file stays selected until it has.
 */
export function LogoFileField({ clientId, clientName, logoUrl, onChange }: { clientId?: string; clientName: string; logoUrl: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const folder = clientId || clientName.replace(/[^a-zA-Z0-9]/g, "-") || "client";
  const pathFor = (file: File) => `${folder}/logo-${fileKey(file)}`;
  const upload = useCallback((file: File) => supabase.storage.from("generated-media").upload(pathFor(file), file, { contentType: file.type, upsert: true }), [folder]);
  const done = useCallback((file: File) => {
    onChange(supabase.storage.from("generated-media").getPublicUrl(pathFor(file)).data.publicUrl);
    toast.success("Logo uploaded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, folder]);
  const { send, again, uploading, pending } = useQuietUpload(upload, done);

  const choose = (file: File) => {
    // The bucket would refuse these, so they are not sent.
    if (!TYPES.includes(file.type) || file.size > MAX_BYTES) { setRefused(file.name); return; }
    setRefused(null);
    void send(file);
  };

  return (
    <div className="space-y-2">
      <Label className="t-secondary">Logo file</Label>
      <p className="t-label">PNG, JPG or WebP under 5 MB; PNG with a transparent background is best. Designs place this file as it is. The product takes the logo from the client's website when none is here.</p>
      {logoUrl ? (
        <div className="flex items-center gap-3 p-inner glass-inner">
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
          <div className="flex items-center gap-2 p-3 border border-dashed border-white/15 rounded-[12px] cursor-pointer hover:border-primary/50 transition-colors">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
            <span className="t-secondary">{uploading ? "Uploading..." : "Click to upload the logo file"}</span>
          </div>
        </button>
      )}
      {refused && <p className="t-secondary" role="status">{refused} is not a PNG, JPG or WebP file under 5 MB, so the current logo stays.</p>}
      {pending && !uploading && (
        <div className="flex items-center gap-2" role="status">
          <span className="t-secondary truncate">{pending.name} is not uploaded yet.</span>
          <Button variant="outline" size="sm" onClick={() => void again()}>Upload</Button>
        </div>
      )}
      <input ref={input} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp" data-testid="logo-file-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); e.target.value = ""; }} disabled={uploading} />
    </div>
  );
}
