import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface ReportActionsProps {
  report: {
    id: string;
    date_range_start?: string | null;
    date_range_end?: string | null;
    report_type?: string | null;
    gamma_url?: string | null;
  };
  /**
   * Which kind of report this row is. A competitive report lives in its own
   * table and has no metadata to edit — its dates come from the run — so the
   * same control serves both and shows only what applies.
   */
  kind?: "monthly" | "competitive";
  onDeleted?: () => void;
}

export function ReportActions({ report, kind = "monthly", onDeleted }: ReportActionsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canDelete } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** An edit or a delete that has not reached the database yet; the report is as it was. */
  const [notSaved, setNotSaved] = useState(false);
  const [notDeleted, setNotDeleted] = useState(false);

  const [dateStart, setDateStart] = useState(report.date_range_start || "");
  const [dateEnd, setDateEnd] = useState(report.date_range_end || "");
  const [gammaUrl, setGammaUrl] = useState(report.gamma_url || "");

  // Writing the same fields again is harmless, so an edit that does not get through is sent again quietly.
  const handleEdit = async () => {
    setSaving(true);
    setNotSaved(false);
    const { error } = await sendQuietly(() => supabase
      .from("reports")
      .update({
        date_range_start: dateStart || null,
        date_range_end: dateEnd || null,
        gamma_url: gammaUrl || null,
      })
      .eq("id", report.id), { again: writeResendable });
    setSaving(false);

    if (error) {
      // The dialog stays open with what was typed.
      console.warn("[report edit] not saved yet", error);
      setNotSaved(true);
    } else {
      toast({ title: "Report updated" });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["report", report.id] });
      queryClient.invalidateQueries({ queryKey: ["reports-history"] });
      queryClient.invalidateQueries({ queryKey: ["all-reports"] });
      setEditOpen(false);
    }
  };

  const table = kind === "competitive" ? "competitive_reports" : "reports";

  const handleDelete = async () => {
    setNotDeleted(false);
    // Ask for the row back. A delete the database refuses returns no error
    // and no rows, which used to toast success over a report that is still
    // there. A delete repeats safely, so one that does not get through is
    // sent again quietly.
    const { data, error } = await sendQuietly(() => supabase.from(table as any).delete().eq("id", report.id).select("id"), { again: writeResendable });
    let gone = !error && !!data && data.length > 0;
    if (!error && !gone) {
      // No row back: it was already gone (a repeat after a reply that was
      // lost), or the database kept it. Reading it says which.
      const { data: still, error: readError } = await supabase.from(table as any).select("id").eq("id", report.id).maybeSingle();
      gone = !readError && !still;
    }
    if (!gone) {
      // The dialog stays up and says the report is still here.
      console.warn("[report delete] not deleted yet", error ?? "the row is still there");
      setNotDeleted(true);
      return;
    }
    toast({ title: "Report deleted" });
    for (const key of kind === "competitive"
      ? ["all-competitive-reports", "competitive-reports-history", "competitive-reports", "competitive-report", "competitive-latest", "competitive-latest-ready", "competitive-snapshot", "competitive-runs"]
      : ["reports", "reports-history", "all-reports", "report"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    onDeleted?.();
    setDeleteOpen(false);
  };

  if (!canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Report actions" variant="ghost" size="icon-sm" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {kind === "monthly" && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen && kind === "monthly"} onOpenChange={setEditOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Edit report</DialogTitle>
            <DialogDescription>Update report metadata.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Date Range Start</Label>
              <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Date Range End</Label>
              <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Presentation URL</Label>
              <Input value={gammaUrl} onChange={(e) => setGammaUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          {notSaved && <p role="status" className="t-secondary">Not saved yet. Your changes are kept here.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => { setDeleteOpen(o); if (!o) setNotDeleted(false); }}
        title={kind === "competitive" ? "Delete this competitive report?" : "Delete this report?"}
        description={
          <>
            <p>The report and its analysis go for good. This cannot be undone.</p>
            <p className="t-secondary">
              {kind === "competitive"
                ? "The cached RivalIQ data and any feedback on its insights stay, no longer attached to a report."
                : "Designs and scheduled posts made from it stay, no longer attached to a report."}
            </p>
            {notDeleted && <p role="status" className="t-secondary">Not deleted yet. The report is still here.</p>}
          </>
        }
        confirmLabel="Delete report"
        onConfirm={handleDelete}
      />
    </>
  );
}
