// @vitest-environment node
// Every error the gos-auth-bridge answers with is one code from the fixed list
// (_shared/auth/session.ts), never a sentence, a role value or a database
// message (QA 12 Nov 2026, ACCESS-API-COPY-4).
import { describe, expect, it } from "vitest";
import { AUTH_ERROR_CODES } from "../../functions/_shared/auth/session.ts";
import { errorValues } from "../_shared/auth/errorCodes.ts";

describe("gos-auth-bridge errors", () => {
  it("answers only with codes from the fixed list", () => {
    const values = errorValues("gos-auth-bridge");
    expect(values.length).toBeGreaterThan(3);
    for (const v of values) {
      if (v.kind === "literal") expect(AUTH_ERROR_CODES as readonly string[]).toContain(v.text.slice(1, -1));
      else expect(v.text).toMatch(/^(result\.error|portalStatusCode\(.*\))$/);
    }
  });
});
