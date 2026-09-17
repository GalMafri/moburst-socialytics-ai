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

  it("reports a blocked popup without changing the report", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const root = document.createElement("div"); root.textContent = "Saved report";
    await expect(exportReportToPdf({ contentRef: { current: root }, filename: "blocked" })).rejects.toThrow("Pop-up blocked");
    expect(root.textContent).toBe("Saved report");
  });
});
