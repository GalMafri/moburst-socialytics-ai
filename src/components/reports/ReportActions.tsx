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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  onDeleted?: () => void;
}

export function ReportActions({ report, onDeleted }: ReportActionsProps) {
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

  const handleDelete = async () => {
    const { error } = await supabase.from("reports").delete().eq("id", report.id);
    if (error) {
      toast({ title: "Error deleting report", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Report deleted" });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["reports-history"] });
      queryClient.invalidateQueries({ queryKey: ["all-reports"] });
      onDeleted?.();
    }
    setDeleteOpen(false);
  };

  if (!canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Edit Report</DialogTitle>
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this report. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
