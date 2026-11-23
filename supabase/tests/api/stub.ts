// The Socialytics route table with stub dependencies: enough to describe the
// API without a database. The contract test and the docs generator
// (scripts/api-gen.ts) both build the OpenAPI document from it.
import { socialyticsOpenApi, socialyticsRoutes } from "../../functions/api/openapi";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";

export const PUBLIC_SERVER_URL = "https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api";

export function stubRoutes() {
  return socialyticsRoutes({
    store: makeFakeStore(emptyData()), analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({}),
    jobs: { create: async (j) => ({ ...j, id: "x" }), byIdempotency: async () => null, get: async () => null, list: async () => [], update: async (_i, p) => p as never, runningCount: async () => 0 },
    kickWorker: async () => {}, discard: async () => ({ removed: { client: false, competitor_sets: 0, reports: 0, competitive_reports: 0, posts: 0, media_jobs: 0 } }), capacity: 3, stepNames: [],
    keys: { insert: async (k) => ({ ...k, id: "k", created_at: "", last_used_at: null, revoked_at: null, owner_email: null }), list: async () => [], listByOwner: async () => [], countLive: async () => 0, revoke: async () => false, revokeOwned: async () => null },
    verifyStaffSession: async () => null, sessionToken: () => null, now: () => new Date(),
    serverUrl: PUBLIC_SERVER_URL,
  });
}

export function stubOpenApi(): Record<string, unknown> {
  return socialyticsOpenApi(stubRoutes(), PUBLIC_SERVER_URL);
}
