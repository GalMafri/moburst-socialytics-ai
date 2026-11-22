// P14-01 (Suspected; models the browser): window.open("", "_blank") foregrounds the new tab, the
// opener tab is hidden, and requestAnimationFrame does not run in a hidden tab. exportReportToPdf
// awaits two rAF frames AFTER opening the window whenever the page has an inactive tab panel.
import { it, expect, vi, afterEach } from "vitest";
import { exportReportToPdf } from "@/lib/exportPdf";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("export finishes writing the print window while the opener tab is in the background", async () => {
  let hidden = false;
  const write = vi.fn();
  vi.spyOn(window, "open").mockImplementation(() => { hidden = true; return { document: { write, close: vi.fn() } } as unknown as Window; });
  // Browser model: frames are delivered only while the tab is visible.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { if (!hidden) setTimeout(() => cb(0), 0); return 1; });
  const root = document.createElement("div");
  root.innerHTML = `<div role="tablist"><button role="tab">A</button><button role="tab">B</button></div>
    <div role="tabpanel" data-state="active">A</div><div role="tabpanel" data-state="inactive" hidden></div>`;
  document.body.append(root);
  const settled = await Promise.race([exportReportToPdf({ contentRef: { current: root }, filename: "r" }).then(() => "done"), new Promise((r) => setTimeout(() => r("still waiting"), 1500))]);
  expect(settled).toBe("done");
  expect(write).toHaveBeenCalledOnce();
});
