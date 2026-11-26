import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../support/lifecycleFakeDb";
import { AuthzError } from "../../functions/_shared/auth/authz";
import { closedForStrategyOnly, STARTING_ACTIONS } from "../../functions/design-request/closed";
import { designWaitingLine } from "../../functions/_shared/design/setup";

// A strategy-only client (no active account in Sprout) gets no designs and no
// videos: each action that starts one answers as a setup that waits for the
// client's social accounts, which the screens already say.

const world = (strategyOnly: boolean) => fakeDb({ clients: [{ id: "c1", name: "Harbor Lane" }] }, { client_strategy_only: () => strategyOnly });
const deps = (db: ReturnType<typeof world>, requireMember = vi.fn(async () => "person-1")) => ({ db, requireMember });

describe("design-request for a strategy-only client", () => {
  it("names the actions that start a design or a video", () => {
    expect([...STARTING_ACTIONS].sort()).toEqual(["create", "footage", "story", "week_preview", "week_start"]);
  });

  it.each([...STARTING_ACTIONS])("answers %s as not set up, waiting for the client's social accounts", async (action) => {
    const d = deps(world(true));
    const answer = await closedForStrategyOnly(d, { action, client_id: "c1" });
    expect(answer).toEqual({ body: { code: "not_set_up", waiting_for: "social_accounts", client_name: "Harbor Lane" } });
    expect(d.requireMember).toHaveBeenCalledWith("c1");
    // The line the screens show for that answer.
    expect(designWaitingLine("social_accounts", "Harbor Lane")).toBe("Designs start once Harbor Lane's social accounts are connected.");
  });

  it.each([...STARTING_ACTIONS])("lets %s go on for a client with an account in Sprout, with its own checks", async (action) => {
    const d = deps(world(false));
    expect(await closedForStrategyOnly(d, { action, client_id: "c1" })).toBeNull();
    // One small read, and the membership check stays the action's own.
    expect(d.db.rpcCalls).toEqual([{ name: "client_strategy_only", args: { p_client: "c1" } }]);
    expect(d.requireMember).not.toHaveBeenCalled();
  });

  it("says nothing about the client to a caller who cannot work on it", async () => {
    const refuse = vi.fn(async () => { throw new AuthzError(403, "You do not have access to this client."); });
    await expect(closedForStrategyOnly(deps(world(true), refuse), { action: "create", client_id: "c1" })).rejects.toMatchObject({ status: 403 });
  });

  it.each(["cancel", "feedback", "use", "undo_note", "shot_brief", "replan", "close_filming", "week_stop", "week_continue", "video_references"])(
    "leaves %s alone: it stops, uses or reads what exists", async (action) => {
      const d = deps(world(true));
      expect(await closedForStrategyOnly(d, { action, client_id: "c1" })).toBeNull();
      expect(d.db.rpcCalls).toEqual([]);
    });

  it("leaves a request without a client to the action's own answer", async () => {
    const d = deps(world(true));
    expect(await closedForStrategyOnly(d, { action: "create" })).toBeNull();
    expect(await closedForStrategyOnly(d, null)).toBeNull();
    expect(d.db.rpcCalls).toEqual([]);
  });
});
