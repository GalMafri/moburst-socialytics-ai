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

      // ── Clone and clean content ──
      // All TabsContent panels use forceMount so they're always in the DOM.
      const content = contentRef.current.cloneNode(true) as HTMLElement;

      // Show all tab panels (inactive ones are hidden via data-state)
      content.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
        (panel as HTMLElement).style.display = "block";
        (panel as HTMLElement).removeAttribute("hidden");
        panel.setAttribute("data-state", "active");
      });

      // Add section headers before each tab panel
      const tabsList = content.querySelector('[role="tablist"]');
      const tabLabels: string[] = [];
      if (tabsList) {
        tabsList.querySelectorAll('[role="tab"]').forEach((tab) => {
          tabLabels.push(tab.textContent?.trim() || "");
        });
      }
      const panels = content.querySelectorAll('[role="tabpanel"]');
      panels.forEach((panel, i) => {
        if (tabLabels[i]) {
          const header = document.createElement("h2");
          header.className = "pdf-tab-section-header";
          header.style.cssText = "font-size:1.25rem;font-weight:700;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid hsl(0 0% 89.8%);";
          header.textContent = tabLabels[i];
          panel.parentElement?.insertBefore(header, panel);
        }
      });

      // Remove the tab list itself
      if (tabsList) tabsList.remove();

      // ── Collect stylesheets ──
      const styleSheets = Array.from(document.styleSheets);
      let cssText = "";

      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          cssText += rules.map((r) => r.cssText).join("\n");
        } catch {
          if (sheet.href) {
            cssText += `@import url("${sheet.href}");\n`;
          }
        }
      }

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

    * {
      color-scheme: light !important;
    }

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

    /* Ensure cards have visible borders */
    [data-slot="card"], .rounded-lg.border {
      border: 1px solid hsl(0 0% 89.8%) !important;
      background: white !important;
      break-inside: avoid;
      margin-bottom: 12px;
    }

    /* Grid layouts */
    .grid {
      gap: 12px !important;
    }

    /* Space between sections */
    .space-y-6 > * + * { margin-top: 24px !important; }
    .space-y-8 > * + * { margin-top: 32px !important; }
    .space-y-4 > * + * { margin-top: 16px !important; }
    .space-y-3 > * + * { margin-top: 12px !important; }

    /* Fix text colors */
    .text-muted-foreground {
      color: hsl(0 0% 45.1%) !important;
    }

    .text-foreground {
      color: hsl(0 0% 3.9%) !important;
    }

    .text-destructive {
      color: hsl(0 84.2% 60.2%) !important;
    }

    .text-success {
      color: hsl(142 76% 36%) !important;
    }

    .text-warning {
      color: hsl(38 92% 50%) !important;
    }

    /* Badge styling */
    [data-slot="badge"] {
      display: inline-flex !important;
      border: 1px solid hsl(0 0% 89.8%) !important;
      padding: 2px 8px !important;
      border-radius: 6px !important;
      font-size: 12px !important;
      background: hsl(0 0% 96.1%) !important;
      color: hsl(0 0% 9%) !important;
    }

    /* Recharts fix */
    .recharts-wrapper {
      break-inside: avoid;
    }

    /* Hide any leftover tablist elements */
    [role="tablist"] {
      display: none !important;
    }

    /* Tab section dividers */
    .pdf-tab-section {
      break-inside: avoid;
    }

    /* Page break control */
    h2, h3 {
      break-after: avoid;
    }

    .animate-pulse {
      animation: none !important;
    }

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

      // Wait for content and styles to load, then trigger print
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
