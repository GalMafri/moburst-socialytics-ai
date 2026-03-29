import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Link, Loader2, FileText, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BrandBookUploadProps {
  clientId?: string;
  clientName: string;
  brandBookUrl: string;
  brandBookFilePath: string;
  onBrandBookUrlChange: (url: string) => void;
  onBrandBookFilePathChange: (path: string) => void;
  onBrandIdentityExtracted: (identity: any) => void;
}

export function BrandBookUpload({
  clientId,
  clientName,
  brandBookUrl,
  brandBookFilePath,
  onBrandBookUrlChange,
  onBrandBookFilePathChange,
  onBrandIdentityExtracted,
}: BrandBookUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(
    brandBookFilePath ? brandBookFilePath.split("/").pop() || null : null
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Please upload a PDF, PNG, or JPG file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${clientId || "new"}-${Date.now()}.${fileExt}`;
      const filePath = `${clientName.replace(/[^a-zA-Z0-9]/g, "-")}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("brand-books")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      onBrandBookFilePathChange(filePath);
      setUploadedFileName(file.name);
      toast.success("Brand book uploaded successfully");
    } catch (err: any) {
      toast.error("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveFile = async () => {
    if (brandBookFilePath) {
      await supabase.storage.from("brand-books").remove([brandBookFilePath]);
    }
    onBrandBookFilePathChange("");
    setUploadedFileName(null);
  };

  const handleExtractFromFile = async () => {
    if (!brandBookFilePath) {
      toast.error("Please upload a brand book file first");
      return;
    }

    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-brand-from-file", {
        body: {
          file_path: brandBookFilePath,
          bucket: "brand-books",
          client_name: clientName,
        },
      });

      if (error) throw error;
      if (data?.brand_identity) {
        onBrandIdentityExtracted(data.brand_identity);
        toast.success("Brand identity extracted from brand book!");
      } else {
        toast.error("Could not extract brand identity from file");
      }
    } catch (err: any) {
      toast.error("Extraction failed: " + err.message);
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractFromUrl = async () => {
    if (!brandBookUrl) {
      toast.error("Please enter a brand book URL");
      return;
    }

    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke("research-brand-identity", {
        body: {
          website_url: brandBookUrl.trim(),
          client_name: clientName,
        },
      });

      if (error) throw error;
      if (data) {
        onBrandIdentityExtracted(data);
        toast.success("Brand identity extracted from URL!");
      }
    } catch (err: any) {
      toast.error("Extraction failed: " + err.message);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <Label className="text-sm font-semibold">Brand Book / Style Guide</Label>

        {/* File Upload */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Upload File (PDF, PNG, JPG)</Label>
          {uploadedFileName ? (
            <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/50">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm flex-1 truncate">{uploadedFileName}</span>
              <Button variant="ghost" size="sm" onClick={handleRemoveFile}>
                <X className="h-3 w-3" />
              </Button>
              <Button size="sm" onClick={handleExtractFromFile} disabled={extracting}>
                {extracting ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                )}
                Extract Brand
              </Button>
            </div>
          ) : (
            <label className="block">
              <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {uploading ? "Uploading..." : "Click to upload brand book"}
                </span>
              </div>
              <input
                type="file"
                className="hidden"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>
          )}
        </div>

        {/* URL Input */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Or enter Brand Book URL</Label>
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
            <Button onClick={handleExtractFromUrl} disabled={extracting || !brandBookUrl} size="sm">
              {extracting ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              Extract
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
