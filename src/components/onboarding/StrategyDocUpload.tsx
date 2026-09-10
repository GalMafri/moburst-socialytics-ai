import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";

/**
 * The client's social strategy, as a document.
 *
 * For a client with no posting history there is nothing to read pillars
 * from, and the strategy deck they arrive with holds all of it. It shares
 * the brand-books bucket: same access rules, one fewer thing to keep
 * consistent.
 */
export function StrategyDocUpload({
  clientId,
  clientName,
  filePath,
  onFilePathChange,
}: {
  clientId?: string;
  clientName: string;
  filePath: string;
  onFilePathChange: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = filePath ? filePath.split("/").pop() || null : null;

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["application/pdf", "text/plain", "text/markdown"];
    if (!allowed.includes(file.type) && !/\.(pdf|txt|md)$/i.test(file.name)) {
      toast.error("Upload a PDF, TXT or Markdown file");
      return;
    }
    // 4MB is what the reader accepts; a larger file is rejected server-side,
    // so it is refused here instead of after the upload.
    if (file.size > 4 * 1024 * 1024) {
      toast.error("The file must be under 4MB — that is the largest the reader takes");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const folder = (clientName || "client").replace(/[^a-zA-Z0-9]/g, "-");
      const path = `${folder}/strategy-${clientId || "new"}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("brand-books").upload(path, file);
      if (error) throw error;
      onFilePathChange(path);
      toast.success("Strategy uploaded. Read the pillars from it below.");
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  /**
   * Detach the document from the client.
   *
   * The stored object is deliberately left where it is. Deleting it here
   * removed the file while clients.strategy_doc_file_path still pointed at
   * it, so a form that was never saved, or a save that failed, left the
   * client referencing a file that no longer existed and pillar derivation
   * reading nothing. An unreferenced object costs a few kilobytes; a
   * dangling pointer costs a broken feature.
   */
  const remove = () => {
    onFilePathChange("");
    toast.success("Strategy removed. Save the client to keep the change.");
  };

  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <div>
          <Label>Social strategy document</Label>
          <p className="t-secondary">
            A strategy deck or brief, as PDF, TXT or Markdown. The pillars and keywords are read from it.
          </p>
        </div>
        {name ? (
          <div className="glass-inner p-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="t-body truncate">{name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRemove(true)}
              className="ml-auto h-8 w-8 p-0"
              aria-label="Remove the strategy document"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <label className="inline-flex">
            <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" className="sr-only" onChange={upload} disabled={uploading} />
            <span className="inline-flex items-center gap-2 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[rgba(21,23,28,0.2)] px-4 h-9 t-body cursor-pointer hover:bg-[rgba(255,255,255,0.06)]">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload a strategy"}
            </span>
          </label>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the strategy document?"
        description={
          <>
            {name ? <strong>{name}</strong> : "This document"} will no longer be read for {clientName}'s content
            pillars and keywords. The change takes effect when you save the client.
          </>
        }
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </Card>
  );
}
