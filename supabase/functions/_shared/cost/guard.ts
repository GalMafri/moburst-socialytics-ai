/**
 * The cost guardrails, as pure checks over source files. Each repo's
 * cost-guard test reads its own files and fails on any problem these return.
 *
 *   providerHostsOutside   a provider address written outside the chokepoint
 *   unclassifiedSecrets    a secret read anywhere that is neither a paid
 *                          provider's key nor listed as not paid, with a reason
 *   paidKeysOutside        a paid provider's key read outside the chokepoint
 *   unpricedModels         a model id in code with no price in pricing.ts
 *   unexplainedNullClients a call that says clientId: null for a feature
 *                          that is not on the shared list
 *   unlistedApifyActors    an Apify actor the code runs that is not on the
 *                          app's actor list (owned or shared, see apify.ts)
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { actorListed, normActor, type ApifyActors } from "./apify.ts";
import { findPrice, type PriceRow } from "./price.ts";
import { PROVIDERS, type ProviderId } from "./registry.ts";

export interface SourceFile {
  /** Repo-relative path with forward slashes. */
  path: string;
  text: string;
}

export interface GuardConfig {
  /** Path prefixes that make up the chokepoint (the shared cost folder and the app's paid/ wiring). */
  chokepoint: string[];
  /** Secrets that are not paid providers' keys, each with the reason. */
  notPaidSecrets: Record<string, string>;
  /** Features allowed to have no client (they serve every client). */
  sharedFeatures: ReadonlySet<string>;
  /** Path prefixes of QA and smoke scripts, whose spend is dev/QA by design. */
  qaPaths: string[];
}

const inside = (path: string, prefixes: string[]) => prefixes.some((p) => path.startsWith(p));
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const isCommentLine = (text: string, index: number) => {
  const start = text.lastIndexOf("\n", index) + 1;
  const line = text.slice(start, index).trimStart();
  return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*");
};
/** A line that names a provider without calling it (a URL check) says so with this marker, so a reviewer sees why. */
const markedNotACall = (text: string, index: number) => {
  const end = text.indexOf("\n", index);
  const start = text.lastIndexOf("\n", index) + 1;
  return /cost-guard: not a call/.test(text.slice(start, end < 0 ? undefined : end));
};

export function providerHostsOutside(files: SourceFile[], cfg: GuardConfig): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (inside(f.path, cfg.chokepoint)) continue;
    for (const p of Object.values(PROVIDERS)) {
      for (const host of p.hosts) {
        const re = new RegExp(`[/."'\`]${host.replace(/\./g, "\\.")}`, "g");
        for (const m of f.text.matchAll(re)) {
          if (isCommentLine(f.text, m.index ?? 0) || markedNotACall(f.text, m.index ?? 0)) continue;
          out.push(`${f.path}:${lineOf(f.text, m.index ?? 0)} calls ${p.label} (${host}) directly. Use meter.fetch(ctx, "${p.id}", ...) from _shared/paid.`);
        }
      }
    }
  }
  return out;
}

/** Secret names a file reads: Deno.env.get("X"), env("X"), getEnv("X"), and app_settings keys. */
export function secretReads(text: string): Array<{ name: string; index: number }> {
  const out: Array<{ name: string; index: number }> = [];
  const patterns = [
    /Deno\.env\.get\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g,
    /\b(?:getEnv|env|readEnv|requireEnv|secret)\(\s*["'`]([A-Z][A-Z0-9_]+)["'`]\s*\)/g,
    /(?<!Deno\.)\benv\??\.get\(\s*["'`]([A-Z][A-Z0-9_]+)["'`]\s*\)/g,
    /\.eq\(\s*["'`]key["'`]\s*,\s*["'`]([a-z0-9_]+)["'`]\s*\)/g,
    /for\s*\(\s*const\s+\w+\s+of\s+\[([^\]]*_api_key[^\]]*)\]/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      // A loop over a list of setting names ("gemini_api_key", "google_ai_api_key") reads each of them.
      const names = /["'`]/.test(m[1]) ? [...m[1].matchAll(/["'`]([A-Za-z0-9_]+)["'`]/g)].map((x) => x[1]) : [m[1]];
      for (const name of names) out.push({ name, index: m.index ?? 0 });
    }
  }
  return out;
}

const SECRETISH = /(KEY|TOKEN|SECRET|PASSWORD|_api_key|_token|_secret)$/i;
const PAID_KEYS: Map<string, ProviderId> = new Map(Object.values(PROVIDERS).flatMap((p) => p.keyNames.map((k) => [k, p.id] as [string, ProviderId])));

export function unclassifiedSecrets(files: SourceFile[], cfg: GuardConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    for (const { name, index } of secretReads(f.text)) {
      if (!SECRETISH.test(name) || PAID_KEYS.has(name) || name in cfg.notPaidSecrets || seen.has(name)) continue;
      seen.add(name);
      out.push(`${f.path}:${lineOf(f.text, index)} reads ${name}, which is neither a paid provider's key (cost/registry.ts) nor listed as not paid (paid/config.ts NOT_PAID_SECRETS).`);
    }
  }
  return out;
}

export function paidKeysOutside(files: SourceFile[], cfg: GuardConfig): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (inside(f.path, cfg.chokepoint)) continue;
    for (const { name, index } of secretReads(f.text)) {
      const p = PAID_KEYS.get(name);
      if (p) out.push(`${f.path}:${lineOf(f.text, index)} reads ${name} (${PROVIDERS[p].label}). Paid keys are read only in _shared/paid; call meter.fetch instead.`);
    }
  }
  return out;
}

/** Model ids as string literals: claude-*, gpt-*, gemini-*, text-embedding-*, whisper-*, plus "google/…" gateway ids. */
export function modelIds(text: string): Array<{ provider: ProviderId; id: string; index: number }> {
  const out: Array<{ provider: ProviderId; id: string; index: number }> = [];
  const re = /["'`]((?:google\/|models\/)?(?:claude-[a-z0-9.-]+|gpt-[a-z0-9.-]+|gemini-[a-z0-9.-]+|text-embedding-[a-z0-9-]+|whisper-[0-9]+))["'`]/g;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    let provider: ProviderId = raw.startsWith("claude-") ? "anthropic" : raw.startsWith("google/") ? "lovable_ai" : raw.includes("gemini-") ? "gemini" : "openai";
    const id = raw.replace(/^models\//, "");
    if (provider === "openai" && /^gpt-/.test(id) === false && !/^(text-embedding|whisper)/.test(id)) provider = "openai";
    out.push({ provider, id, index: m.index ?? 0 });
  }
  return out;
}

export function unpricedModels(files: SourceFile[], prices: readonly PriceRow[], at: Date, ignore: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (/\.test\.tsx?$|__fixtures__|\/fixtures\//.test(f.path)) continue;
    for (const { provider, id, index } of modelIds(f.text)) {
      const key = `${provider}:${id}`;
      if (seen.has(key) || ignore.has(id)) continue;
      seen.add(key);
      // A Lovable gateway id is priced under lovable_ai; a Gemini id reached directly under gemini.
      if (!findPrice(prices, provider, id, at)) out.push(`${f.path}:${lineOf(f.text, index)} uses ${id}, which has no price in cost/pricing.ts for ${PROVIDERS[provider].label}.`);
    }
  }
  return out;
}

export function unexplainedNullClients(files: SourceFile[], cfg: GuardConfig): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (inside(f.path, cfg.chokepoint) || inside(f.path, cfg.qaPaths) || /\.test\.tsx?$/.test(f.path)) continue;
    for (const m of f.text.matchAll(/clientId:\s*null\b/g)) {
      const at = m.index ?? 0;
      // The object literal the clientId: null sits in: from the last "{" before it to the next "}" after it.
      const open = f.text.lastIndexOf("{", at);
      const close = f.text.indexOf("}", at);
      const literal = f.text.slice(open < 0 ? Math.max(0, at - 300) : open, close < 0 ? at + 300 : close);
      const feature = /feature:\s*["'`]([a-z0-9_.]+)["'`]/.exec(literal)?.[1];
      const shared = feature && (cfg.sharedFeatures.has(feature) || [...cfg.sharedFeatures].some((s) => s.endsWith(".*") && feature.startsWith(s.slice(0, -1))));
      if (!shared) out.push(`${f.path}:${lineOf(f.text, at)} records a cost with clientId: null for "${feature ?? "?"}", which is not on SHARED_FEATURES. Pass the client, or add the feature to SHARED_FEATURES if it truly serves every client.`);
    }
  }
  return out;
}

/**
 * Apify actors named in code: a literal in an actor or task path
 * (/acts/user~name/runs) and a string constant whose name says ACTOR
 * (const META_ACTOR = "JJghSZmShuco4j9gJ").
 */
export function apifyActorRefs(text: string): Array<{ ref: string; index: number }> {
  const out: Array<{ ref: string; index: number }> = [];
  for (const m of text.matchAll(/\/(?:acts|actor-tasks)\/([A-Za-z0-9_.-]+(?:[~][A-Za-z0-9_.-]+)?)(?=[/?"'`])/g)) out.push({ ref: m[1], index: m.index ?? 0 });
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]*ACTOR[A-Z0-9_]*\s*(?::\s*string\s*)?=\s*["'`]([A-Za-z0-9_.-]+(?:[~/][A-Za-z0-9_.-]+)?)["'`]/g)) out.push({ ref: m[1], index: m.index ?? 0 });
  // An actor described as an object, { id: "<17-char id or owner~name>", name: "owner/name" }, in either order (Socialytics' actor tables).
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const body = m[0];
    const id = body.match(/\bid\s*:\s*["'`]([A-Za-z0-9]{17}|[A-Za-z0-9_-]+~[A-Za-z0-9_.-]+)["'`]/);
    const name = body.match(/\bname\s*:\s*["'`]([A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+)["'`]/);
    if (id && name) out.push({ ref: name[1], index: (m.index ?? 0) + (name.index ?? 0) });
  }
  return out;
}

export function unlistedApifyActors(files: SourceFile[], actors: ApifyActors): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    // The actor lists themselves (paid/config.ts) are not code that runs an actor.
    if (/\.test\.tsx?$|__fixtures__|\/fixtures\/|\.fake\.ts$|_shared\/paid\/config\.ts$/.test(f.path)) continue;
    for (const { ref, index } of apifyActorRefs(f.text)) {
      if (isCommentLine(f.text, index) || actorListed(actors, ref) || seen.has(normActor(ref))) continue;
      seen.add(normActor(ref));
      out.push(`${f.path}:${lineOf(f.text, index)} runs the Apify actor ${ref}, which is not on APIFY_ACTORS (paid/config.ts). Add it to owned if only this app runs it, or to shared if another Moburst tool on the Apify account may run it too.`);
    }
  }
  return out;
}
