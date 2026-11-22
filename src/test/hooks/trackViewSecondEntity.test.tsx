// QA 22 Nov 2026 (P11): useTrackView.ts:28. `opened` is set once and never reset, so when the same
// mounted page moves to another report (route param change, e.g. reports/:reportId), the
// second report gets no `_opened` and no `_closed`: its reading is never recorded.
import { expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const f = vi.hoisted(() => ({ events: [] as Array<[string, Record<string, unknown>]> }));
vi.mock("@/lib/telemetry", () => ({ track: (name: string, props: Record<string, unknown>) => { f.events.push([name, props]); } }));
import { useTrackView } from "@/hooks/useTrackView";

it("records the open and close of each report the page shows", () => {
  const { rerender, unmount } = renderHook(({ id }) => useTrackView("report", id), { initialProps: { id: "A" } });
  rerender({ id: "B" });
  unmount();
  const seen = f.events.map(([n, p]) => `${n}:${p.entity_id}`);
  expect(seen).toEqual(["report_opened:A", "report_closed:A", "report_opened:B", "report_closed:B"]);
});
