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
  content.querySelectorAll('details').forEach(el => el.setAttribute('open', ''));
  // Chromium can ignore keep-with-next across a nested grid boundary. Put a
  // company label and its first example in one print-only fragment instead.
  content.querySelectorAll('[data-pdf-company]').forEach(company => {
    const heading = company.firstElementChild;
    const grid = heading?.nextElementSibling;
    const first = grid?.firstElementChild;
    if (!heading || !grid?.classList.contains('grid') || !first) return;
    const fragment = document.createElement('div');
    fragment.setAttribute('data-pdf-keep', '');
    company.insertBefore(fragment, heading);
    fragment.append(heading, first);
  });

  // Screen media frames reserve a tall aspect-ratio box even when their image
  // is reduced for print. Reset the frame too, and omit decorative duplicates.
  content.querySelectorAll('img[aria-hidden="true"]').forEach(el => el.remove());
  // Every page must load its images, including media below the first viewport.
  // This changes only the print clone; the app keeps lazy loading on screen.
  content.querySelectorAll('img').forEach(el => el.setAttribute('loading', 'eager'));
  content.querySelectorAll('[class*="aspect-"]').forEach(el => {
    if (el.querySelector('img, video')) el.setAttribute('data-pdf-media', '');
  });
  // Keep compact metrics side by side; only prose/card grids need one column.
  // A grid the page marks data-pdf-flow is prose or media: it always gets the
  // full reading width, whatever its cards happen to measure. Short trend
  // captions used to look like KPI tiles to the heuristic below, which then
  // squeezed a post card with a 128px thumbnail into a third of the page.
  content.querySelectorAll('.grid').forEach(el => {
    if (el.hasAttribute('data-pdf-flow')) return;
    const children = Array.from(el.children);
    if ((el as HTMLElement).style.gridTemplateColumns && children.every(child => (child.textContent || '').trim().length < 12)) {
      el.setAttribute('data-pdf-data-grid', '');
    } else if (children.length > 1 && children.length <= 12 && !el.querySelector('.grid') && children.every(child =>
      (child.textContent || '').trim().length < 160 && !child.querySelector('img, video, table, .recharts-wrapper, article'))
    ) {
      el.setAttribute('data-pdf-compact', '');
      (el as HTMLElement).style.setProperty('--pdf-columns', String(Math.min(children.length, 3)));
    } else if (children.length > 12 && children.every(child => (child.textContent || '').trim().length < 12)) {
      el.setAttribute('data-pdf-data-grid', '');
    }
  });
  // Competitive sections use CSS order for platform filtering. Once print
  // switches flex columns to block flow, preserve that visible reading order.
  content.querySelectorAll('.flex-col').forEach(el => {
    const children = Array.from(el.children) as HTMLElement[];
    if (children.some(child => child.style.order)) children
      .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0))
      .forEach(child => el.appendChild(child));
  });

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
    .pdf-root .h-full, .pdf-root [data-pdf-unit] { height: auto !important; min-height: 0 !important; }

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
    .pdf-root .recharts-wrapper > svg.recharts-surface {
      width: 100% !important;
      height: auto !important;
    }
    /* Legend symbols are also recharts-surface SVGs, not full charts. */
    .pdf-root .recharts-legend-wrapper {
      position: static !important;
      width: auto !important;
      transform: none !important;
    }
    .pdf-root .recharts-legend-item svg.recharts-surface {
      width: 14px !important;
      height: 14px !important;
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
    .pdf-root [data-pdf-heading] { break-after: avoid !important; page-break-after: avoid !important; }
    .pdf-root summary { list-style: none; }
    .animate-slide-up, .stagger-children > * { animation: none !important; opacity: 1 !important; transform: none !important; }
    /* Paper uses a single reading column. Responsive screen grids and tall
       flex items otherwise become unbreakable fragments in Chromium. */
    .pdf-root { width: 100%; max-width: 190mm; min-height: 0 !important; margin: 0 auto; }
    .pdf-root .grid, .pdf-root .flex-col { display: block !important; }
    .pdf-root .grid[data-pdf-compact] { display: grid !important; grid-template-columns: repeat(var(--pdf-columns), minmax(0, 1fr)) !important; break-inside: avoid; }
    .pdf-root .grid[data-pdf-data-grid] { display: grid !important; break-inside: avoid; }
    .pdf-root .grid[data-pdf-data-grid] { gap: 3px !important; }
    .pdf-root .grid[data-pdf-data-grid] > * { margin: 0 !important; }
    .pdf-root .grid[data-pdf-data-grid] span { white-space: nowrap !important; font-size: 9px !important; overflow-wrap: normal; }
    .pdf-root .grid > *, .pdf-root .flex-col > * { margin-bottom: 12px; }
    .pdf-root .flex { flex-wrap: wrap; }
    .pdf-root li.flex { flex-wrap: nowrap !important; align-items: flex-start; }
    .pdf-root li.flex > :first-child { flex-shrink: 0; }
    .pdf-root li.flex > :last-child { min-width: 0; }
    .pdf-root * { min-width: 0; }
    .pdf-root [class*="min-w-"], .pdf-root table { min-width: 0 !important; max-width: 100% !important; }
    .pdf-root [class*="max-h-"], .pdf-root [role="tabpanel"] { height: auto !important; max-height: none !important; }
    .pdf-root [class*="overflow-"], .pdf-root [data-radix-scroll-area-viewport] { overflow: visible !important; height: auto !important; }
    .pdf-root .whitespace-nowrap { white-space: normal !important; }
    .pdf-root table { table-layout: fixed; break-inside: auto !important; page-break-inside: auto !important; }
    .pdf-root thead { display: table-header-group; }
    .pdf-root tr { break-inside: avoid; }
    .pdf-root th, .pdf-root td { white-space: normal !important; overflow-wrap: anywhere; font-size: 10px; padding: 6px; }
    .pdf-root img { max-width: 100% !important; max-height: 65mm !important; object-fit: contain !important; }
    .pdf-root [data-pdf-media] { aspect-ratio: auto !important; height: auto !important; min-height: 0 !important; max-height: 65mm !important; padding: 0 !important; break-inside: avoid; }
    .pdf-root [data-pdf-media] img, .pdf-root [data-pdf-media] video { position: static !important; display: block; width: auto !important; height: auto !important; max-width: 100% !important; max-height: 65mm !important; margin: 0 auto; object-fit: contain !important; }
    .pdf-root [data-pdf-unit] [data-pdf-media],
    .pdf-root [data-pdf-unit] [data-pdf-media] img,
    .pdf-root [data-pdf-unit] [data-pdf-media] video { max-height: 38mm !important; }
    .pdf-root [data-pdf-media] button, .pdf-root [data-pdf-media] .absolute:not(img):not(video) { display: none !important; }
    .pdf-root .blur-2xl, .pdf-root .backdrop-blur, .pdf-root .backdrop-blur-sm { filter: none !important; backdrop-filter: none !important; }
    .pdf-root .recharts-wrapper { max-height: 95mm !important; }
    .pdf-root p, .pdf-root li { orphans: 3; widows: 3; }
    .pdf-root [data-pdf-splittable] { break-inside: auto !important; page-break-inside: auto !important; height: auto !important; overflow: visible !important; }
    .pdf-root [data-pdf-keep] { break-inside: avoid !important; page-break-inside: avoid !important; }
    /* Prose and media grids read across the whole page, never in KPI columns. */
    .pdf-root .grid[data-pdf-flow] { display: block !important; }
    .pdf-root .grid[data-pdf-flow] > * { margin-bottom: 12px; }
    /* A thumbnail next to its caption keeps the row, but the caption gets the
       rest of the width instead of the leftovers of a squeezed column. */
    .pdf-root [data-pdf-media-row] { display: flex !important; flex-wrap: nowrap !important; align-items: flex-start; gap: 12px; }
    .pdf-root [data-pdf-media-row] > [data-pdf-media-visual] { flex: 0 0 34mm; width: 34mm !important; max-width: 34mm !important; }
    .pdf-root [data-pdf-media-row] > :not([data-pdf-media-visual]) { flex: 1 1 auto; min-width: 0; }
    /* A score badge is one unbreakable token on screen; on paper it may wrap
       onto a second line rather than be cut off at the card edge. */
    .pdf-root [data-slot="badge"], .pdf-root .rounded-full.border {
      max-width: 100% !important;
      white-space: normal !important;
      overflow: visible !important;
      height: auto !important;
    }
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
    window.addEventListener("load", async () => {
      // Wait for layout assets, then classify blocks at the actual print width.
      await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 3000))]);
      await Promise.race([Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 5000))]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Keeping a card whole is only worth a gap the card could have filled.
      // At 130mm a half-page card still got pushed to a fresh page, leaving the
      // gaps seen in the monthly and analytics exports; 65mm keeps the small
      // repeating units together and lets the rest flow.
      const usablePageHeight = 65 * 96 / 25.4;
      // A chart cannot be cut in half: splitting one leaves its title alone on
      // the previous page above an empty plot box. Keep chart cards whole up to
      // a full page of content.
      const fullPageHeight = 240 * 96 / 25.4;
      document.querySelectorAll('.pdf-root article, .pdf-root .glass, .pdf-root .glass-inner, .pdf-root .glass-accent, .pdf-root blockquote, .pdf-root tr').forEach(el => {
        const height = el.getBoundingClientRect().height;
        const limit = el.hasAttribute('data-pdf-unit') || el.querySelector('.recharts-surface') ? fullPageHeight : usablePageHeight;
        el.setAttribute(height > limit ? 'data-pdf-splittable' : 'data-pdf-keep', '');
      });

      try { window.focus(); window.print(); }
      catch (err) { console.error("Print dialog failed:", err); }
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
