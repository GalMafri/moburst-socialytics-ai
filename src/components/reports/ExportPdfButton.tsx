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
          header.style.cssText = "font-size:1.25rem;font-weight:700;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid rgba(255,255,255,0.08);color:#ffffff;";
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

    /* Intercept dark theme for PDF */
    :root {
      --background: 228 23% 5%;
      --foreground: 0 0% 100%;
      --card: 0 0% 0%;
      --card-foreground: 0 0% 100%;
      --muted: 222 10% 16%;
      --muted-foreground: 218 11% 65%;
      --border: 220 12% 14%;
      --primary: 72 75% 57%;
      --primary-foreground: 0 0% 0%;
      --secondary: 220 12% 16%;
      --secondary-foreground: 0 0% 90%;
      --accent: 222 10% 16%;
      --accent-foreground: 0 0% 95%;
      --destructive: 0 70% 50%;
      --destructive-foreground: 0 0% 100%;
      --success: 160 84% 39%;
      --warning: 30 100% 55%;
    }

    * {
      color-scheme: dark !important;
      border-color: rgba(255, 255, 255, 0.05);
    }

    body {
      background: #0b0c10 !important;
      color: #ffffff !important;
      font-family: "Geist", "Inter", system-ui, -apple-system, sans-serif;
      padding: 20px 40px;
      max-width: 1100px;
      margin: 0 auto;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* Cards: dark glass appearance */
    [data-slot="card"], .glass, .rounded-lg.border {
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-top-color: rgba(255, 255, 255, 0.14) !important;
      background: rgba(26, 29, 35, 0.85) !important;
      border-radius: 20px !important;
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

    /* Text colors */
    .text-muted-foreground {
      color: #9ca3af !important;
    }

    .text-foreground, h1, h2, h3, h4 {
      color: #ffffff !important;
    }

    .text-destructive {
      color: rgb(248, 113, 113) !important;
    }

    .text-success {
      color: #10b981 !important;
    }

    .text-warning {
      color: #f59e0b !important;
    }

    p, span, div, td, th, li {
      color: inherit;
    }

    /* Badge styling — dark theme */
    [data-slot="badge"] {
      display: inline-flex !important;
      padding: 2px 8px !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
    }

    /* Table styling */
    table { border-collapse: collapse; width: 100%; }
    th {
      color: #9ca3af !important;
      text-transform: uppercase;
      font-size: 11px !important;
      letter-spacing: 0.05em;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    }
    tr {
      border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
    }
    td {
      color: #ffffff !important;
    }

    /* Inner surfaces */
    .glass-inner, .bg-\\[rgba\\(255\\,255\\,255\\,0\\.03\\)\\], .bg-\\[rgba\\(255\\,255\\,255\\,0\\.04\\)\\] {
      background: rgba(255, 255, 255, 0.03) !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-radius: 12px !important;
    }

    /* Separator */
    hr, [role="separator"] {
      border-color: rgba(255, 255, 255, 0.06) !important;
      background: rgba(255, 255, 255, 0.06) !important;
    }

    /* Recharts fix */
    .recharts-wrapper {
      break-inside: avoid;
    }
    .recharts-cartesian-axis-tick text {
      fill: #9ca3af !important;
    }
    .recharts-cartesian-grid line {
      stroke: rgba(255, 255, 255, 0.05) !important;
    }

    /* Hide leftover tablist elements */
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

    /* Remove animations in print */
    .animate-pulse, .animate-slide-up {
      animation: none !important;
    }

    /* Remove glass effects that won't render in print */
    .glass, .glass-inner, .glass-elevated {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    /* Accent color for links */
    a {
      color: #b9e045 !important;
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

      // Wait for content and styles to load, then trigger the print dialog.
      // Do NOT auto-close the tab — the user needs time to confirm "Save as PDF"
      // in the browser's print dialog. Previous behavior closed after 1 second,
      // which killed the dialog before users could save. Now they close the
      // tab manually after saving.
      printWindow.onload = () => {
        setTimeout(() => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch (err) {
            console.error("Print dialog failed:", err);
          }
        }, 500);
      };

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
    <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
      {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
      {exporting ? "Exporting..." : "Export PDF"}
    </Button>
  );
}
