// api/picture.mjs
//
// The picture service's Vercel function (16 Nov 2026), in the app's own
// Vercel project. Vercel makes a function of a file in api/, so this entry is
// committed here; it only re-exports the app. Before Vercel packs the
// function, its Node.js builder runs the root package.json's vercel-build
// script, which bundles server/src/index.ts into server/dist/app.mjs, and
// then traces this file's imports, so the bundle and sharp's native files
// (from the runner's own npm ci) ship inside the one function. vercel.json
// rewrites /api/health and /api/picture/* here, and the Hono app routes by
// the original path. Everything else in api/ is a client library that
// .vercelignore keeps out of the deploy.

export { default } from "../server/dist/app.mjs";
