import { useCallback, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { fileKey, useQuietUpload } from "@/hooks/useQuietUpload";

/** 4MB is what the reader takes; a larger file would be refused by the server, so it is not sent. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The client's social strategy, as a document.
 *
 * When there is one, the lifecycle takes the brief from it in its own words
 * and reads the pillars and keywords from it (brief_pillars); uploading one
 * later runs that again. It shares the brand-books bucket: same access rules,
 * one fewer thing to keep consistent.
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const name = filePath ? filePath.split("/").pop() || null : null;
  const folder = (clientName || "client").replace(/[^a-zA-Z0-9]/g, "-");
  const pathFor = (file: File) => `${folder}/strategy-${clientId || "new"}-${fileKey(file)}`;
  const upload = useCallback((file: File) => supabase.storage.from("brand-books").upload(pathFor(file), file, { upsert: true }), [folder, clientId]);
  const done = useCallback((file: File) => {
    onFilePathChange(pathFor(file));
    toast.success("Strategy uploaded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onFilePathChange, folder, clientId]);
  const { send, again, uploading, pending } = useQuietUpload(upload, done);

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const allowed = ["application/pdf", "text/plain", "text/markdown"];
    if ((!allowed.includes(file.type) && !/\.(pdf|txt|md)$/i.test(file.name)) || file.size > MAX_BYTES) {
      setRefused(file.name);
      return;
    }
    setRefused(null);
    void send(file);
  };

  /**
   * Detach the document from the client.
   *
   * The stored object is deliberately left where it is: a form that was never
   * saved would otherwise leave the client pointing at a file that no longer
   * exists. An unreferenced object costs a few kilobytes.
   */
  const remove = () => {
    onFilePathChange("");
  };

  return (
    <div className="glass-inner p-inner space-y-3">
        <div>
          <Label>Social strategy document</Label>
          <p className="t-secondary">
            A strategy deck or brief, as PDF, TXT or Markdown under 4 MB. The brief, pillars and keywords are read from it.
          </p>
        </div>
        {name ? (
          <div className="glass-inner p-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="t-body truncate">{name}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setConfirmRemove(true)}
              className="ml-auto"
              aria-label="Remove the strategy document"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <label className="inline-flex">
            <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" className="sr-only" onChange={choose} disabled={uploading} />
            <span className={buttonVariants({ variant: "outline", size: "sm" })}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Upload a strategy"}
            </span>
          </label>
        )}
        {refused && <p className="t-secondary" role="status">{refused} is not a PDF, TXT or Markdown file under 4 MB.</p>}
        {pending && !uploading && (
          <div className="flex items-center gap-2" role="status">
            <span className="t-secondary truncate">{pending.name} is not uploaded yet.</span>
            <Button variant="outline" size="sm" onClick={() => void again()}>Upload</Button>
          </div>
        )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the strategy document?"
        description={
          <>
            {name ? <strong>{name}</strong> : "This document"} will no longer be read for {clientName}'s brief, pillars and
            keywords once the client is saved.
          </>
        }
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  );
}
