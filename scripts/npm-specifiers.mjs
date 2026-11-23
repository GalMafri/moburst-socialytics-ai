// Lets Node (tsx) load edge function code that imports npm packages as Deno
// does, `npm:<name>@<exact version>`: each resolves to the package.json
// dependency pinned at that same version, as vitest.config.ts's
// npmSpecifiers plugin does for the tests. A specifier with no matching pin
// fails instead of resolving to whatever happens to be installed.
// Used by `npm run api:gen`, which reads the connector's tool list.
import { register } from "node:module";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const pinned = {};
for (const [alias, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const npm = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
  pinned[npm ? `${npm[1]}@${npm[2]}` : `${alias}@${spec}`] = alias;
}

register("data:text/javascript," + encodeURIComponent(`
const pinned = ${JSON.stringify(pinned)};
export async function resolve(specifier, context, next) {
  const m = /^npm:(@[^/@]+\\/[^/@]+|[^/@]+)@([^/]+)(\\/.*)?$/.exec(specifier);
  if (!m) return next(specifier, context);
  const alias = pinned[m[1] + "@" + m[2]];
  if (!alias) throw new Error(specifier + " has no dependency pinned at " + m[2] + " in package.json");
  return next(alias + (m[3] ?? ""), context);
}
`), import.meta.url);
