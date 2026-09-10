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

/**
 * Lays out the tab panels that are not on screen, so their charts exist
 * before the clone is taken.
 *
 * A Radix panel that is not selected is `display: none`, and a Recharts
 * chart inside one measures 0×0 and renders nothing at all — which is why
 * the Analytics PDF came out with the active tab's charts and blank space
 * where the others should be. Giving the panels a real width and height
 * off-flow (absolutely positioned, invisible) makes them measure. Anything
 * with no size — display:none, height:0, a zero-width wrapper — does not.
 *
 * Returns a function that puts the page back.
 */
async function layOutHiddenPanels(root: HTMLElement): Promise<() => void> {
  const panels = Array.from(root.querySelectorAll('[role="tabpanel"][data-state="inactive"]')) as HTMLElement[];
  if (panels.length === 0) return () => {};
  const style = document.createElement("style");
  style.dataset.pdfMeasure = "true";
  style.textContent = `
    [data-pdf-measure-root] { position: relative !important; }
    [data-pdf-measure] {
      display: block !important;
      position: absolute !important;
      left: 0; top: 0;
      width: 100%;
      visibility: hidden !important;
      pointer-events: none !important;
    }`;
  document.head.appendChild(style);
  const marked: HTMLElement[] = [];
  for (const panel of panels) {
    panel.setAttribute("data-pdf-measure", "");
    marked.push(panel);
    const holder = panel.parentElement;
    if (holder && !holder.hasAttribute("data-pdf-measure-root")) {
      holder.setAttribute("data-pdf-measure-root", "");
      marked.push(holder);
    }
  }
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  await frame();
  await frame();
  // Charts mount asynchronously; wait until their count stops growing, and
  // never longer than a second — a missing chart is better than a hang.
  let previous = -1;
  for (let i = 0; i < 10; i++) {
    const count = root.querySelectorAll(".recharts-surface").length;
    if (count === previous) break;
    previous = count;
    await new Promise((r) => setTimeout(r, 100));
  }
  return () => {
    for (const el of marked) {
      el.removeAttribute("data-pdf-measure");
      el.removeAttribute("data-pdf-measure-root");
    }
    style.remove();
  };
}

export async function exportReportToPdf({ contentRef, filename, title }: ExportOptions): Promise<void> {
  if (!contentRef.current) throw new Error("No content to export");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    throw new Error("Pop-up blocked. Please allow pop-ups for this site and try again.");
  }

  // ── 1. Clone + expand all tab panels ──
  const restorePanels = await layOutHiddenPanels(contentRef.current);
  let content: HTMLElement;
  try {
    content = contentRef.current.cloneNode(true) as HTMLElement;
  } finally {
    restorePanels();
  }
  content.querySelectorAll("[data-pdf-measure], [data-pdf-measure-root]").forEach((el) => {
    el.removeAttribute("data-pdf-measure");
    el.removeAttribute("data-pdf-measure-root");
  });

  // On-screen controls have no meaning on paper: navigation, export, filter
  // chips and feedback toggles all print as dead buttons. Anything the page
  // marks data-print="hide" is dropped from the clone; the surrounding copy
  // (a filter's "showing Instagram only" line, for instance) is kept.
  content.querySelectorAll('[data-print="hide"]').forEach((el) => el.remove());

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

    /* The margin belongs to the page, not the wrapper: .pdf-root's padding
       only lands on the first and last fragment, so pages 2..n used to run
       to the paper edge. */
    @page {
      size: auto;
      margin: 12mm 10mm;
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
      padding: 0 !important;
      min-height: 100vh;
      font-family: "Geist", "Inter", system-ui, -apple-system, sans-serif !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .pdf-root * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    /* The default hairline, minus the accent surfaces: the client's own card
       is told apart from a competitor's by its lime edge, and a blanket
       border-colour here used to erase it. */
    .pdf-root *:not([class*="glass-accent"]) {
      border-color: rgba(255, 255, 255, 0.05);
    }

    /* ─── OVERFLOW & SIZING FIXES ───
       The live app uses overflow: hidden and fixed heights for scroll areas
       (report pages, trend grids, etc). In print we want EVERYTHING to flow
       naturally so nothing is clipped. */
    /* The glass surfaces are the real clipping boxes: .glass sets
       overflow:hidden, which both cuts wide content at the card edge and
       makes a tall card monolithic, so the engine drops its overflow instead
       of paging it. The Tailwind selectors below never matched them, because
       "glass text-card-foreground" contains no "overflow-". */
    .pdf-root .glass,
    .pdf-root .glass-inner,
    .pdf-root .glass-accent,
    .pdf-root .glass-elevated,
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

    /* Soft text wrapping — break long words ONLY when they'd overflow
       (e.g. URLs, hashtags without spaces). Regular prose wraps at word
       boundaries naturally. Previous version used overflow-wrap: anywhere
       + word-break: break-word which was too aggressive and caused
       mid-word breaks in normal text. */
    .pdf-root p, .pdf-root span, .pdf-root div,
    .pdf-root td, .pdf-root th, .pdf-root li {
      overflow-wrap: break-word;
      word-break: normal;
    }
    /* Long URLs / hashtags without spaces — allow breaking anywhere */
    .pdf-root a,
    .pdf-root code,
    .pdf-root [class*="hashtag"] {
      overflow-wrap: anywhere;
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

    .pdf-root .glass:not(.glass-accent),
    .pdf-root .rounded-lg.border:not([class*="glass-accent"]) {
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      border-top-color: rgba(255, 255, 255, 0.14) !important;
      background: rgba(26, 29, 35, 0.85) !important;
      border-radius: 20px !important;
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

    .pdf-root .rounded-full.border,
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

    .pdf-root .pdf-title {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0 0 16px;
      color: #ffffff !important;
    }

    .pdf-root .animate-pulse, .pdf-root .animate-slide-up { animation: none !important; }

    /* A backdrop-filtered box cannot be fragmented, so every glass level
       loses the filter — including the bare accent divs that carry no Card. */
    .pdf-root .glass,
    .pdf-root .glass-inner,
    .pdf-root .glass-accent,
    .pdf-root .glass-elevated {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    /* Recharts writes measured pixels into the DOM (inline width/height on
       the wrapper and width/height attributes on the svg), so a chart
       measured at 1200px on screen lands inside a ~730px page. The svg has a
       viewBox, so width:100% + height:auto rescales it; the wrapper div has
       to be reset too or its inline width still drives the layout. */
    .pdf-root .recharts-responsive-container,
    .pdf-root .recharts-wrapper {
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
    }
    .pdf-root svg.recharts-surface {
      width: 100% !important;
      height: auto !important;
    }

    .pdf-root a { color: #b9e045 !important; }

    /* Sticky chrome has no place on paper: the section nav becomes an ordinary row, and
       nothing may pin itself over the content that follows it. */
    nav[aria-label="Sections"], .sticky { position: static !important; top: auto !important; }
    nav[aria-label="Sections"] { break-inside: avoid; margin-bottom: 16px; }

    /* Keep whole only what can fit on a page. A section or a full report card is
       taller than any sheet, and asking to keep one whole makes the engine push
       it to a fresh page and then split it anyway, wasting the page it left. So
       the repeating units are protected and the containers are free to flow. */
    article, .glass-inner, .glass-accent { break-inside: avoid; page-break-inside: avoid; }
    section, .pdf-root .glass { break-inside: auto; page-break-inside: auto; }
    /* A heading never ends a page on its own. */
    h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
    .animate-slide-up, .stagger-children > * { animation: none !important; opacity: 1 !important; transform: none !important; }
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
    ${title ? `<h1 class="pdf-title">${escapeHtml(title)}</h1>` : ""}
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
