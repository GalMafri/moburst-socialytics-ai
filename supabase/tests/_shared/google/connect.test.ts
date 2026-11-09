// @vitest-environment node
// Connecting Google once from Settings: the state proves Google's redirect,
// the refresh token goes only to Vault (through google_token_save), only
// ai@moburst.com is kept, and the status never carries a token.
import { describe, expect, it } from "vitest";
import { finishSignIn, googleStatus, PENDING_TTL_MS, startSignIn } from "../../../functions/_shared/google/connect";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const config = { clientId: "cid", clientSecret: "GOCSPX-secret-value" };
const NOW = new Date("2026-11-03T10:00:00.000Z");
const idToken = (email: string) => `h.${btoa(JSON.stringify({ aud: "cid", email, email_verified: true })).replace(/=+$/, "")}.s`;
const google = (body: Record<string, unknown>) => async () => new Response(JSON.stringify(body), { status: 200 });

async function started() {
  const db = fakeDb({}, { google_token_save: () => null });
  const link = new URL(await startSignIn(db, config, "https://x.supabase.co/functions/v1/google-auth", NOW));
  return { db, state: link.searchParams.get("state")! };
}

describe("connecting Google", () => {
  it("keeps the refresh token only in Vault, and says who is connected", async () => {
    const { db, state } = await started();
    const at = new Date(NOW.getTime() + 60_000);
    const outcome = await finishSignIn(db, config, { code: "c", state, error: null, redirectUri: "r" }, at, google({ access_token: "ya29.x", refresh_token: "1//refresh-token-value", id_token: idToken("ai@moburst.com") }));
    expect(outcome).toBe("connected");
    expect(db.rpcCalls).toEqual([{ name: "google_token_save", args: { p_token: "1//refresh-token-value" } }]);
    expect(JSON.stringify(db.tables)).not.toContain("1//refresh-token-value");
    expect(JSON.stringify(db.tables)).not.toContain("ya29.x");
    const status = await googleStatus(db, config);
    expect(status).toEqual({ ready: true, connected: true, account_email: "ai@moburst.com", connected_at: at.toISOString() });
    expect(JSON.stringify(status)).not.toMatch(/token|ya29|1\/\//);
  });

  it("keeps nothing from another account, a wrong or old state, or a refusal", async () => {
    const a = await started();
    expect(await finishSignIn(a.db, config, { code: "c", state: a.state, error: null, redirectUri: "r" }, NOW, google({ access_token: "x", refresh_token: "1//r", id_token: idToken("lital@moburst.com") }))).toBe("wrong_account");
    expect(a.db.rpcCalls).toEqual([]);
    const b = await started();
    expect(await finishSignIn(b.db, config, { code: "c", state: "forged", error: null, redirectUri: "r" }, NOW)).toBe("bad_state");
    const c = await started();
    expect(await finishSignIn(c.db, config, { code: "c", state: c.state, error: null, redirectUri: "r" }, new Date(NOW.getTime() + PENDING_TTL_MS + 1))).toBe("expired");
    const d = await started();
    expect(await finishSignIn(d.db, config, { code: null, state: d.state, error: "access_denied", redirectUri: "r" }, NOW)).toBe("refused");
    // The state is spent: the same redirect again is refused.
    const e = await started();
    await finishSignIn(e.db, config, { code: "c", state: e.state, error: null, redirectUri: "r" }, NOW, google({ access_token: "x" }));
    expect(await finishSignIn(e.db, config, { code: "c", state: e.state, error: null, redirectUri: "r" }, NOW)).toBe("bad_state");
  });

  it("is not connected before the setup steps, whatever the table holds", async () => {
    const db = fakeDb({ google_connection: [{ id: true, account_email: "ai@moburst.com", connected_at: "2026-11-01T00:00:00Z" }] });
    expect(await googleStatus(db, null)).toEqual({ ready: false, connected: false, account_email: null, connected_at: null });
    expect(await googleStatus(fakeDb({}), config)).toEqual({ ready: true, connected: false, account_email: null, connected_at: null });
  });
});
