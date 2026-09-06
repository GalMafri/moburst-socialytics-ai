import { describe, expect, it } from "vitest";
import { rejectedParam } from "../../supabase/functions/_shared/anthropic";

describe("rejectedParam", () => {
  it("reads the parameter out of the error that broke competitor identification", () => {
    // The verbatim body from the 400 on 2026-09-06.
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"temperature is deprecated for this model."},"request_id":"req_011Cend7sSnQj1BsfV14SpY"}';
    expect(rejectedParam(body)).toBe("temperature");
  });

  it("reads the other phrasings the API uses", () => {
    expect(rejectedParam("Unsupported parameter: top_p")).toBe("top_p");
    expect(rejectedParam("top_k: Extra inputs are not permitted")).toBe("top_k");
    expect(rejectedParam("stop_sequences is no longer supported")).toBe("stop_sequences");
    expect(rejectedParam("unexpected keyword argument 'metadata'")).toBe("metadata");
  });

  it("never offers to drop something the request needs", () => {
    // A retry without these would fail in a way that hides the real problem.
    expect(rejectedParam("messages is not supported")).toBeNull();
    expect(rejectedParam("Unsupported parameter: model")).toBeNull();
    expect(rejectedParam("max_tokens: Extra inputs are not permitted")).toBeNull();
  });

  it("says nothing about errors that name no parameter", () => {
    expect(rejectedParam("Overloaded")).toBeNull();
    expect(rejectedParam("credit balance is too low")).toBeNull();
    expect(rejectedParam("Your API key is invalid")).toBeNull();
  });
});

describe("foldPrefill", () => {
  it("turns a trailing assistant turn into an instruction on the user turn", async () => {
    const { foldPrefill } = await import("../../supabase/functions/_shared/anthropic");
    const out = foldPrefill([
      { role: "user", content: "Identify competitors." },
      { role: "assistant", content: '{"competitors":[' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
    expect(out[0].content).toBe('Identify competitors.\n\nBegin your reply with exactly: {"competitors":[');
  });

  it("leaves a conversation that already ends with the user alone", async () => {
    const { foldPrefill } = await import("../../supabase/functions/_shared/anthropic");
    const messages = [{ role: "user", content: "Hello" }];
    expect(foldPrefill(messages)).toBe(messages);
  });

  it("drops a trailing assistant turn it cannot fold", async () => {
    const { foldPrefill } = await import("../../supabase/functions/_shared/anthropic");
    const out = foldPrefill([
      { role: "assistant", content: "earlier" },
      { role: "assistant", content: "{" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("earlier");
  });
});
