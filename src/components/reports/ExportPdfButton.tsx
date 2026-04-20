import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportReportToPdf } from "@/lib/exportPdf";

interface ExportPdfButtonProps {
  contentRef: React.RefObject<HTMLDivElement>;
  filename?: string;
  title?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  label?: string;
}

export function ExportPdfButton({
  contentRef,
  filename = "report",
  title,
  variant = "outline",
  size = "sm",
  label = "Export PDF",
}: ExportPdfButtonProps) {
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    if (!contentRef.current) return;
    setExporting(true);
    try {
      await exportReportToPdf({ contentRef, filename, title });
      toast({
        title: "PDF export ready",
        description: "Save as PDF from the print dialog, then close the tab when done.",
      });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={handleExport} disabled={exporting}>
      {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
      {exporting ? "Exporting..." : label}
    </Button>
  );
}
