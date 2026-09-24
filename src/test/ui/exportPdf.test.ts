import { afterEach, describe, expect, it, vi } from "vitest";
import { exportReportToPdf } from "@/lib/exportPdf";

function captureExport() {
  let html = "";
  const write = vi.fn((value: string) => { html = value; });
  const close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: { write, close } } as unknown as Window);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  return { document: () => new DOMParser().parseFromString(html, "text/html"), close };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("PDF export content preservation", () => {
  it("keeps bullet markers beside prose and chart legend icons at icon size", async () => {
    const capture = captureExport();
    const root = document.createElement('div');
    root.innerHTML = '<ul><li class="flex"><span>•</span><span>Complete recommendation text</span></li></ul><div class="recharts-wrapper"><svg class="recharts-surface"></svg><div class="recharts-legend-wrapper"><span class="recharts-legend-item"><svg class="recharts-surface"></svg>Engagement</span></div></div>';
    await exportReportToPdf({ contentRef: { current: root }, filename: 'legend' });
    const printed = capture.document();
    const style = document.createElement('style'); style.textContent = printed.querySelector('style')!.textContent;
    document.head.append(style);
    const content = document.importNode(printed.querySelector('.pdf-root')!, true); document.body.append(content);
    expect(getComputedStyle(content.querySelector('li')!).flexWrap).toBe('nowrap');
    expect(getComputedStyle(content.querySelector('.recharts-legend-item svg')!).width).toBe('14px');
    expect(getComputedStyle(content.querySelector('.recharts-wrapper > svg')!).width).toBe('100%');
    expect(getComputedStyle(content.querySelector('.recharts-legend-wrapper')!).position).toBe('static');
    expect(content.textContent).toContain('Complete recommendation text');
    style.remove();
  });
  it("includes inactive panels, preserves full prose, and restores the screen DOM", async () => {
    const capture = captureExport();
    const root = document.createElement("div");
    const prose = "Long report paragraph with complete findings. ".repeat(120);
    root.innerHTML = `<div role="tablist"><button role="tab">Overview</button><button role="tab">Details</button></div>
      <div role="tabpanel" data-state="active"><p class="line-clamp-2">${prose}</p><button data-print="hide">Edit source</button></div>
      <div role="tabpanel" data-state="inactive" hidden><p>Previously hidden report detail</p><svg class="recharts-surface"><text>741</text></svg></div>`;
    document.body.append(root);
    const original = root.outerHTML;
    await exportReportToPdf({ contentRef: { current: root }, filename: "fixture", title: "Client <report> & review" });
    const exported = capture.document();
    expect(root.outerHTML).toBe(original);
    expect(document.querySelector("[data-pdf-measure]")).toBeNull();
    expect(document.querySelector("style[data-pdf-measure]")).toBeNull();
    expect(exported.querySelector(".line-clamp-2")?.textContent).toBe(prose);
    expect(exported.querySelectorAll('[role="tabpanel"][data-state="active"]')).toHaveLength(2);
    expect(exported.querySelector('[role="tabpanel"][hidden]')).toBeNull();
    expect(exported.body.textContent).toContain("Previously hidden report detail");
    expect(exported.querySelector("svg text")?.textContent).toBe("741");
    expect(exported.querySelector('[data-print="hide"]')).toBeNull();
    expect(Array.from(exported.querySelectorAll(".pdf-section-header"), el => el.textContent)).toEqual(["Overview", "Details"]);
    expect(exported.querySelector(".pdf-title")?.textContent).toBe("Client <report> & review");
    expect(exported.querySelector("report")).toBeNull();
    expect(capture.close).toHaveBeenCalledOnce();
  });

  it("retains content order, removes decorative media, and distinguishes data grids from prose", async () => {
    const capture = captureExport();
    const root = document.createElement("div");
    root.innerHTML = `<div class="flex flex-col"><article style="order:2">Second in screen order</article><article style="order:1">First in screen order</article></div>
      <div class="aspect-video"><img aria-hidden="true" src="blur.png"><img alt="Original post" src="post.png"></div>
      <div id="metrics" class="grid"><div>Impressions 9,673</div><div>Comments 5</div></div>
      <div id="hours" class="grid" style="grid-template-columns:repeat(24,1fr)">${Array.from({length:24},(_,i)=>`<span>${i}:00</span>`).join("")}</div>
      <div id="prose" class="grid"><article>${"Long findings ".repeat(40)}</article><article>Another finding</article></div>`;
    await exportReportToPdf({ contentRef: { current: root }, filename: "competitive" });
    const exported = capture.document();
    expect(Array.from(exported.querySelectorAll(".flex-col > article"), el => el.textContent)).toEqual(["First in screen order", "Second in screen order"]);
    expect(exported.querySelectorAll("img")).toHaveLength(1);
    expect(exported.querySelector("[data-pdf-media] img")?.getAttribute("alt")).toBe("Original post");
    expect(exported.querySelector("#metrics")?.hasAttribute("data-pdf-compact")).toBe(true);
    expect(exported.querySelector("#hours")?.hasAttribute("data-pdf-data-grid")).toBe(true);
    expect(exported.querySelectorAll("#hours span")).toHaveLength(24);
    expect(exported.querySelector("#prose")?.hasAttribute("data-pdf-compact")).toBe(false);
    expect(root.querySelectorAll("img")).toHaveLength(2);
  });

  it("gives prose and media grids the full width while keeping KPI grids compact", async () => {
    const capture = captureExport();
    const root = document.createElement("div");
    root.innerHTML = `<div id="posts" class="grid" data-pdf-flow><div class="card"><div class="flex" data-pdf-media-row>
        <div class="w-32" data-pdf-media-visual><div class="aspect-video"><img alt="Cover" src="cover.png"></div></div>
        <div><span data-slot="badge" class="whitespace-nowrap">Score: 1,284 Very strong</span><p>Short caption</p></div>
      </div></div><div class="card"><div class="flex" data-pdf-media-row><div class="w-32" data-pdf-media-visual></div><div><p>Another short caption</p></div></div></div></div>
      <div id="kpis" class="grid"><div>Impressions 9,673</div><div>Comments 5</div><div>Shares 2</div></div>`;
    await exportReportToPdf({ contentRef: { current: root }, filename: "trends" });
    const exported = capture.document();
    const posts = exported.querySelector("#posts")!;
    expect(posts.hasAttribute("data-pdf-compact")).toBe(false);
    expect(posts.hasAttribute("data-pdf-data-grid")).toBe(false);
    expect(exported.querySelector("#kpis")?.hasAttribute("data-pdf-compact")).toBe(true);

    const style = exported.querySelector("style")!.cloneNode(true);
    const printed = exported.querySelector(".pdf-root")!.cloneNode(true) as HTMLElement;
    document.body.append(style, printed);
    expect(getComputedStyle(printed.querySelector("#posts")!).display).toBe("block");
    const row = printed.querySelector("[data-pdf-media-row]")!;
    expect(getComputedStyle(row).display).toBe("flex");
    expect(getComputedStyle(row).flexWrap).toBe("nowrap");
    expect(getComputedStyle(printed.querySelector("[data-pdf-media-visual]")!).maxWidth).toBe("34mm");
    const badge = printed.querySelector('[data-slot="badge"]')!;
    expect(getComputedStyle(badge).whiteSpace).toBe("normal");
    expect(getComputedStyle(badge).maxWidth).toBe("100%");
  });

  it("only keeps blocks whole when the gap they would leave is small", async () => {
    const capture = captureExport();
    const root = document.createElement("div");
    root.innerHTML = `<article>Trend card</article>`;
    await exportReportToPdf({ contentRef: { current: root }, filename: "gaps" });
    const script = capture.document().querySelector("script")!.textContent || "";
    expect(script).toContain("const usablePageHeight = 65 * 96 / 25.4;");
    expect(script).not.toContain("130 * 96");
    // Chart cards keep a taller allowance so a plot never splits from its title.
    expect(script).toContain("const fullPageHeight = 240 * 96 / 25.4;");
    expect(script).toContain("el.querySelector('.recharts-surface') ? fullPageHeight : usablePageHeight");
  });


  it("reports a blocked popup without changing the report", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const root = document.createElement("div"); root.textContent = "Saved report";
    await expect(exportReportToPdf({ contentRef: { current: root }, filename: "blocked" })).rejects.toThrow("Pop-up blocked");
    expect(root.textContent).toBe("Saved report");
  });

  it("keeps absolutely positioned post images visible while hiding their overlays", async () => {
    const capture = captureExport();
    const root = document.createElement("div");
    // PostVisual uses absolute positioning for both the real image and overlays.
    root.innerHTML = `<div class="aspect-video">
      <img aria-hidden="true" class="absolute blur-2xl" src="blur.png">
      <img alt="Post creative" class="absolute inset-0 h-full w-full" loading="lazy" src="post.png">
      <span class="absolute">Play overlay</span><button>Open media</button>
    </div>`;
    await exportReportToPdf({ contentRef: { current: root }, filename: "media" });
    const exported = capture.document();
    const style = exported.querySelector("style")!.cloneNode(true);
    const printed = exported.querySelector(".pdf-root")!.cloneNode(true) as HTMLElement;
    document.body.append(style, printed);
    const image = printed.querySelector("img")!;
    expect(getComputedStyle(image).display).not.toBe("none");
    expect(image.getAttribute("loading")).toBe("eager");
    expect(getComputedStyle(printed.querySelector("span")!).display).toBe("none");
    expect(getComputedStyle(printed.querySelector("button")!).display).toBe("none");
    expect(root.querySelector('img[alt="Post creative"]')?.getAttribute("loading")).toBe("lazy");
  });
});
