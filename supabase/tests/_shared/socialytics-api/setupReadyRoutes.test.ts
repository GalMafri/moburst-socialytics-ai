// QA 22 Nov 2026 (P48-01): a client whose only report schedule is turned off. /v1/clients/:id/setup
// says "schedule_missing" (not ready); /v1/clients/:id says the same client is ready.
import { describe, it, expect } from "vitest";
import { CLIENT, COMPETITOR, COMPETITOR_SET, DESIGN_SETTINGS, HANDLE, SCHEDULE, SPROUT_PROFILE } from "./fixtures";
import { readRoutes } from "../../../functions/_shared/socialytics-api/routes-read";
import { makeFakeStore, emptyData } from "./store.fake";
import { scopeAll } from "../../../functions/_shared/api/keys";

describe("P48-01 client readiness", () => {
  it("one client reads the same readiness from /v1/clients/:id and /v1/clients/:id/setup", async () => {
    const store = makeFakeStore(emptyData({
      clients: [CLIENT], sproutProfiles: [SPROUT_PROFILE], sets: [COMPETITOR_SET], competitors: [COMPETITOR], handles: [HANDLE],
      designSettings: [DESIGN_SETTINGS], schedules: [{ ...SCHEDULE, is_active: false }],
    }));
    const routes = readRoutes({ store, analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({}) });
    const run = (path: string) => routes.find((r) => r.path === path)!.handler({ params: { id: CLIENT.id }, query: new URLSearchParams(), auth: { clients: scopeAll() } } as never);
    const setup = ((await run("/v1/clients/:id/setup")) as { body: { data: { ready: boolean } } }).body.data;
    const detail = ((await run("/v1/clients/:id")) as { body: { data: { setup: { ready: boolean } } } }).body.data;
    expect(setup.ready).toBe(false); // schedule_missing: the only schedule is off
    expect(detail.setup.ready).toBe(setup.ready);
  });
});
