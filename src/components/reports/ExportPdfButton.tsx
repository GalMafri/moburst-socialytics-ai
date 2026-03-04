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

      // ── Capture ALL tab content before cloning ──
      // Radix UI Tabs unmount inactive tab panels from the DOM entirely,
      // so we programmatically click each tab, wait for render, and
      // capture the panel HTML. Then restore the original active tab.
      const tabsList = contentRef.current.querySelector('[role="tablist"]');
      const tabs = tabsList ? (Array.from(tabsList.querySelectorAll('[role="tab"]')) as HTMLElement[]) : [];
      const originalActiveTab = tabs.find((t) => t.getAttribute("data-state") === "active");

      const capturedPanels: { label: string; html: string }[] = [];

      for (const tab of tabs) {
        tab.click();
        await new Promise((r) => setTimeout(r, 200)); // wait for Radix render
        const panel = contentRef.current.querySelector('[role="tabpanel"][data-state="active"]');
        if (panel) {
          capturedPanels.push({
            label: tab.textContent?.trim() || "",
            html: panel.innerHTML,
          });
        }
      }

      // Restore original tab
      if (originalActiveTab) {
        originalActiveTab.click();
        await new Promise((r) => setTimeout(r, 50));
      }

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

      // ── Clone and clean content ──
      const content = contentRef.current.cloneNode(true) as HTMLElement;

      // Remove interactive buttons
      content.querySelectorAll("button").forEach((btn) => {
        const text = btn.textContent?.toLowerCase() || "";
        if (text.includes("export") || text.includes("copy") || text.includes("pending")) {
          btn.remove();
        }
      });

      // Remove dropdown menus and icon-only buttons
      content.querySelectorAll('[data-slot="dropdown-menu"]').forEach((el) => el.remove());
      content.querySelectorAll("button").forEach((btn) => {
        if (btn.querySelector("svg") && !btn.textContent?.trim()) {
          btn.remove();
        }
      });

      // Remove the presentation placeholder banner
      content.querySelectorAll(".border-dashed").forEach((card) => card.remove());

      // ── Replace tab section with all captured panels ──
      if (capturedPanels.length > 0) {
        const clonedTabsList = content.querySelector('[role="tablist"]');
        const clonedPanels = content.querySelectorAll('[role="tabpanel"]');
        const panelParent = clonedPanels[0]?.parentElement;

        // Remove the cloned tablist and any single active panel
        if (clonedTabsList) clonedTabsList.remove();
        clonedPanels.forEach((p) => p.remove());

        // Insert ALL captured panels stacked vertically with section headers
        if (panelParent) {
          for (const panel of capturedPanels) {
            const section = document.createElement("div");
            section.className = "pdf-tab-section";
            section.innerHTML = `
              <h2 style="font-size:1.25rem;font-weight:700;margin:32px 0 16px;padding-bottom:8px;border-bottom:2px solid hsl(0 0% 89.8%);">
                ${panel.label}
              </h2>
              <div>${panel.html}</div>
            `;
            panelParent.appendChild(section);
          }
        }
      }

      // ── Build print document ──
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
