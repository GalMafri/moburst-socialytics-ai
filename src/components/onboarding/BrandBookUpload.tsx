import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Link, Loader2, FileText, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fileKey, useQuietUpload } from "@/hooks/useQuietUpload";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";

const TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
const MAX_BYTES = 10 * 1024 * 1024;

interface BrandBookUploadProps {
  clientId?: string;
  clientName: string;
  brandBookUrl: string;
  brandBookFilePath: string;
  onBrandBookUrlChange: (url: string) => void;
  onBrandBookFilePathChange: (path: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBrandIdentityExtracted: (identity: any) => void;
}

/**
 * An optional brand book: a file or a page. Reading it fills the brand
 * identity fields above, which a person can still change; the design
 * references step reads the file too. Every request is sent again quietly
 * when it does not get through, and the card says what has and has not been
 * read, never a failure.
 */
export function BrandBookUpload({
  clientId,
  clientName,
  brandBookUrl,
  brandBookFilePath,
  onBrandBookUrlChange,
  onBrandBookFilePathChange,
  onBrandIdentityExtracted,
}: BrandBookUploadProps) {
  const [extracting, setExtracting] = useState(false);
  const [notRead, setNotRead] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const uploadedFileName = brandBookFilePath ? brandBookFilePath.split("/").pop() || null : null;
  const folder = clientName.replace(/[^a-zA-Z0-9]/g, "-");
  const pathFor = (file: File) => `${folder}/${clientId || "new"}-${fileKey(file)}`;
  const upload = useCallback((file: File) => supabase.storage.from("brand-books").upload(pathFor(file), file, { upsert: true }), [folder, clientId]);
  const done = useCallback((file: File) => {
    onBrandBookFilePathChange(pathFor(file));
    toast.success("Brand book uploaded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBrandBookFilePathChange, folder, clientId]);
  const { send, again, uploading, pending } = useQuietUpload(upload, done);

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!TYPES.includes(file.type) || file.size > MAX_BYTES) { setRefused(file.name); return; }
    setRefused(null);
    void send(file);
  };

  const handleRemoveFile = () => {
    // The stored file stays: the client row may still point at it until the form is saved.
    onBrandBookFilePathChange("");
  };

  const read = async (fn: "extract-brand-from-file" | "research-brand-identity", body: Record<string, unknown>, from: string) => {
    setExtracting(true);
    setNotRead(null);
    const { data, error } = await sendQuietly(() => supabase.functions.invoke(fn, { body }), { again: (e) => invokeResendable(e, { idempotent: true }) });
    setExtracting(false);
    const identity = fn === "extract-brand-from-file" ? data?.brand_identity : data?.brand_identity ?? data;
    if (error || data?.error || !identity || typeof identity !== "object") {
      setNotRead(`The ${from} has not been read yet.`);
      return;
    }
    onBrandIdentityExtracted(identity);
    toast.success(`Brand identity read from the ${from}`);
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <Label className="t-body font-semibold">Brand Book / Style Guide</Label>

        <div className="space-y-2">
          <Label className="t-secondary">Upload file (PDF, PNG, JPG under 10 MB)</Label>
          {uploadedFileName ? (
            <div className="glass-inner flex items-center gap-2 p-3">
              <FileText className="h-4 w-4 text-primary" />
              <span className="t-body flex-1 truncate">{uploadedFileName}</span>
              <Button variant="ghost" size="sm" onClick={handleRemoveFile} aria-label="Remove the uploaded brand book">
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
              <Button size="sm" onClick={() => void read("extract-brand-from-file", { file_path: brandBookFilePath, bucket: "brand-books", client_name: clientName }, "brand book")} disabled={extracting}>
                {extracting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                Extract Brand
              </Button>
            </div>
          ) : (
            <label className="block">
              <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4 text-muted-foreground" />}
                <span className="t-secondary">{uploading ? "Uploading..." : "Click to upload brand book"}</span>
              </div>
              <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg" onChange={choose} disabled={uploading} />
            </label>
          )}
          {refused && <p className="t-secondary" role="status">{refused} is not a PDF, PNG or JPG file under 10 MB.</p>}
          {pending && !uploading && (
            <div className="flex items-center gap-2" role="status">
              <span className="t-secondary truncate">{pending.name} is not uploaded yet.</span>
              <Button variant="outline" size="sm" onClick={() => void again()}>Upload</Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label className="t-secondary">Or enter Brand Book URL</Label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={brandBookUrl}
                onChange={(e) => onBrandBookUrlChange(e.target.value)}
                placeholder="https://brand.example.com/guidelines"
                className="pl-9"
              />
            </div>
            <Button onClick={() => void read("research-brand-identity", { website_url: brandBookUrl.trim(), client_name: clientName }, "brand book page")} disabled={extracting || !brandBookUrl.trim()} size="sm">
              {extracting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Extract
            </Button>
          </div>
        </div>
        {notRead && <p className="t-secondary" role="status">{notRead}</p>}
      </CardContent>
    </Card>
  );
}
