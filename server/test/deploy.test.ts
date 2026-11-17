// @vitest-environment node
// server/test/deploy.test.ts
//
// Where the picture service runs (16 Nov 2026): it is a Node function of the
// app's own Vercel project, built by the same job that builds the site
// (the "vercel" job of .github/workflows/deploy.yml: vercel build at the
// repository root, then vercel deploy --prebuilt). Nothing here is set by
// hand in a dashboard, so every fact the deploy depends on is in a file,
// and this test reads those files:
//   the function is api/picture.mjs, which re-exports the bundle the root
//     vercel-build script makes from the server workspace;
//   only /api/health and /api/picture/* reach it, and every other path
//     (the /api-keys page among them) is served as before;
//   the client library that also lives in api/ is never deployed;
//   the runner's own npm ci installs sharp's Linux files from the lockfile;
//   Vercel runs the function on Node 22.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const text = (...path: string[]) => readFileSync(join(root, ...path), "utf8");
const json = (...path: string[]) => JSON.parse(text(...path));

const ENTRY = "api/picture.mjs";
const vercel = json("vercel.json") as { framework: string; installCommand: string; buildCommand: string; outputDirectory: string; functions: Record<string, { maxDuration: number }>; rewrites: Array<{ source: string; destination: string }>; headers: unknown[] };
const pkg = json("package.json") as { engines: { node: string }; workspaces: string[]; scripts: Record<string, string> };
const serverPkg = json("server", "package.json") as { name: string; engines: { node: string }; scripts: Record<string, string>; dependencies: Record<string, string> };
const ignored = text(".vercelignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

/** Where Vercel sends a path that matched no file: the first rewrite whose source matches all of it. These sources are plain regular expressions. */
function rewritten(path: string): string | null {
  for (const { source, destination } of vercel.rewrites) if (new RegExp(`^${source}$`).test(path)) return destination;
  return null;
}

describe("the picture service's place in the app's Vercel project", () => {
  it("is one function, api/picture.mjs, with 90 seconds to answer", () => {
    expect(vercel.functions).toEqual({ [ENTRY]: { maxDuration: 90 } });
    expect(existsSync(join(root, ENTRY))).toBe(true);
  });

  it("re-exports the bundle the server workspace builds, and the function's build step makes that bundle", () => {
    const code = text(ENTRY).split("\n").filter((l) => l.trim() && !l.startsWith("//"));
    expect(code).toEqual(['export { default } from "../server/dist/app.mjs";']);
    expect(serverPkg.scripts.build).toContain("--outfile=dist/app.mjs");
    // sharp stays outside the bundle, so Vercel ships the native files the runner installed.
    expect(serverPkg.scripts.build).toContain("--external:sharp");
    expect(pkg.workspaces).toEqual(["server"]);
    expect(serverPkg.name).toBe("socialytics-server");
    // Vercel's Node.js builder runs the vercel-build script of the package.json nearest the function before it packs it.
    expect(pkg.scripts["vercel-build"]).toBe("npm run build --workspace server");
  });

  it("gets only /api/health and /api/picture/*, and every other path is served as before", () => {
    expect(rewritten("/api/health")).toBe("/api/picture");
    for (const route of ["canvas", "locate", "read", "finish", "transcode", "title-read", "logo-set", "post-logos", "slot", "slot-file"]) expect(rewritten(`/api/picture/${route}`)).toBe("/api/picture");
    // The app's own pages, the API keys page among them, and anything else under /api.
    for (const page of ["/", "/api-keys", "/api-keys/new", "/api", "/api/healthz", "/api/health/x", "/api/keys", "/calendar", "/clients/abc/strategy"]) expect(rewritten(page), page).toBe("/index.html");
    // Hashed assets are files or nothing: a missing one is never answered with the page.
    expect(rewritten("/assets/index-abc123.js")).toBeNull();
    // The page fallback is the last rule, exactly as it was.
    expect(vercel.rewrites.at(-1)).toEqual({ source: "/((?!assets/).*)", destination: "/index.html" });
    expect(vercel.rewrites).toHaveLength(3);
  });

  it("leaves the site's own build as it was", () => {
    expect(vercel.framework).toBe("vite");
    expect(vercel.installCommand).toBe("npm ci --no-audit --no-fund");
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.outputDirectory).toBe("dist");
    // deploy.sh passes --outDir to this script, so it stays the one Vite command.
    expect(pkg.scripts.build).toBe("vite build");
    expect(vercel.headers).toEqual([
      { source: "/index.html", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ]);
  });

  it("never deploys the client library that shares the api folder: everything in api/ but the function is ignored", () => {
    const others = readdirSync(join(root, "api")).filter((name) => name !== "picture.mjs" && !name.startsWith(".")).sort();
    expect(others.length).toBeGreaterThan(0);
    expect(ignored.filter((l) => l.startsWith("/api")).sort()).toEqual(others.map((name) => `/api/${name}`));
    // The function's own source is part of this project now.
    expect(ignored).not.toContain("/server");
  });

  it("runs on Node 22: the engines of the package.json nearest the function decide, over the project's setting", () => {
    expect(pkg.engines.node).toBe("22.x");
    expect(serverPkg.engines.node).toBe("22.x");
    expect(serverPkg.scripts.build).toContain("--target=node22");
  });

  it("gets sharp's Linux files from the runner's own install: the root lockfile holds them at the pinned version", () => {
    const lock = json("package-lock.json") as { packages: Record<string, { version?: string; os?: string[]; cpu?: string[]; link?: boolean; resolved?: string }> };
    const version = serverPkg.dependencies.sharp;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.packages["node_modules/sharp"]?.version).toBe(version);
    expect(lock.packages["node_modules/@img/sharp-linux-x64"]).toMatchObject({ version, os: ["linux"], cpu: ["x64"] });
    expect(lock.packages["node_modules/@img/sharp-libvips-linux-x64"]).toMatchObject({ os: ["linux"], cpu: ["x64"] });
    // One lockfile: the workspace is installed by the root npm ci, the only install the jobs run.
    expect(lock.packages["node_modules/socialytics-server"]).toEqual({ resolved: "server", link: true });
    expect(existsSync(join(root, "server", "package-lock.json"))).toBe(false);
  });

  it("holds no setting of its own: no environment variable is read, and nothing is left of the separate project", () => {
    const sources = readdirSync(join(root, "server", "src"), { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.filter((f) => /process\.env|Deno\.env/.test(text("server", "src", f)))).toEqual([]);
    for (const gone of ["server/vercel.json", "server/api", "server/public", "server/src/auth.ts"]) expect(existsSync(join(root, gone)), gone).toBe(false);
  });

  it("is type-checked and tested by the build job's own steps, which install nothing but the root", () => {
    // npx tsc -b --force reads the root tsconfig's references; npx vitest run reads the root config's include.
    expect((json("tsconfig.json") as { references: Array<{ path: string }> }).references.map((r) => r.path)).toContain("./server");
    expect(text("vitest.config.ts")).toContain('"server/**/*.{test,spec}.ts"');
  });

  it("is deployed by the app's own job: the workflow has no job for a second project", () => {
    const workflow = text(".github", "workflows", "deploy.yml");
    const jobs = [...workflow.slice(workflow.indexOf("\njobs:")).matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]);
    expect(jobs).toEqual(["build", "vercel", "deploy"]);
    expect(workflow).toContain("VERCEL_PROJECT: moburst-socialytics");
    expect(workflow).not.toContain("--cwd");
    expect(workflow).toContain('build --prod --token "$VERCEL_TOKEN"');
    expect(workflow).toContain('deploy --prebuilt --prod --token "$VERCEL_TOKEN"');
  });
});
