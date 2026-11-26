// @vitest-environment node
// The one reader of "is this client strategy-only" the server and the screens
// share, and the sentences they say. The rule itself is the database's
// (supabase/tests/migrations/strategyOnlyClients.test.ts).
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeCall } from "../../support/dbFake";
import {
  isStrategyOnly, STRATEGY_ONLY_JOB_REASON, STRATEGY_ONLY_OPENS, STRATEGY_ONLY_OPENS_STAFF, STRATEGY_ONLY_SHORT, STRATEGY_ONLY_SHORT_STAFF, strategyOnlyClients, strategyOnlyOpens, strategyOnlyShort, strategyOnlyLead, strategyOnlyRefusal, strategyOnlySentence,
} from "../../../functions/_shared/sprout/strategyOnly";

const answering = (answer: (call: FakeCall) => { data?: unknown; error?: { message: string } | null }) => fakeDb(answer);

describe("isStrategyOnly", () => {
  it("asks the database's one definition for the client, and is true only for a plain yes", async () => {
    for (const [data, expected] of [[true, true], [false, false], [null, false], ["true", false]] as const) {
      const { db, calls } = answering(() => ({ data }));
      expect(await isStrategyOnly(db, "client-1")).toBe(expected);
      expect(calls).toEqual([{ table: "rpc:client_strategy_only", ops: [["rpc", [{ p_client: "client-1" }]]] }]);
    }
  });

  it("throws when the database does not answer, so nothing is decided on a guess", async () => {
    const { db } = answering(() => ({ error: { message: "connection reset" } }));
    await expect(isStrategyOnly(db, "client-1")).rejects.toThrow("Could not read whether the client's social accounts are connected: connection reset");
  });
});

describe("strategyOnlyClients", () => {
  it("reads the ids the viewer can see, as bare ids or as one-column rows", async () => {
    const bare = answering(() => ({ data: ["a", "b"] }));
    expect([...(await strategyOnlyClients(bare.db))].sort()).toEqual(["a", "b"]);
    expect(bare.calls[0].table).toBe("rpc:strategy_only_clients");
    const rows = answering(() => ({ data: [{ strategy_only_clients: "a" }, { strategy_only_clients: "c" }] }));
    expect([...(await strategyOnlyClients(rows.db))].sort()).toEqual(["a", "c"]);
  });

  it("is empty when there are none, and throws when the read fails", async () => {
    expect((await strategyOnlyClients(answering(() => ({ data: [] })).db)).size).toBe(0);
    expect((await strategyOnlyClients(answering(() => ({ data: null })).db)).size).toBe(0);
    await expect(strategyOnlyClients(answering(() => ({ error: { message: "permission denied" } })).db)).rejects.toThrow("permission denied");
  });
});

describe("what is said", () => {
  it("is one calm sentence with the client's name, in two halves a screen can set as heading and line", () => {
    expect(strategyOnlyLead("Harbor Lane")).toBe("Harbor Lane is set up for strategy only");
    expect(STRATEGY_ONLY_OPENS).toBe("Its calendar, designs, analytics and reports open once its social accounts are connected.");
    expect(strategyOnlySentence("Harbor Lane")).toBe("Harbor Lane is set up for strategy only. Its calendar, designs, analytics and reports open once its social accounts are connected.");
    expect(strategyOnlySentence("  ")).toBe("This client is set up for strategy only. Its calendar, designs, analytics and reports open once its social accounts are connected.");
    expect(strategyOnlySentence(null)).toMatch(/^This client is set up/);
  });

  it("has a short form for a card or a row", () => {
    expect(STRATEGY_ONLY_SHORT).toBe("Strategy only until its social accounts are connected.");
  });

  it("names Sprout to staff only: every server answer and a client user's wording leave it out", () => {
    expect(STRATEGY_ONLY_OPENS_STAFF).toBe("Its calendar, designs, analytics and reports open once its social accounts are connected in Sprout.");
    expect(STRATEGY_ONLY_SHORT_STAFF).toBe("Strategy only until its social accounts are connected in Sprout.");
    expect(strategyOnlyOpens(true)).toBe(STRATEGY_ONLY_OPENS_STAFF);
    expect(strategyOnlyShort(true)).toBe(STRATEGY_ONLY_SHORT_STAFF);
    for (const text of [strategyOnlyOpens(false), strategyOnlyShort(false), strategyOnlySentence("Harbor Lane"), STRATEGY_ONLY_OPENS, STRATEGY_ONLY_SHORT]) expect(text).not.toMatch(/Sprout/);
  });

  it("reads as a fact, never as an error, a dash or a developer's word", () => {
    for (const text of [strategyOnlySentence("Harbor Lane"), STRATEGY_ONLY_SHORT, STRATEGY_ONLY_JOB_REASON]) {
      expect(text).not.toMatch(/error|fail|cannot|blocked|sprout_profiles|is_active|flag|[—–]| - /i);
    }
  });
});

describe("strategyOnlyRefusal", () => {
  it("is the sentence with the client's name for a strategy-only client", async () => {
    const { db } = answering((call) => (call.table === "rpc:client_strategy_only" ? { data: true } : { data: { name: "Harbor Lane" } }));
    expect(await strategyOnlyRefusal(db, "client-1")).toBe(strategyOnlySentence("Harbor Lane"));
    expect(await strategyOnlyRefusal(db, "client-1")).not.toMatch(/Sprout/);
  });

  it("is null for any other client, with the client's row never read", async () => {
    const { db, calls } = answering(() => ({ data: false }));
    expect(await strategyOnlyRefusal(db, "client-1")).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(["rpc:client_strategy_only"]);
  });
});
