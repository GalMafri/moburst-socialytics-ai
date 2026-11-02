import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync } from "fs";
import { applyPublicEnvDefaults } from "./public-env";

// Tests import the Supabase client, which throws at module load without a URL.
// .env is untracked and optional, so the same public defaults the build uses
// have to apply here too — otherwise a clean checkout passes the build and
// fails the tests.
applyPublicEnvDefaults();

// Edge functions import npm packages as Deno does, `npm:<name>@<exact
// version>`. In tests each one resolves to the devDependency pinned at that
// same version (an alias such as "zod-v4": "npm:zod@4.6.7" when the app
// itself uses another major), so the tests run the code that ships. A
// specifier with no matching pin fails the run instead of resolving to
// whatever happens to be installed.
function npmSpecifiers(): Plugin {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
  const pinned = new Map<string, string>();
  for (const [alias, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }) as Array<[string, string]>) {
    const npm = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
    pinned.set(npm ? `${npm[1]}@${npm[2]}` : `${alias}@${spec}`, alias);
  }
  return {
    name: "npm-specifiers",
    enforce: "pre",
    async resolveId(source, importer) {
      const m = /^npm:(@[^/@]+\/[^/@]+|[^/@]+)@([^/]+)(\/.*)?$/.exec(source);
      if (!m) return null;
      const alias = pinned.get(`${m[1]}@${m[2]}`);
      if (!alias) throw new Error(`${source} has no devDependency pinned at ${m[2]} in package.json`);
      return this.resolve(`${alias}${m[3] ?? ""}`, importer, { skipSelf: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), npmSpecifiers()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.{ts,tsx}",
      "api/**/*.{test,spec}.{ts,tsx}",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
