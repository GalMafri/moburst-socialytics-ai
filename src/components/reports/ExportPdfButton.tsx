import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportPdfButtonProps {
  contentRef: React.RefObject<HTMLDivElement>;
  filename?: string;
}

export function ExportPdfButton({ contentRef, filename = "report" }: ExportPdfButtonProps) {
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    if (!contentRef.current) return;
    setExporting(true);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      // Clone the content to avoid modifying the live DOM
      const clone = contentRef.current.cloneNode(true) as HTMLElement;

      // Apply print-friendly styles to the clone
      clone.style.width = "1100px";
      clone.style.padding = "40px";
      clone.style.background = "#ffffff";
      clone.style.color = "#1a1a1a";
      clone.style.position = "absolute";
      clone.style.left = "-9999px";
      clone.style.top = "0";
      clone.style.fontFamily = "Inter, system-ui, sans-serif";

      // Fix all text colors for PDF readability
      clone.querySelectorAll("*").forEach((el) => {
        const htmlEl = el as HTMLElement;
        const computed = window.getComputedStyle(htmlEl);

        // Ensure text is dark on white background
        if (computed.color === "rgba(0, 0, 0, 0)" || computed.color === "transparent") {
          htmlEl.style.color = "#1a1a1a";
        }

        // Fix card backgrounds
        if (htmlEl.classList.contains("border") || htmlEl.tagName === "SECTION") {
          htmlEl.style.borderColor = "#e5e7eb";
        }

        // Ensure spacing between sections
        if (htmlEl.classList.contains("space-y-6") || htmlEl.classList.contains("space-y-8")) {
          htmlEl.style.display = "flex";
          htmlEl.style.flexDirection = "column";
          htmlEl.style.gap = "24px";
        }

        if (htmlEl.classList.contains("space-y-4")) {
          htmlEl.style.display = "flex";
          htmlEl.style.flexDirection = "column";
          htmlEl.style.gap = "16px";
        }

        if (htmlEl.classList.contains("space-y-3")) {
          htmlEl.style.display = "flex";
          htmlEl.style.flexDirection = "column";
          htmlEl.style.gap = "12px";
        }

        // Fix grid layouts
        if (htmlEl.classList.contains("grid")) {
          htmlEl.style.display = "grid";
          htmlEl.style.gap = "16px";
        }

        // Ensure badges are visible
        if (htmlEl.getAttribute("data-slot") === "badge" || htmlEl.classList.contains("badge")) {
          htmlEl.style.display = "inline-flex";
          htmlEl.style.padding = "2px 8px";
          htmlEl.style.borderRadius = "4px";
          htmlEl.style.fontSize = "12px";
        }
      });

      // Remove interactive elements not relevant for PDF
      clone.querySelectorAll("button").forEach((btn) => {
        const text = btn.textContent?.toLowerCase() || "";
        if (text.includes("export") || text.includes("edit") || text.includes("delete") || text.includes("copy")) {
          btn.remove();
        }
      });

      // Remove dropdown menus
      clone.querySelectorAll("[data-radix-popper-content-wrapper]").forEach((el) => el.remove());

      document.body.appendChild(clone);

      // Wait for layout
      await new Promise((r) => setTimeout(r, 500));

      const canvas = await html2canvas(clone, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        width: 1100,
        windowWidth: 1100,
      });

      document.body.removeChild(clone);

      const imgData = canvas.toDataURL("image/png");
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const margin = 5; // small margin in mm
      const contentWidth = imgWidth - margin * 2;
      const imgHeight = (canvas.height * contentWidth) / canvas.width;

      const pdf = new jsPDF("p", "mm", "a4");
      let heightLeft = imgHeight;
      let position = margin;

      pdf.addImage(imgData, "PNG", margin, position, contentWidth, imgHeight);
      heightLeft -= (pageHeight - margin * 2);

      while (heightLeft > 0) {
        position = -(pageHeight - margin * 2) * (Math.ceil((imgHeight - heightLeft) / (pageHeight - margin * 2))) + margin;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", margin, position, contentWidth, imgHeight);
        heightLeft -= (pageHeight - margin * 2);
      }

      pdf.save(`${filename}.pdf`);
      toast({ title: "PDF exported successfully" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
      {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
      {exporting ? "Exporting..." : "Export PDF"}
    </Button>
  );
}
