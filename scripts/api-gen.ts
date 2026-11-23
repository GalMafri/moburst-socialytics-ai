/**
 * npm run api:gen: regenerates Socialytics' API files from the route table
 * (api/openapi.json, docs/api/REFERENCE.md, docs/api/CHANGES.md, the release
 * baseline and the build stamp). Run it after any change to a route, a schema
 * or the API function; the api-docs test fails until you do. See CLAUDE.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stubOpenApi } from "../supabase/tests/api/stub";
import { generate, type ApiDocsConfig } from "./api-docs";

export const config: ApiDocsConfig = {
  root: join(dirname(fileURLToPath(import.meta.url)), ".."),
  tool: "socialytics",
  openapi: stubOpenApi,
  sourceDirs: ["supabase/functions/api", "supabase/functions/_shared/api", "supabase/functions/_shared/cost", "supabase/functions/_shared/paid", "supabase/functions/_shared/socialytics-api"],
};

if (process.argv[1]?.endsWith("api-gen.ts")) {
  const gen = generate(config);
  for (const [path, content] of Object.entries(gen.files)) {
    mkdirSync(dirname(join(config.root, path)), { recursive: true });
    writeFileSync(join(config.root, path), content);
  }
  if (gen.blocked.length) {
    console.error("These changes would break API consumers (the portal, demo screens, agents):");
    for (const b of gen.blocked) console.error(`  - ${b}`);
    console.error("Keep the old shape working, or list each line in api/BREAKING.md with the date and what replaces it, then run npm run api:gen again.");
    process.exit(1);
  }
  console.log("API files regenerated: api/openapi.json, docs/api/REFERENCE.md, docs/api/CHANGES.md, build stamp.");
}
