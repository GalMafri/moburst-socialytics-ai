# Socialytics Feature Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add brand book upload with color extraction, timezone support, Sprout Social scheduling, enhanced design references, video generation, and client deletion to the Socialytics platform.

**Architecture:** Frontend is Vite + React + TypeScript with Supabase backend (PostgreSQL + Edge Functions). n8n workflow handles report generation via webhook. New features add Supabase Edge Functions for brand extraction, Sprout publishing, and video generation. Frontend changes are primarily in ClientSetup (onboarding), ReportView (content calendar), and AdminDashboard (client management).

**Tech Stack:** React 18, TypeScript, Supabase (Edge Functions in Deno), OpenAI GPT-4.1 Vision, Google Gemini API (image + Veo video), Sprout Social Publishing API, TanStack React Query, shadcn/ui

---

## Task 1: Database Schema — Add New Columns to `clients` Table

**Files:**
- Modify: `src/integrations/supabase/types.ts:70-135`

**Context:** The Supabase types file contains TypeScript interfaces generated from the database schema. We need to add new columns. The actual DB migration will be run in Supabase dashboard SQL editor.

**Step 1: Run SQL migration in Supabase**

Execute this SQL in the Supabase SQL Editor (dashboard):

```sql
-- Feature 1: Brand book upload + timezone
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_book_url TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_book_file_path TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';

-- Feature 3: Design references
ALTER TABLE clients ADD COLUMN IF NOT EXISTS design_references JSONB;

-- Feature 5: Soft delete
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Feature 2: Scheduled posts table
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  report_id UUID REFERENCES reports(id) ON DELETE SET NULL,
  sprout_post_id TEXT,
  profile_id UUID REFERENCES sprout_profiles(id) ON DELETE SET NULL,
  platform TEXT,
  scheduled_time TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'published', 'failed', 'cancelled')),
  post_content TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- RLS for scheduled_posts
ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON scheduled_posts FOR ALL USING (true);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('brand-books', 'brand-books', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('design-references', 'design-references', true) ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Allow upload brand-books" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'brand-books');
CREATE POLICY "Allow read brand-books" ON storage.objects FOR SELECT USING (bucket_id = 'brand-books');
CREATE POLICY "Allow delete brand-books" ON storage.objects FOR DELETE USING (bucket_id = 'brand-books');
CREATE POLICY "Allow upload design-references" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'design-references');
CREATE POLICY "Allow read design-references" ON storage.objects FOR SELECT USING (bucket_id = 'design-references');
CREATE POLICY "Allow delete design-references" ON storage.objects FOR DELETE USING (bucket_id = 'design-references');
```

**Step 2: Update TypeScript types**

In `src/integrations/supabase/types.ts`, add the new columns to the `clients` Row, Insert, and Update types. Also add the `scheduled_posts` table type.

Add to `clients.Row` (after line 90, before the closing `}`):
```typescript
      brand_book_url: string | null
      brand_book_file_path: string | null
      timezone: string | null
      design_references: Json | null
      archived_at: string | null
```

Add the same fields to `clients.Insert` (all optional):
```typescript
      brand_book_url?: string | null
      brand_book_file_path?: string | null
      timezone?: string | null
      design_references?: Json | null
      archived_at?: string | null
```

Add the same fields to `clients.Update` (all optional):
```typescript
      brand_book_url?: string | null
      brand_book_file_path?: string | null
      timezone?: string | null
      design_references?: Json | null
      archived_at?: string | null
```

Add new table definition for `scheduled_posts` after the `clients` block:
```typescript
    scheduled_posts: {
      Row: {
        id: string
        client_id: string | null
        report_id: string | null
        sprout_post_id: string | null
        profile_id: string | null
        platform: string | null
        scheduled_time: string | null
        status: string | null
        post_content: string | null
        media_url: string | null
        created_at: string | null
        created_by: string | null
      }
      Insert: {
        id?: string
        client_id?: string | null
        report_id?: string | null
        sprout_post_id?: string | null
        profile_id?: string | null
        platform?: string | null
        scheduled_time?: string | null
        status?: string | null
        post_content?: string | null
        media_url?: string | null
        created_at?: string | null
        created_by?: string | null
      }
      Update: {
        id?: string
        client_id?: string | null
        report_id?: string | null
        sprout_post_id?: string | null
        profile_id?: string | null
        platform?: string | null
        scheduled_time?: string | null
        status?: string | null
        post_content?: string | null
        media_url?: string | null
        created_at?: string | null
        created_by?: string | null
      }
      Relationships: [
        {
          foreignKeyName: "scheduled_posts_client_id_fkey"
          columns: ["client_id"]
          isOneToOne: false
          referencedRelation: "clients"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "scheduled_posts_report_id_fkey"
          columns: ["report_id"]
          isOneToOne: false
          referencedRelation: "reports"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "scheduled_posts_profile_id_fkey"
          columns: ["profile_id"]
          isOneToOne: false
          referencedRelation: "sprout_profiles"
          referencedColumns: ["id"]
        }
      ]
    }
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

**Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "feat: add database types for brand book, timezone, design refs, scheduled posts, and archived_at"
```

---

## Task 2: Brand Book Upload Component

**Files:**
- Create: `src/components/onboarding/BrandBookUpload.tsx`

**Step 1: Create the BrandBookUpload component**

This component replaces the old brand_book_text textarea. It provides:
- File upload (PDF, PNG, JPG) to Supabase Storage `brand-books` bucket
- URL input for online brand books
- "Extract Brand" button that calls the extraction function
- Shows extracted brand identity preview

```tsx
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
              <Button
                size="sm"
                onClick={handleExtractFromFile}
                disabled={extracting}
              >
                {extracting ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                )}
                Extract Brand
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="flex-1">
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
            </div>
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
            <Button
              onClick={handleExtractFromUrl}
              disabled={extracting || !brandBookUrl}
              size="sm"
            >
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
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds (component not yet integrated).

**Step 3: Commit**

```bash
git add src/components/onboarding/BrandBookUpload.tsx
git commit -m "feat: add BrandBookUpload component with file upload and URL extraction"
```

---

## Task 3: Design References Upload Component

**Files:**
- Create: `src/components/onboarding/DesignReferencesUpload.tsx`

**Step 1: Create the DesignReferencesUpload component**

This allows uploading multiple design reference images.

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Loader2, X, Image } from "lucide-react";
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
      // Reset file input
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

        {/* Uploaded images grid */}
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

        {/* Upload button */}
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
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/components/onboarding/DesignReferencesUpload.tsx
git commit -m "feat: add DesignReferencesUpload component with multi-file upload"
```

---

## Task 4: Update ClientSetup — Brand Book, Design Refs, Timezone, Remove brand_book_text

**Files:**
- Modify: `src/pages/ClientSetup.tsx`

**Step 1: Update form state (around line 84-98)**

Add new fields to the form state initialization. Find the state object and add:

```typescript
brand_book_url: "",
brand_book_file_path: "",
timezone: "UTC",
design_references: [] as string[],
```

Remove `brand_book_text` from the initial state (line ~94).

**Step 2: Update client data loading (around line 105-162)**

When loading existing client data, map the new fields:

```typescript
brand_book_url: client.brand_book_url || "",
brand_book_file_path: client.brand_book_file_path || "",
timezone: client.timezone || "UTC",
design_references: (client.design_references as string[]) || [],
```

Remove the line that loads `brand_book_text` (line ~162).

**Step 3: Update save mutation payload (around line 185-198)**

Add the new fields to the mutation payload object:

```typescript
brand_book_url: form.brand_book_url || null,
brand_book_file_path: form.brand_book_file_path || null,
timezone: form.timezone || "UTC",
design_references: form.design_references.length > 0 ? form.design_references : null,
```

Remove `brand_book_text` from the payload.

**Step 4: Add timezone dropdown to Client Info tab**

After the Website URL section (around line 406), add a timezone selector. Import `TIMEZONE_OPTIONS` from a constants file or inline the most common ones:

```tsx
<div className="space-y-2">
  <Label>Client Timezone</Label>
  <select
    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
    value={form.timezone}
    onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
  >
    <option value="UTC">UTC</option>
    <option value="America/New_York">Eastern Time (US)</option>
    <option value="America/Chicago">Central Time (US)</option>
    <option value="America/Denver">Mountain Time (US)</option>
    <option value="America/Los_Angeles">Pacific Time (US)</option>
    <option value="Europe/London">London (GMT/BST)</option>
    <option value="Europe/Paris">Central Europe (CET/CEST)</option>
    <option value="Europe/Berlin">Berlin (CET/CEST)</option>
    <option value="Asia/Jerusalem">Israel (IST/IDT)</option>
    <option value="Asia/Tokyo">Tokyo (JST)</option>
    <option value="Asia/Seoul">Seoul (KST)</option>
    <option value="Asia/Shanghai">Shanghai (CST)</option>
    <option value="America/Sao_Paulo">São Paulo (BRT)</option>
    <option value="Asia/Dubai">Dubai (GST)</option>
    <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
    <option value="Pacific/Auckland">Auckland (NZST/NZDT)</option>
  </select>
</div>
```

**Step 5: Replace brand_book_text textarea with BrandBookUpload + DesignReferencesUpload**

Remove the `brand_book_text` textarea (lines 770-782). Replace with:

```tsx
import { BrandBookUpload } from "@/components/onboarding/BrandBookUpload";
import { DesignReferencesUpload } from "@/components/onboarding/DesignReferencesUpload";
```

And in the Brief tab content (or wherever the brand book section lives):

```tsx
<BrandBookUpload
  clientId={clientId}
  clientName={form.name}
  brandBookUrl={form.brand_book_url}
  brandBookFilePath={form.brand_book_file_path}
  onBrandBookUrlChange={(url) => setForm((f) => ({ ...f, brand_book_url: url }))}
  onBrandBookFilePathChange={(path) => setForm((f) => ({ ...f, brand_book_file_path: path }))}
  onBrandIdentityExtracted={(identity) => setForm((f) => ({ ...f, brand_identity: { ...f.brand_identity, ...identity } }))}
/>

<DesignReferencesUpload
  clientId={clientId}
  clientName={form.name}
  designReferences={form.design_references}
  onDesignReferencesChange={(refs) => setForm((f) => ({ ...f, design_references: refs }))}
/>
```

**Step 6: Verify build and test UI manually**

Run: `npm run dev`
Expected: ClientSetup page shows brand book upload, design references upload, and timezone dropdown. No brand_book_text textarea.

**Step 7: Commit**

```bash
git add src/pages/ClientSetup.tsx
git commit -m "feat: replace brand_book_text with BrandBookUpload, add DesignReferencesUpload and timezone"
```

---

## Task 5: Supabase Edge Function — `extract-brand-from-file`

**Files:**
- Create: `supabase/functions/extract-brand-from-file/index.ts`

**Step 1: Create the Edge Function**

This function downloads a file from Supabase Storage, converts it to base64, and sends it to GPT-4.1 Vision for brand identity extraction — reusing the same prompt logic from `research-brand-identity`.

```typescript
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_path, bucket, client_name } = await req.json();

    if (!file_path || !bucket) {
      return new Response(JSON.stringify({ error: "file_path and bucket are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(file_path);

    if (downloadError || !fileData) {
      throw new Error("Failed to download file: " + downloadError?.message);
    }

    // Convert to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    // Determine MIME type
    const ext = file_path.split(".").pop()?.toLowerCase();
    let mimeType = "image/png";
    if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
    else if (ext === "pdf") mimeType = "application/pdf";

    // Get OpenAI API key
    let openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "openai_api_key")
        .single();
      openaiKey = settings?.value;
    }

    if (!openaiKey) {
      throw new Error("OpenAI API key not configured");
    }

    // Build GPT-4.1 Vision request
    const systemPrompt = `You are a brand identity analyst. Analyze the provided brand book/style guide document and extract the brand's visual identity.

Return a JSON object with exactly these fields:
- primary_color: main brand color as hex (e.g., "#1A73E8")
- secondary_color: secondary brand color as hex
- accent_color: accent/highlight color as hex
- font_family: primary font family name
- visual_style: 5-15 word description of overall visual style
- logo_description: brief description of the logo
- tone_of_voice: 3-8 word description of brand tone
- design_elements: key visual patterns or elements
- background_style: preferred background approach

MANDATORY RULES:
1. All colors MUST be valid 7-character hex codes starting with #
2. Return ONLY the JSON object, no additional text
3. If a field cannot be determined, provide your best educated guess based on the overall brand aesthetic
4. font_family must be a real font name`;

    const userMessage = `Analyze this brand book${client_name ? ` for "${client_name}"` : ""} and extract the brand identity. Return only the JSON object.`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: "high",
            },
          },
        ],
      },
    ];

    // Call OpenAI
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages,
        max_tokens: 1000,
        temperature: 0.3,
      }),
    });

    const openaiData = await openaiResponse.json();
    const content = openaiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let brandIdentity;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      brandIdentity = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      brandIdentity = null;
    }

    if (!brandIdentity) {
      throw new Error("Failed to parse brand identity from AI response");
    }

    return new Response(JSON.stringify({ brand_identity: brandIdentity }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/extract-brand-from-file/index.ts
git commit -m "feat: add extract-brand-from-file Edge Function for brand book color extraction"
```

---

## Task 6: Update RunAnalysis Webhook Payload — Add Timezone

**Files:**
- Modify: `src/pages/RunAnalysis.tsx:249-277`

**Step 1: Add timezone to webhook payload**

Find the payload object (line ~249) and add after `skip_trends`:

```typescript
timezone: client!.timezone || "UTC",
```

**Step 2: Commit**

```bash
git add src/pages/RunAnalysis.tsx
git commit -m "feat: pass client timezone in webhook payload for content calendar"
```

---

## Task 7: Update n8n Workflow — Use Timezone in Content Calendar

**Files:**
- Modify: `Socialytics - AI Social Media Trend Analysis + Insights Agent - Loveable - Final.json`

**Step 1: Update the "Combine Brief Context with Client Data" node**

In the n8n workflow JSON, find the node named "Combine Brief Context with Client Data". In its code, add timezone extraction from webhook data:

```javascript
// Add to the output object:
timezone: webhookData?.timezone || workflowConfig?.timezone || "UTC",
```

**Step 2: Update the AI Synthesis Agent system prompt**

Find the AI Synthesis Agent node. In its system prompt, add instructions to use the timezone:

Add to the prompt section about content_calendar:
```
- All posting_time values MUST be in the client's timezone: {{timezone}}. Format as "HH:MM AM/PM TIMEZONE_ABBREV" (e.g., "9:00 AM EST").
```

**Step 3: Update the "Build Normalized Client Object" node**

Ensure timezone is passed through to the AI agent input.

**Step 4: Commit**

```bash
git add "Socialytics - AI Social Media Trend Analysis + Insights Agent - Loveable - Final.json"
git commit -m "feat: use client timezone for content calendar posting times in n8n workflow"
```

---

## Task 8: Client Deletion — AdminDashboard UI

**Files:**
- Modify: `src/components/dashboard/AdminDashboard.tsx`

**Step 1: Add archive/delete functionality**

Add state for showing archived clients and mutations for archive/restore/delete:

After the existing query (line ~30), add:

```typescript
const [showArchived, setShowArchived] = useState(false);

const archiveMutation = useMutation({
  mutationFn: async (clientId: string) => {
    const { error } = await supabase
      .from("clients")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", clientId);
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    toast.success("Client archived");
  },
});

const restoreMutation = useMutation({
  mutationFn: async (clientId: string) => {
    const { error } = await supabase
      .from("clients")
      .update({ archived_at: null })
      .eq("id", clientId);
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    toast.success("Client restored");
  },
});

const deleteMutation = useMutation({
  mutationFn: async (clientId: string) => {
    const { data, error } = await supabase.functions.invoke("delete-client", {
      body: { client_id: clientId },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    toast.success("Client permanently deleted");
  },
});
```

**Step 2: Update the query to include archived_at**

Modify the select to include `archived_at`:

```typescript
.select("*, reports(id, status, created_at), archived_at")
```

**Step 3: Filter clients based on archive status**

Update the filtered clients logic to exclude/include archived:

```typescript
const filtered = (clients || []).filter((c: any) => {
  const matchesSearch = c.name?.toLowerCase().includes(search.toLowerCase());
  const isArchived = !!c.archived_at;
  return matchesSearch && (showArchived ? isArchived : !isArchived);
});
```

**Step 4: Add archive toggle and actions to UI**

Add a toggle button near the search bar:

```tsx
<Button
  variant={showArchived ? "secondary" : "outline"}
  size="sm"
  onClick={() => setShowArchived(!showArchived)}
>
  {showArchived ? "Show Active" : "Show Archived"}
</Button>
```

On each client card, add a dropdown menu with actions:

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Archive, RotateCcw, Trash2 } from "lucide-react";

// Inside the card header, after the client name:
<DropdownMenu>
  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
      <MoreVertical className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
    {client.archived_at ? (
      <>
        <DropdownMenuItem onClick={() => restoreMutation.mutate(client.id)}>
          <RotateCcw className="h-4 w-4 mr-2" /> Restore
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive"
          onClick={() => {
            if (confirm(`Permanently delete "${client.name}"? This cannot be undone. Type the client name to confirm.`)) {
              const typed = prompt(`Type "${client.name}" to confirm permanent deletion:`);
              if (typed === client.name) {
                deleteMutation.mutate(client.id);
              }
            }
          }}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Permanently Delete
        </DropdownMenuItem>
      </>
    ) : (
      <DropdownMenuItem onClick={() => archiveMutation.mutate(client.id)}>
        <Archive className="h-4 w-4 mr-2" /> Archive Client
      </DropdownMenuItem>
    )}
  </DropdownMenuContent>
</DropdownMenu>
```

For archived clients, add a visual indicator:

```tsx
{client.archived_at && (
  <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">Archived</span>
)}
```

**Step 5: Verify build and test manually**

Run: `npm run dev`
Expected: Dashboard shows three-dot menu on cards, archive/restore/delete works.

**Step 6: Commit**

```bash
git add src/components/dashboard/AdminDashboard.tsx
git commit -m "feat: add client archive/restore/delete functionality to AdminDashboard"
```

---

## Task 9: Supabase Edge Function — `delete-client`

**Files:**
- Create: `supabase/functions/delete-client/index.ts`

**Step 1: Create cascading delete function**

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get client info for storage cleanup
    const { data: client } = await supabase
      .from("clients")
      .select("name, brand_book_file_path, design_references")
      .eq("id", client_id)
      .single();

    // Delete in dependency order (CASCADE should handle most, but be explicit)
    await supabase.from("scheduled_posts").delete().eq("client_id", client_id);
    await supabase.from("report_schedules").delete().eq("client_id", client_id);
    await supabase.from("sprout_profiles").delete().eq("client_id", client_id);
    await supabase.from("client_users").delete().eq("client_id", client_id);
    await supabase.from("reports").delete().eq("client_id", client_id);
    await supabase.from("clients").delete().eq("id", client_id);

    // Clean up storage
    if (client?.brand_book_file_path) {
      await supabase.storage.from("brand-books").remove([client.brand_book_file_path]);
    }
    if (client?.design_references && Array.isArray(client.design_references)) {
      await supabase.storage.from("design-references").remove(client.design_references as string[]);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error deleting client:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/delete-client/index.ts
git commit -m "feat: add delete-client Edge Function with cascading deletion and storage cleanup"
```

---

## Task 10: Schedule Post Modal Component

**Files:**
- Create: `src/components/reports/SchedulePostModal.tsx`

**Step 1: Create the SchedulePostModal component**

```tsx
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Send, Loader2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

interface SchedulePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  clientId: string;
  reportId: string;
  generatedImageUrl?: string | null;
  clientTimezone?: string;
}

export function SchedulePostModal({
  open,
  onOpenChange,
  post,
  clientId,
  reportId,
  generatedImageUrl,
  clientTimezone = "UTC",
}: SchedulePostModalProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [postContent, setPostContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  // Load sprout profiles for this client
  const { data: profiles } = useQuery({
    queryKey: ["sprout-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Filter profiles by post platform
  const platformProfiles = (profiles || []).filter(
    (p: any) => p.network_type?.toLowerCase() === post?.platform?.toLowerCase()
  );

  // Initialize form when modal opens
  useEffect(() => {
    if (open && post) {
      setPostContent(post.copy || "");
      setMediaUrl(generatedImageUrl || null);

      // Parse date from post
      if (post.date_label) {
        // Try to parse date_label like "Mon Jan 5" or "2026-01-05"
        try {
          const d = new Date(post.date_label);
          if (!isNaN(d.getTime())) {
            setScheduledDate(d.toISOString().split("T")[0]);
          }
        } catch {
          setScheduledDate("");
        }
      }

      // Parse time from posting_time like "9:00 AM EST"
      if (post.posting_time) {
        const timeMatch = post.posting_time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const mins = timeMatch[2];
          const ampm = timeMatch[3].toUpperCase();
          if (ampm === "PM" && hours < 12) hours += 12;
          if (ampm === "AM" && hours === 12) hours = 0;
          setScheduledTime(`${hours.toString().padStart(2, "0")}:${mins}`);
        }
      }

      // Auto-select first matching profile
      if (platformProfiles.length > 0 && !selectedProfileId) {
        setSelectedProfileId(platformProfiles[0].id);
      }
    }
  }, [open, post, generatedImageUrl]);

  const handleSchedule = async () => {
    if (!selectedProfileId) {
      toast.error("Please select a profile");
      return;
    }
    if (!scheduledDate || !scheduledTime) {
      toast.error("Please set date and time");
      return;
    }

    setScheduling(true);
    try {
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);

      const selectedProfile = profiles?.find((p: any) => p.id === selectedProfileId);

      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          profile_id: selectedProfileId,
          sprout_profile_id: selectedProfile?.sprout_profile_id,
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_url: mediaUrl,
        },
      });

      if (error) throw error;

      toast.success("Post scheduled successfully!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Failed to schedule: " + err.message);
    } finally {
      setScheduling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Schedule to Sprout Social
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Profile Selector */}
          <div className="space-y-2">
            <Label>Profile</Label>
            {platformProfiles.length > 0 ? (
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {platformProfiles.map((profile: any) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.profile_name || profile.native_name} ({profile.network_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No {post?.platform} profiles connected for this client.
              </p>
            )}
          </div>

          {/* Date & Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Date
              </Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Time ({clientTimezone})
              </Label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          {/* Post Content */}
          <div className="space-y-2">
            <Label>Post Copy</Label>
            <Textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              rows={4}
            />
          </div>

          {/* Media Preview */}
          {mediaUrl && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Attached Media
              </Label>
              <img
                src={mediaUrl}
                alt="Post media"
                className="w-full max-h-48 object-contain rounded-md border"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={scheduling || !selectedProfileId}>
            {scheduling ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Schedule Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/components/reports/SchedulePostModal.tsx
git commit -m "feat: add SchedulePostModal component for Sprout Social scheduling"
```

---

## Task 11: Supabase Edge Function — `schedule-sprout-post`

**Files:**
- Create: `supabase/functions/schedule-sprout-post/index.ts`

**Step 1: Create the Edge Function**

```typescript
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sprout Social OAuth2 token endpoint
const TOKEN_URL = "https://identity.sproutsocial.com/oauth2/aus1p11ihuZpMU5hO1d8/v1/token";
const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";

async function getSproutToken(): Promise<string> {
  const clientId = Deno.env.get("SPROUT_CLIENT_ID");
  const clientSecret = Deno.env.get("SPROUT_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Sprout Social credentials not configured");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Failed to get Sprout Social token");
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      client_id,
      report_id,
      profile_id,
      sprout_profile_id,
      platform,
      scheduled_time,
      post_content,
      media_url,
    } = await req.json();

    if (!sprout_profile_id || !scheduled_time || !post_content) {
      return new Response(
        JSON.stringify({ error: "sprout_profile_id, scheduled_time, and post_content are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Sprout customer ID
    const { data: client } = await supabase
      .from("clients")
      .select("sprout_customer_id")
      .eq("id", client_id)
      .single();

    const customerId = client?.sprout_customer_id || "1676448";

    // Get Sprout token
    const token = await getSproutToken();

    // Build Sprout Social publish request
    const publishPayload: any = {
      profile_ids: [sprout_profile_id],
      text: post_content,
      send_time: scheduled_time,
    };

    // If media_url is provided, we'd need to upload to Sprout's media library first
    // For now, support text-only posts and base64 image attachment
    if (media_url && media_url.startsWith("data:image")) {
      // Upload media to Sprout Social
      const mediaResponse = await fetch(`${SPROUT_API_BASE}/${customerId}/media`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: media_url,
        }),
      });

      if (mediaResponse.ok) {
        const mediaData = await mediaResponse.json();
        publishPayload.media = [{ id: mediaData.id }];
      }
    }

    // Schedule the post
    const response = await fetch(`${SPROUT_API_BASE}/${customerId}/publishing/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publishPayload),
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(`Sprout API error: ${JSON.stringify(responseData)}`);
    }

    // Save to scheduled_posts table
    const { error: insertError } = await supabase.from("scheduled_posts").insert({
      client_id,
      report_id,
      sprout_post_id: responseData.id || responseData.data?.id || null,
      profile_id,
      platform,
      scheduled_time,
      status: "scheduled",
      post_content,
      media_url: media_url ? "attached" : null,
    });

    if (insertError) {
      console.error("Failed to save scheduled post:", insertError);
    }

    return new Response(JSON.stringify({ success: true, sprout_post: responseData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error scheduling post:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/schedule-sprout-post/index.ts
git commit -m "feat: add schedule-sprout-post Edge Function for Sprout Social Publishing API"
```

---

## Task 12: Update ReportView — Add Schedule Button + Video Button to Content Calendar

**Files:**
- Modify: `src/pages/ReportView.tsx`

**Step 1: Import new components**

Add at the top of the file:

```typescript
import { SchedulePostModal } from "@/components/reports/SchedulePostModal";
import { CreatePostVideoButton } from "@/components/reports/CreatePostVideoButton";
```

**Step 2: Add state for schedule modal in the CalendarPostCard component (line ~508)**

Inside CalendarPostCard, add state:

```typescript
const [scheduleOpen, setScheduleOpen] = useState(false);
const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
```

**Step 3: Add Schedule and Video buttons to CalendarPostCard (around line 527)**

After the CreatePostDesignButton, add:

```tsx
<CreatePostVideoButton post={post} brandIdentity={brandIdentity} />

<Button
  variant="outline"
  size="sm"
  onClick={(e) => {
    e.stopPropagation();
    setScheduleOpen(true);
  }}
>
  <Send className="h-3 w-3 mr-1" /> Schedule
</Button>

<SchedulePostModal
  open={scheduleOpen}
  onOpenChange={setScheduleOpen}
  post={post}
  clientId={clientId}
  reportId={reportId}
  generatedImageUrl={generatedImageUrl}
  clientTimezone={report?.report_data?.context?.timezone || "UTC"}
/>
```

Note: `clientId` and `reportId` need to be passed down to CalendarPostCard as props from the parent. Currently they come from `useParams()` in the parent component — pass them as additional props.

**Step 4: Add "Schedule All" button above content calendar (around line 363)**

Before the calendar map, add:

```tsx
<div className="flex items-center justify-between">
  <h3 className="text-base font-semibold flex items-center gap-2">
    <Calendar className="h-4 w-4" /> Weekly Content Calendar
  </h3>
  <Button variant="outline" size="sm" onClick={() => toast.info("Bulk scheduling coming soon")}>
    <Send className="h-3 w-3 mr-1" /> Schedule All
  </Button>
</div>
```

**Step 5: Update CreatePostDesignButton to expose generated image URL**

Modify CreatePostDesignButton to accept an optional `onImageGenerated` callback prop so ReportView can capture the URL for scheduling. Add to the interface:

```typescript
onImageGenerated?: (url: string) => void;
```

Call it when image is generated successfully.

**Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds (CreatePostVideoButton doesn't exist yet — create a stub or implement in next task).

**Step 7: Commit**

```bash
git add src/pages/ReportView.tsx src/components/reports/CreatePostDesignButton.tsx
git commit -m "feat: add Schedule and Video buttons to content calendar posts"
```

---

## Task 13: Enhanced Design Generation — Pass Brand References to Gemini

**Files:**
- Modify: `supabase/functions/generate-post-image/index.ts`

**Step 1: Update the function to accept and use design references**

In the request body parsing (around line 31), add:

```typescript
const { post, brandIdentity, designReferences, brandBookFilePath } = await req.json();
```

**Step 2: Fetch reference images from storage**

After parsing, add code to download reference images:

```typescript
// Fetch design reference images for multimodal input
const referenceImages: { mimeType: string; data: string }[] = [];

if (designReferences && Array.isArray(designReferences)) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const storageClient = createClient(supabaseUrl, supabaseKey);

  // Limit to first 3 references to control token usage
  for (const ref of designReferences.slice(0, 3)) {
    try {
      const { data: fileData } = await storageClient.storage
        .from("design-references")
        .download(ref);
      if (fileData) {
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        const ext = ref.split(".").pop()?.toLowerCase();
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        referenceImages.push({ mimeType, data: base64 });
      }
    } catch (e) {
      console.error("Failed to fetch reference:", ref, e);
    }
  }
}
```

**Step 3: Include references in the Gemini API call**

When building the Gemini request contents, add reference images as inline data parts before the text prompt:

```typescript
const parts: any[] = [];

// Add reference images first
if (referenceImages.length > 0) {
  parts.push({ text: "Here are existing brand design references. Match their visual style, layout patterns, and color usage:" });
  for (const img of referenceImages) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    });
  }
  parts.push({ text: "Now create a new design based on this brief:" });
}

// Add the main prompt
parts.push({ text: designPrompt });
```

Replace the existing single-text contents with:

```typescript
contents: [{ role: "user", parts }],
```

**Step 4: Update the frontend to pass design references**

In `CreatePostDesignButton.tsx`, update the function invoke to pass client's design references and brand book file path. These will need to be fetched from the client record or passed as props.

**Step 5: Commit**

```bash
git add supabase/functions/generate-post-image/index.ts src/components/reports/CreatePostDesignButton.tsx
git commit -m "feat: enhance design generation with brand design references via multimodal Gemini"
```

---

## Task 14: Video Generation Button Component

**Files:**
- Create: `src/components/reports/CreatePostVideoButton.tsx`

**Step 1: Create the component**

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Video, Loader2, Download, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CreatePostVideoButtonProps {
  post: any;
  brandIdentity?: any;
}

export function CreatePostVideoButton({ post, brandIdentity }: CreatePostVideoButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");

  const visualPrompt = post.ai_visual_prompt || post.visual_direction || "";

  const buildVideoPrompt = () => {
    const parts: string[] = [];
    parts.push(visualPrompt);
    parts.push("\nCreate a short video (5-8 seconds) with smooth motion and transitions.");
    parts.push(`Format: ${post.format || "short-form video"} for ${post.platform || "social media"}.`);

    if (brandIdentity) {
      const colors = [brandIdentity.primary_color, brandIdentity.secondary_color, brandIdentity.accent_color]
        .filter(Boolean)
        .join(", ");
      if (colors) parts.push(`Brand colors: ${colors}`);
      if (brandIdentity.visual_style) parts.push(`Visual style: ${brandIdentity.visual_style}`);
    }

    parts.push("No text overlays, logos, or watermarks. Clean, professional motion design.");
    return parts.join("\n");
  };

  const handleOpen = () => {
    setPrompt(buildVideoPrompt());
    setOpen(true);
  };

  const generateVideo = async () => {
    setLoading(true);
    setVideoUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-post-video", {
        body: {
          prompt,
          platform: post.platform,
          format: post.format,
          brandIdentity,
        },
      });

      if (error) throw error;
      if (data?.video_url) {
        setVideoUrl(data.video_url);
        toast.success("Video generated!");
      } else {
        toast.error("Video generation failed — no video returned");
      }
    } catch (err: any) {
      toast.error("Video generation failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show video button more prominently for video formats
  const isVideoFormat = ["reel", "reels", "story", "stories", "tiktok", "video", "short"]
    .some((f) => (post.format || "").toLowerCase().includes(f));

  return (
    <>
      <Button
        variant={isVideoFormat ? "default" : "outline"}
        size="sm"
        onClick={handleOpen}
      >
        <Video className="h-3 w-3 mr-1" /> Video
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="h-4 w-4" /> Generate Video
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Video Prompt</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="text-xs"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={generateVideo} disabled={loading} className="flex-1">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating (30-120s)...
                  </>
                ) : (
                  <>
                    <Video className="h-4 w-4 mr-2" /> Generate Video
                  </>
                )}
              </Button>
              {videoUrl && (
                <Button variant="outline" onClick={generateVideo} disabled={loading}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              )}
            </div>

            {loading && (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Generating video with Google Veo... This may take 30-120 seconds.
                </p>
              </div>
            )}

            {videoUrl && (
              <div className="space-y-2">
                <video
                  src={videoUrl}
                  controls
                  className="w-full rounded-md border"
                  autoPlay
                  loop
                  muted
                />
                <a href={videoUrl} download className="block">
                  <Button variant="outline" size="sm" className="w-full">
                    <Download className="h-3 w-3 mr-1" /> Download Video
                  </Button>
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/components/reports/CreatePostVideoButton.tsx
git commit -m "feat: add CreatePostVideoButton component for video generation UI"
```

---

## Task 15: Supabase Edge Function — `generate-post-video`

**Files:**
- Create: `supabase/functions/generate-post-video/index.ts`

**Step 1: Create the Edge Function using Google Veo via Gemini API**

```typescript
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getAspectRatio(platform?: string, format?: string): string {
  const fmt = (format || "").toLowerCase();
  const plat = (platform || "").toLowerCase();

  if (fmt.includes("story") || fmt.includes("reel") || plat === "tiktok") return "9:16";
  if (plat === "linkedin" || fmt.includes("article")) return "16:9";
  if (plat === "youtube") return "16:9";
  return "9:16"; // Default vertical for short-form video
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, platform, format, brandIdentity } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "prompt is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get Gemini API key
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      const { data: settings } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "gemini_api_key")
        .single();
      geminiKey = settings?.value;
    }

    if (!geminiKey) {
      throw new Error("Gemini API key not configured");
    }

    const aspectRatio = getAspectRatio(platform, format);

    // Use Gemini Veo model for video generation
    // Note: The exact endpoint may vary — using the generateContent endpoint with video model
    const veoEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${geminiKey}`;

    const response = await fetch(veoEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [
          {
            prompt: prompt,
          },
        ],
        parameters: {
          aspectRatio: aspectRatio,
          durationSeconds: 8,
          numberOfVideos: 1,
        },
      }),
    });

    if (!response.ok) {
      // Fallback: try using Imagen video or a simpler approach
      const errorText = await response.text();
      console.error("Veo API error:", errorText);

      // Try alternative Gemini video generation endpoint
      const altEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`;

      const altResponse = await fetch(altEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: `Generate a short video: ${prompt}` },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["VIDEO"],
          },
        }),
      });

      if (!altResponse.ok) {
        const altError = await altResponse.text();
        throw new Error(`Video generation failed: ${altError}`);
      }

      const altData = await altResponse.json();
      // Extract video from response
      const videoPart = altData.candidates?.[0]?.content?.parts?.find(
        (p: any) => p.inlineData?.mimeType?.startsWith("video/")
      );

      if (videoPart?.inlineData) {
        const videoDataUrl = `data:${videoPart.inlineData.mimeType};base64,${videoPart.inlineData.data}`;
        return new Response(JSON.stringify({ video_url: videoDataUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error("No video generated");
    }

    // Handle long-running operation response
    const operationData = await response.json();

    // If it returns an operation ID, we need to poll for completion
    if (operationData.name) {
      // Poll for operation completion
      const operationName = operationData.name;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes max

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        attempts++;

        const pollResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${geminiKey}`
        );
        const pollData = await pollResponse.json();

        if (pollData.done) {
          const videoUri = pollData.response?.generatedSamples?.[0]?.video?.uri;
          if (videoUri) {
            return new Response(JSON.stringify({ video_url: videoUri }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          throw new Error("Operation completed but no video URL found");
        }
      }

      throw new Error("Video generation timed out");
    }

    // Direct response with video
    const videoUri = operationData.response?.generatedSamples?.[0]?.video?.uri ||
      operationData.generatedSamples?.[0]?.video?.uri;

    if (videoUri) {
      return new Response(JSON.stringify({ video_url: videoUri }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("Unexpected response format from Veo API");
  } catch (error: any) {
    console.error("Error generating video:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

**Step 2: Commit**

```bash
git add supabase/functions/generate-post-video/index.ts
git commit -m "feat: add generate-post-video Edge Function using Google Veo"
```

---

## Task 16: Final Integration — Wire Everything Together

**Files:**
- Modify: `src/pages/ReportView.tsx` (ensure all imports and props are correct)
- Modify: `src/components/reports/CreatePostDesignButton.tsx` (add design_references + brand_book_file_path props)
- Verify: All components compile and render correctly

**Step 1: Update CreatePostDesignButton to fetch client data for design references**

Add props for `clientId` and fetch client's design_references and brand_book_file_path. Pass them to the `generate-post-image` function invoke:

```typescript
const { data, error } = await supabase.functions.invoke("generate-post-image", {
  body: {
    post: { ...post, prompt: enhancedPrompt },
    brandIdentity,
    designReferences: client?.design_references || [],
    brandBookFilePath: client?.brand_book_file_path || null,
  },
});
```

**Step 2: Update CalendarPostCard in ReportView to pass clientId and reportId**

The CalendarPostCard component needs `clientId` and `reportId` as props. These come from `useParams()` in the parent ReportView component. Pass them down through the component tree.

**Step 3: Full build verification**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 4: Manual smoke test**

Run: `npm run dev`
Test each feature:
1. Navigate to client setup → verify brand book upload, design references upload, timezone dropdown
2. Navigate to a report → verify Schedule and Video buttons appear on content calendar posts
3. Test archive/restore on AdminDashboard
4. Verify no console errors

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: final integration wiring for all new features"
```

---

## Summary of All Tasks

| Task | Feature | Description |
|------|---------|-------------|
| 1 | DB Schema | Add columns + scheduled_posts table + storage buckets |
| 2 | Brand Book | BrandBookUpload component |
| 3 | Design Refs | DesignReferencesUpload component |
| 4 | Onboarding | Update ClientSetup with new components + timezone |
| 5 | Edge Function | extract-brand-from-file (GPT-4.1 Vision) |
| 6 | Webhook | Add timezone to RunAnalysis webhook payload |
| 7 | n8n | Update workflow to use timezone in content calendar |
| 8 | Client Delete | AdminDashboard archive/restore/delete UI |
| 9 | Edge Function | delete-client (cascading deletion) |
| 10 | Scheduling | SchedulePostModal component |
| 11 | Edge Function | schedule-sprout-post (Sprout Publishing API) |
| 12 | Calendar UI | Add Schedule + Video buttons to ReportView |
| 13 | Design | Enhanced Gemini with design references (multimodal) |
| 14 | Video UI | CreatePostVideoButton component |
| 15 | Edge Function | generate-post-video (Google Veo) |
| 16 | Integration | Wire everything together, final verification |
