/**
 * The cost guardrails for this repo. When one fails, the message says which
 * file and line, and what to do. See CLAUDE.md, "Paid calls and cost tracking".
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { paidKeysOutside, providerHostsOutside, unclassifiedSecrets, unexplainedNullClients, unpricedModels, type GuardConfig, type SourceFile } from "../../functions/_shared/cost/guard";
import { PRICES } from "../../functions/_shared/cost/pricing";
import { CHOKEPOINT, NOT_MODELS, NOT_PAID_SECRETS, QA_PATHS, SHARED_FEATURES } from "../../functions/_shared/paid/config";

const ROOT = join(__dirname, "../../..");
const SCAN = ["supabase/functions", "api", "scripts", "server/src", "src"];
const SKIP = /node_modules|\/dist\/|\.test\.tsx?$|\.spec\.tsx?$|__fixtures__|\/fixtures\/|\.fake\.ts$/;

function files(): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(ROOT, full).split("\\").join("/");
      if (SKIP.test(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) out.push({ path: rel, text: readFileSync(full, "utf8") });
    }
  };
  for (const d of SCAN) {
    try {
      walk(join(ROOT, d));
    } catch {
      /* a folder this repo does not have */
    }
  }
  return out;
}

const cfg: GuardConfig = { chokepoint: CHOKEPOINT, notPaidSecrets: NOT_PAID_SECRETS, sharedFeatures: SHARED_FEATURES, qaPaths: QA_PATHS };
const all = files();
const server = all.filter((f) => !f.path.startsWith("src/"));

describe("cost guardrails", () => {
  it("scans the code", () => {
    expect(server.length).toBeGreaterThan(50);
  });

  it("no paid provider is called outside the paying desk (_shared/paid)", () => {
    expect(providerHostsOutside(all, cfg)).toEqual([]);
  });

  it("every secret the code reads is either a paid provider's key or listed as not paid", () => {
    expect(unclassifiedSecrets(server, cfg)).toEqual([]);
  });

  it("paid providers' keys are read only by the paying desk", () => {
    expect(paidKeysOutside(server, cfg)).toEqual([]);
  });

  it("every AI model in the code has a price", () => {
    expect(unpricedModels(server, PRICES, new Date(), NOT_MODELS)).toEqual([]);
  });

  it("a cost is recorded without a client only for shared features", () => {
    expect(unexplainedNullClients(server, cfg)).toEqual([]);
  });
});
