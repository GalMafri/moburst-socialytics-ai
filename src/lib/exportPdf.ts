// Print-based PDF export that preserves the app's dark theme.
//
// Strategy: open a new window, clone the target DOM node, collect the live
// stylesheets, and trigger window.print(). The user saves via Chrome's "Save
// as PDF" option in the print dialog.
//
// Dark-theme hardening (this is what the previous version got wrong):
//   - We do NOT rely on <body> background. Chrome's print pipeline strips
//     body background unless "Background graphics" is explicitly toggled on.
//   - The background is applied to a wrapper <div class="pdf-root"> with
//     -webkit-print-color-adjust: exact on that div AND all its descendants.
//     Inner content backgrounds survive print even when body bg would not.
//   - @page { margin: 0 } removes the browser's default white page margin.
//     The wrapper div adds its own padding to keep the layout.

interface ExportOptions {
  /** The DOM node whose contents should be exported. */
  contentRef: React.RefObject<HTMLElement>;
  /** Filename shown in the save dialog + used for the document title. */
  filename: string;
  /** Optional explicit H1 at the top of the PDF. */
  title?: string;
}

export async function exportReportToPdf({ contentRef, filename, title }: ExportOptions): Promise<void> {
  if (!contentRef.current) throw new Error("No content to export");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Pop-up blocked. Please allow pop-ups for this site and try again.");
  }

  // ── 1. Clone + expand all tab panels ──
  const content = contentRef.current.cloneNode(true) as HTMLElement;

  content.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
    const el = panel as HTMLElement;
    el.style.display = "block";
    el.removeAttribute("hidden");
    el.setAttribute("data-state", "active");
  });

  // Insert a section header before each tab panel so the exported doc has
  // navigable section names matching the tab labels.
  const tabsList = content.querySelector('[role="tablist"]');
  const tabLabels: string[] = [];
  if (tabsList) {
    tabsList.querySelectorAll('[role="tab"]').forEach((tab) => {
      tabLabels.push(tab.textContent?.trim() || "");
    });
  }
  content.querySelectorAll('[role="tabpanel"]').forEach((panel, i) => {
    if (!tabLabels[i]) return;
    const header = document.createElement("h2");
    header.className = "pdf-section-header";
    header.textContent = tabLabels[i];
    panel.parentElement?.insertBefore(header, panel);
  });
  if (tabsList) tabsList.remove();

  // ── 2. Collect stylesheets ──
  let cssText = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      cssText += rules.map((r) => r.cssText).join("\n");
    } catch {
      // Cross-origin stylesheet — try to re-import by URL
      if (sheet.href) cssText += `@import url("${sheet.href}");\n`;
    }
  }

  // ── 3. Build the print document ──
  const printTitle = title ?? filename;
  const html = `<!DOCTYPE html>
<html lang="en" class="dark" style="color-scheme: dark;">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(printTitle)}</title>
  <style>
    ${cssText}

    /* ═══════════════════════════════════════════════════════════════════
       DARK THEME HARDENING — prevents Chrome from rendering a white page
       ═══════════════════════════════════════════════════════════════════ */

    @page {
      size: auto;
      margin: 0;
    }

    :root, html, body {
      color-scheme: dark !important;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #0b0c10 !important;
      color: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* The wrapper div carries the actual visible background. Chrome strips
       body bg during print unless "Background graphics" is checked, but it
       respects print-color-adjust on regular elements. */
    .pdf-root {
      background: #0b0c10 !important;
      color: #ffffff !important;
      padding: 24px 40px !important;
      min-height: 100vh;
      font-family: "Geist", "Inter", system-ui, -apple-system, sans-serif !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .pdf-root * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      border-color: rgba(255, 255, 255, 0.05);
    }

    /* ─── OVERFLOW & SIZING FIXES ───
       The live app uses overflow: hidden and fixed heights for scroll areas
       (report pages, trend grids, etc). In print we want EVERYTHING to flow
       naturally so nothing is clipped. */
    .pdf-root [class*="overflow-"],
    .pdf-root .overflow-hidden,
    .pdf-root .overflow-x-auto,
    .pdf-root .overflow-y-auto,
    .pdf-root .overflow-auto,
    .pdf-root .overflow-scroll {
      overflow: visible !important;
    }
    .pdf-root [class*="max-h-"],
    .pdf-root .max-h-screen,
    .pdf-root .max-h-96 {
      max-height: none !important;
    }
    .pdf-root [class*="h-screen"] { height: auto !important; }

    /* Ensure all text wraps — long URLs/hashtags shouldn't overflow */
    .pdf-root p, .pdf-root span, .pdf-root div,
    .pdf-root td, .pdf-root th, .pdf-root li, .pdf-root a {
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    /* Truncation classes commonly used — disable for print */
    .pdf-root .truncate,
    .pdf-root [class*="line-clamp-"] {
      -webkit-line-clamp: unset !important;
      display: block !important;
      overflow: visible !important;
      text-overflow: clip !important;
      white-space: normal !important;
    }

    /* Design tokens — mirror the live app's Intercept dark theme */
    .pdf-root {
      --background: 228 23% 5%;
      --foreground: 0 0% 100%;
      --card: 0 0% 0%;
      --card-foreground: 0 0% 100%;
      --muted: 222 10% 16%;
      --muted-foreground: 218 11% 65%;
      --border: 220 12% 14%;
      --primary: 72 75% 57%;
      --primary-foreground: 0 0% 0%;
    }

    .pdf-root [data-slot="card"],
    .pdf-root .glass,
    .pdf-root .rounded-lg.border {
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-top-color: rgba(255, 255, 255, 0.14) !important;
      background: rgba(26, 29, 35, 0.85) !important;
      border-radius: 20px !important;
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: 12px;
    }

    /* Additional page-break discipline:
       - Don't break inside rows of a grid (each card is already avoid)
       - Don't break after the first line of a paragraph/heading (orphans)
       - Keep images with their captions */
    .pdf-root img,
    .pdf-root .recharts-wrapper,
    .pdf-root table,
    .pdf-root blockquote,
    .pdf-root pre,
    .pdf-root figure {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .pdf-root p, .pdf-root h1, .pdf-root h2, .pdf-root h3, .pdf-root h4 {
      orphans: 3;
      widows: 3;
    }

    .pdf-root .grid { gap: 12px !important; }
    .pdf-root .space-y-6 > * + * { margin-top: 24px !important; }
    .pdf-root .space-y-8 > * + * { margin-top: 32px !important; }
    .pdf-root .space-y-4 > * + * { margin-top: 16px !important; }
    .pdf-root .space-y-3 > * + * { margin-top: 12px !important; }

    .pdf-root .text-muted-foreground { color: #9ca3af !important; }
    .pdf-root .text-foreground,
    .pdf-root h1, .pdf-root h2, .pdf-root h3, .pdf-root h4 { color: #ffffff !important; }
    .pdf-root .text-destructive { color: rgb(248, 113, 113) !important; }
    .pdf-root .text-success { color: #10b981 !important; }
    .pdf-root .text-warning { color: #f59e0b !important; }

    .pdf-root p, .pdf-root span, .pdf-root div,
    .pdf-root td, .pdf-root th, .pdf-root li { color: inherit; }

    .pdf-root [data-slot="badge"] {
      display: inline-flex !important;
      padding: 2px 8px !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
    }

    .pdf-root table { border-collapse: collapse; width: 100%; }
    .pdf-root th {
      color: #9ca3af !important;
      text-transform: uppercase;
      font-size: 11px !important;
      letter-spacing: 0.05em;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    }
    .pdf-root tr { border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important; }
    .pdf-root td { color: #ffffff !important; }

    .pdf-root .glass-inner,
    .pdf-root [class*="bg-[rgba(255,255,255,"] {
      background: rgba(255, 255, 255, 0.03) !important;
      border: 1px solid rgba(255, 255, 255, 0.06) !important;
      border-radius: 12px !important;
    }

    .pdf-root hr,
    .pdf-root [role="separator"] {
      border-color: rgba(255, 255, 255, 0.06) !important;
      background: rgba(255, 255, 255, 0.06) !important;
    }

    .pdf-root .recharts-wrapper { break-inside: avoid; }
    .pdf-root .recharts-cartesian-axis-tick text { fill: #9ca3af !important; }
    .pdf-root .recharts-cartesian-grid line { stroke: rgba(255, 255, 255, 0.05) !important; }

    .pdf-root [role="tablist"] { display: none !important; }

    .pdf-root h2.pdf-section-header {
      font-size: 1.25rem !important;
      font-weight: 700 !important;
      margin: 32px 0 16px !important;
      padding-bottom: 8px !important;
      border-bottom: 2px solid rgba(255, 255, 255, 0.08) !important;
      color: #ffffff !important;
    }

    .pdf-root h2, .pdf-root h3 { break-after: avoid; }

    .pdf-root .animate-pulse, .pdf-root .animate-slide-up { animation: none !important; }

    .pdf-root .glass,
    .pdf-root .glass-inner,
    .pdf-root .glass-elevated {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    .pdf-root a { color: #b9e045 !important; }

    @media print {
      html, body, .pdf-root {
        background: #0b0c10 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="pdf-root">
    ${content.outerHTML}
  </div>
  <script>
    // Focus + print once everything is in the DOM. Do NOT auto-close — the
    // user needs time to confirm the save dialog.
    window.addEventListener("load", () => {
      setTimeout(() => {
        try {
          window.focus();
          window.print();
        } catch (err) {
          console.error("Print dialog failed:", err);
        }
      }, 500);
    });
  </script>
</body>
</html>`;

  printWindow.document.write(html);
  printWindow.document.close();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
