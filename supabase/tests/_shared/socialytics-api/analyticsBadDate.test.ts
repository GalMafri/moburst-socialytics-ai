// QA 22 Nov 2026 (P48-03): /v1/clients/:id/analytics?end=2026-13-01 (passes the yyyy-mm-dd shape, not a real day)
// with no start: the route throws a RangeError (answered as a 500) instead of a 400 "invalid".
import { describe, it, expect } from "vitest";
import { CLIENT } from "../../../functions/_shared/socialytics-api/fixtures";
import { readRoutes } from "../../../functions/_shared/socialytics-api/routes-read";
import { makeFakeStore, emptyData } from "../../../functions/_shared/socialytics-api/store.fake";
import { scopeAll } from "../../../functions/_shared/api/keys";
import { ApiError } from "../../../functions/_shared/api/errors";

describe("P48-03 analytics window", () => {
  it("an impossible end date is refused as invalid input (400)", async () => {
    const routes = readRoutes({ store: makeFakeStore(emptyData({ clients: [CLIENT] })), analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({}) });
    const route = routes.find((r) => r.path === "/v1/clients/:id/analytics")!;
    const err = await Promise.resolve(route.handler({ params: { id: CLIENT.id }, query: new URLSearchParams("end=2026-13-01"), auth: { clients: scopeAll() } } as never)).then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});
