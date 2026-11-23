#!/usr/bin/env node
// The daily production check: is the live API up, current, and answering?
// Runs in the prod-check workflow every morning and on demand:
//
//   node scripts/prod-check.mjs
//
// Checks, all free (no paid provider is called):
//   1. GET /v1/health answers ok, and its build equals BUILD_STAMP on this
//      checkout (main): otherwise the API function was changed on main but not
//      redeployed through Lovable.
//   2. The live GET /v1/openapi.json equals api/openapi.json on main.
//   3. With PROD_CHECK_KEY (a key with read and demo scopes): GET /v1/clients
//      and GET /v1/demo-jobs answer 200, so keyed reads and the demo API work.
//      With PROD_COSTS_KEY (costs scope): GET /v1/costs answers 200.
//   4. If MCP_URL is set: the MCP endpoint answers 401 with its OAuth metadata
//      pointer, as a connector expects.
//
// Exits 1 when any check fails; the workflow's failure notifies the repo.
// The same file in every Moburst tool; the tool-specific part is the env.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.env.API_BASE_URL ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("API_BASE_URL is required, e.g. https://<project>.supabase.co/functions/v1/api");
  process.exit(2);
}
const UA = { "User-Agent": "moburst-prod-check/1.0", Accept: "application/json" };
const results = [];
const check = async (name, fn) => {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note ?? "" });
  } catch (e) {
    results.push({ name, ok: false, note: e instanceof Error ? e.message : String(e) });
  }
};
const get = async (path, key) => {
  const res = await fetch(`${base}${path}`, { headers: key ? { ...UA, Authorization: `Bearer ${key}` } : UA, signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
};
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

const stamp = /BUILD_STAMP = "([^"]+)"/.exec(readFileSync(join(root, "supabase/functions/api/build-stamp.ts"), "utf8"))?.[1];

await check("health answers ok", async () => {
  const r = await get("/v1/health");
  if (r.status !== 200 || r.body?.ok !== true) throw new Error(`answered ${r.status}: ${r.text.slice(0, 200)}`);
  return `${r.body.tool} ${r.body.version}`;
});
await check("live API is the code on main (build stamp)", async () => {
  const r = await get("/v1/health");
  const live = r.body?.build;
  if (!live) throw new Error(`the live API reports no build stamp: it predates the stamp, so it is behind main (main has ${stamp})`);
  if (live !== stamp) throw new Error(`live build ${live}, main ${stamp}: the API function on main is not deployed (ask Lovable to deploy the api function)`);
  return live;
});
await check("live OpenAPI document matches api/openapi.json on main", async () => {
  const r = await get("/v1/openapi.json");
  if (r.status !== 200) throw new Error(`answered ${r.status}`);
  const committed = JSON.parse(readFileSync(join(root, "api/openapi.json"), "utf8"));
  const a = JSON.stringify(sortKeys(r.body));
  const b = JSON.stringify(sortKeys(committed));
  if (a !== b) {
    const livePaths = Object.keys(r.body?.paths ?? {});
    const mainPaths = Object.keys(committed.paths ?? {});
    const missing = mainPaths.filter((p) => !livePaths.includes(p));
    const extra = livePaths.filter((p) => !mainPaths.includes(p));
    throw new Error(`differs${missing.length ? `; not live yet: ${missing.join(", ")}` : ""}${extra.length ? `; live but not on main: ${extra.join(", ")}` : ""}`);
  }
  return `${Object.keys(committed.paths ?? {}).length} paths`;
});
if (process.env.PROD_CHECK_KEY) {
  await check("keyed read answers (GET /v1/clients)", async () => {
    const r = await get("/v1/clients?limit=1", process.env.PROD_CHECK_KEY);
    if (r.status !== 200) throw new Error(`answered ${r.status}: ${r.text.slice(0, 200)}`);
  });
  await check("demo API answers (GET /v1/demo-jobs)", async () => {
    const r = await get("/v1/demo-jobs?limit=1", process.env.PROD_CHECK_KEY);
    if (r.status !== 200) throw new Error(`answered ${r.status}: ${r.text.slice(0, 200)}`);
  });
} else {
  results.push({ name: "keyed read and demo API", ok: true, note: "skipped: PROD_CHECK_KEY not set" });
}
if (process.env.PROD_COSTS_KEY) {
  await check("cost report answers (GET /v1/costs)", async () => {
    const r = await get("/v1/costs?group_by=provider", process.env.PROD_COSTS_KEY);
    if (r.status !== 200) throw new Error(`answered ${r.status}: ${r.text.slice(0, 200)}`);
    const t = r.body?.data?.totals;
    return t ? `$${t.cost_usd} over 30 days, ${t.unattributed_events} unattributed, ${t.unpriced_events} unpriced` : "";
  });
}
if (process.env.MCP_URL) {
  await check("MCP endpoint asks for OAuth", async () => {
    const res = await fetch(process.env.MCP_URL, { method: "POST", headers: { ...UA, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(30_000) });
    const www = res.headers.get("www-authenticate") ?? "";
    if (res.status !== 401 || !/resource_metadata/i.test(www)) throw new Error(`answered ${res.status}, www-authenticate "${www}"`);
  });
}

for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.note ? `  (${r.note})` : ""}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
