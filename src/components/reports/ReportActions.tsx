import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

  const [dateStart, setDateStart] = useState(report.date_range_start || "");
  const [dateEnd, setDateEnd] = useState(report.date_range_end || "");
  const [gammaUrl, setGammaUrl] = useState(report.gamma_url || "");

  const handleEdit = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("reports")
      .update({
        date_range_start: dateStart || null,
        date_range_end: dateEnd || null,
        gamma_url: gammaUrl || null,
      })
      .eq("id", report.id);
    setSaving(false);

    if (error) {
      toast({ title: "Error updating report", description: error.message, variant: "destructive" });
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
    // Ask for the row back. A delete the database refuses returns no error
    // and no rows, which used to toast success over a report that is still
    // there.
    const { data, error } = await supabase.from(table as any).delete().eq("id", report.id).select("id");
    if (error) {
      toast({ title: "Could not delete the report", description: error.message, variant: "destructive" });
    } else if (!data || data.length === 0) {
      toast({
        title: "Could not delete the report",
        description: "You do not have permission to delete this one. An admin can.",
        variant: "destructive",
      });
    } else {
      toast({ title: "Report deleted" });
      for (const key of kind === "competitive"
        ? ["all-competitive-reports", "competitive-reports-history", "competitive-reports", "competitive-report", "competitive-latest", "competitive-runs"]
        : ["reports", "reports-history", "all-reports", "report"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onDeleted?.();
    }
    setDeleteOpen(false);
  };

  if (!canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Report actions" variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={(e) => e.stopPropagation()}>
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
        onOpenChange={setDeleteOpen}
        title={kind === "competitive" ? "Delete this competitive report?" : "Delete this report?"}
        description={
          <>
            <p>The report and its analysis go for good. This cannot be undone.</p>
            <p className="t-secondary">
              {kind === "competitive"
                ? "The cached RivalIQ data and any feedback on its insights stay, no longer attached to a report."
                : "Designs and scheduled posts made from it stay, no longer attached to a report."}
            </p>
          </>
        }
        confirmLabel="Delete report"
        onConfirm={handleDelete}
      />
    </>
  );
}
