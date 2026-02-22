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
      const printWindow = window.open("", "_blank");
      if (!printWindow) {
        throw new Error("Pop-up blocked. Please allow pop-ups and try again.");
      }

      // Get all stylesheets
      const styleSheets = Array.from(document.styleSheets);
      let cssText = "";
      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          cssText += rules.map((r) => r.cssText).join("\n");
        } catch {
          if (sheet.href) cssText += `@import url("${sheet.href}");\n`;
        }
      }

      // CRITICAL FIX: Before cloning, temporarily activate ALL tab panels
      // Find all TabsContent containers inside the ref and make them visible
      const tabPanels = contentRef.current.querySelectorAll('[role="tabpanel"]');
      const originalStates: { el: Element; state: string | null; display: string }[] = [];

      tabPanels.forEach((panel) => {
        originalStates.push({
          el: panel,
          state: panel.getAttribute("data-state"),
          display: (panel as HTMLElement).style.display,
        });
        panel.setAttribute("data-state", "active");
        (panel as HTMLElement).style.display = "block";
      });

      // Also handle hidden attribute that Radix uses
      const hiddenPanels = contentRef.current.querySelectorAll("[hidden]");
      const originalHidden: Element[] = [];
      hiddenPanels.forEach((el) => {
        originalHidden.push(el);
        el.removeAttribute("hidden");
      });

      // Clone content with all tabs now visible
      const content = contentRef.current.cloneNode(true) as HTMLElement;

      // Restore original state immediately
      originalStates.forEach(({ el, state, display }) => {
        if (state !== null) el.setAttribute("data-state", state);
        (el as HTMLElement).style.display = display;
      });
      originalHidden.forEach((el) => el.setAttribute("hidden", ""));

      // Remove interactive buttons
      content.querySelectorAll("button").forEach((btn) => {
        const text = btn.textContent?.toLowerCase() || "";
        if (text.includes("export") || text.includes("copy") || text.includes("pending")) {
          btn.remove();
        }
      });

      content.querySelectorAll('[data-slot="dropdown-menu"]').forEach((el) => el.remove());
      content.querySelectorAll("button").forEach((btn) => {
        if (btn.querySelector("svg") && !btn.textContent?.trim()) {
          btn.remove();
        }
      });

      // Remove presentation banner placeholder
      const cards = content.querySelectorAll(".border-dashed");
      cards.forEach((card) => card.remove());

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${filename}</title>
  <style>
    ${cssText}

    /* Print overrides */
    :root {
      --background: 0 0% 100%;
      --foreground: 0 0% 3.9%;
      --card: 0 0% 100%;
      --card-foreground: 0 0% 3.9%;
      --muted: 0 0% 96.1%;
      --muted-foreground: 0 0% 45.1%;
      --border: 0 0% 89.8%;
      --primary: 0 0% 9%;
      --primary-foreground: 0 0% 98%;
      --secondary: 0 0% 96.1%;
      --secondary-foreground: 0 0% 9%;
      --accent: 0 0% 96.1%;
      --accent-foreground: 0 0% 9%;
      --destructive: 0 84.2% 60.2%;
      --success: 142 76% 36%;
      --warning: 38 92% 50%;
    }

    * { color-scheme: light !important; }

    body {
      background: white !important;
      color: hsl(0 0% 3.9%) !important;
      font-family: Inter, system-ui, -apple-system, sans-serif;
      padding: 20px 40px;
      max-width: 1100px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    [data-slot="card"], .rounded-lg.border {
      border: 1px solid hsl(0 0% 89.8%) !important;
      background: white !important;
      break-inside: avoid;
      margin-bottom: 12px;
    }

    .grid { gap: 12px !important; }
    .space-y-6 > * + * { margin-top: 24px !important; }
    .space-y-8 > * + * { margin-top: 32px !important; }
    .space-y-4 > * + * { margin-top: 16px !important; }
    .space-y-3 > * + * { margin-top: 12px !important; }

    .text-muted-foreground { color: hsl(0 0% 45.1%) !important; }
    .text-foreground { color: hsl(0 0% 3.9%) !important; }
    .text-destructive { color: hsl(0 84.2% 60.2%) !important; }
    .text-success { color: hsl(142 76% 36%) !important; }
    .text-warning { color: hsl(38 92% 50%) !important; }

    [data-slot="badge"] {
      display: inline-flex !important;
      border: 1px solid hsl(0 0% 89.8%) !important;
      padding: 2px 8px !important;
      border-radius: 6px !important;
      font-size: 12px !important;
      background: hsl(0 0% 96.1%) !important;
      color: hsl(0 0% 9%) !important;
    }

    .recharts-wrapper { break-inside: avoid; }

    /* CRITICAL: Hide tab navigation, show ALL tab content */
    [role="tablist"] { display: none !important; }
    [role="tabpanel"] {
      display: block !important;
      opacity: 1 !important;
      position: static !important;
      pointer-events: auto !important;
    }
    [role="tabpanel"][data-state="inactive"] {
      display: block !important;
    }
    [role="tabpanel"][hidden] {
      display: block !important;
    }

    /* Section separators for merged tab content */
    [role="tabpanel"] + [role="tabpanel"] {
      border-top: 2px solid hsl(0 0% 89.8%);
      padding-top: 24px;
      margin-top: 24px;
    }

    h2, h3 { break-after: avoid; }
    .animate-pulse { animation: none !important; }

    @media print {
      body { padding: 0; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  ${content.outerHTML}
</body>
</html>`;

      printWindow.document.write(html);
      printWindow.document.close();

      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          setTimeout(() => printWindow.close(), 1000);
        }, 500);
      };

      toast({ title: "PDF export ready", description: "Use the print dialog to save as PDF" });
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
