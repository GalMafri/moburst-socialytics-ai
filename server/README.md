# socialytics-server

The picture service (spec: docs/superpowers/specs/2026-11-11-picture-service-design.md). A Node 22 Hono app that runs as one function of the app's own Vercel project, `moburst-socialytics`, and is built and deployed with the site by the `vercel` job of `.github/workflows/deploy.yml`.

## Layout

- `server/` is an npm workspace of the repository (`workspaces` in the root `package.json`). The root `npm ci` installs it from the root `package-lock.json`, sharp's native files for the machine it runs on included, so the CI runner gets the Linux ones.
- `src/` is the app. `src/index.ts` builds it and exports `{ fetch }`. The app imports the product's own picture arithmetic from `../supabase/functions/_shared` and the public database address and anon key from `../public-env.ts`, which is why it is bundled.
- `npm run build --workspace server` bundles `src/index.ts` with esbuild into `dist/app.mjs` (gitignored), with sharp left external.
- `api/picture.mjs` at the repository root is the one Vercel function. It is committed and only re-exports `server/dist/app.mjs`, so Vercel finds the function in the source. The rest of `api/` is a client library, kept out of the deploy by `.vercelignore`.
- The function's build step is the `vercel-build` script of the root `package.json` (`npm run build --workspace server`), the custom build step Vercel documents for a Node.js function (Advanced Node.js usage, "Custom build step"). Vercel's Node.js builder runs it, then traces the entry and ships the bundle with sharp's native files. The site's own build is the project's build command (`npm run build`) and does not change.
- The root `vercel.json` gives the function `maxDuration` 90 and rewrites `/api/health` and `/api/picture/*` to it, ahead of the page fallback. Hono routes by the original path. Every other path, the `/api-keys` page among them, is served as before.
- The root `engines.node` is `22.x`, so Vercel runs the function on Node 22 whatever the project's Node.js setting says (package.json engines override it).

## How a call is checked

There is no shared secret. A worker opens a call in the database before each attempt (`open_picture_call`, service role only) and sends its id in the `x-socialytics-call` header. The service claims that id (`claim_picture_call`) through the project's public REST endpoint with the public anon key before it reads the request (`src/call.ts`). A claim is true once and only within 120 seconds, so an id cannot be used again. No id or a malformed one answers 401 without a database call, an id the database does not claim answers 401, and a database that does not answer gives 503, which the worker waits out. `GET /api/health` is open and says only the service's name. The service reads no environment variable.

A claimed call still cannot send the service anywhere: every link in a request must be in the product's own storage (`PRODUCT_STORAGE` in `src/storage.ts`, from `../public-env.ts`), no redirect is followed, and one call's reads and writes share a 45 second limit. A link anywhere else answers 400 before anything is fetched. A well-formed id the database did not claim leaves one log line, without the id.

## Checks

```
npm ci
npm run typecheck --workspace server
npm run build --workspace server
npx vitest run server
```

To check the deploy layout without a token, write `.vercel/project.json` at the repository root (gitignored) with the project and team ids and the project's settings, then run `npx --yes vercel@63.1.2 build --prod`. The output lands in `.vercel/output`: the function is `functions/api/picture.func`, and `config.json` holds the routes.
