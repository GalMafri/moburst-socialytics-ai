# Picture Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every bitmap operation of the design and video workers out of the Supabase edge functions into a picture service on Vercel (the first slice of the Socialytics server there), and make a person's design request run to its end whatever the post's date.

**Architecture:** A Node 22 Hono app in `server/`, bundled by esbuild into one Vercel function, decodes and encodes with sharp and runs the product's own pixel arithmetic: `resampleRGBA` and `findLogo` imported from `supabase/functions/_shared`, plus byte-exact ports of the two imagescript operations the workers use (alpha overlay and nearest-neighbor resize). The edge workers keep the queue, leases, model calls, records and request settlement; each former decode becomes one HTTPS call that hands the service signed storage URLs for its inputs and outputs, authenticated by a shared secret. One rule at request creation keeps a person's video out of the filming wait when the post's time has passed, so no person-started request is ever closed by a date.

**Tech Stack:** Node 22, TypeScript, Hono 4.13.18, sharp 0.35.5, zod 4.6.7, esbuild (current release, pinned), Vitest 3.2.4 (the repository's root config), tsx; Vercel CLI 63.1.2 in GitHub Actions (the existing job pattern); Deno edge functions on Supabase (Lovable Cloud); imagescript 1.3.0 from npm as the test oracle only.

**As released (16 Nov 2026):** two things in this plan were replaced at release, and the spec's section "As released 16 Nov 2026" is the current word on both. The service is a function of the app's own Vercel project (`api/picture.mjs` at the repository root, built by the existing `vercel` job); the project of its own and its second job were dropped. There is no `PICTURE_SERVICE_SECRET`: a call is opened in the database by the worker and claimed once by the service. Every step below that sets, reads or tests the secret, `server/vercel.json`, `server/api/` or the `vercel-server` job describes the plan as it stood on 12 Nov and no longer matches what runs.

**As built (final review, 12 Nov 2026):** three things below were replaced after this plan was written, and the spec is the current word on each. The Vercel function is a committed entry, `server/api/index.mjs`, that re-exports the build's bundle `server/dist/app.mjs`, with every `/api/*` path rewritten to it (spec, Scope; `server/README.md`); the `api/[...path].mjs` layout in Tasks 1 and 9 does not build on Vercel. An unavailable picture service is a wait that spends no try (spec, section 2), where the constraints below say the job spends one. The service's address is the production domain the project holds, `https://socialytics-server.vercel.app` (spec, Scope), where Tasks 1 and 9 name `socialytics-server-moburst-ai.vercel.app`.

**Spec:** docs/superpowers/specs/2026-11-11-picture-service-design.md (approved by Lital 12 Nov 2026; the corrections found while planning are in its "As found while planning" notes, committed with this plan).

## Global Constraints

- Prose in code comments, log lines and error messages: no em dashes, American English, the product's words. No vendor, library or developer text reaches a client screen; the workers' error texts stay internal (cards show "No design yet", as the 19 Oct rule says).
- No flags, no per-client switches, no "set the URL first" step. `PICTURE_SERVICE_URL` is a constant in the contract. Replaced at release (16 Nov 2026): there is no configuration and no secret; a call is checked through the database (the spec's "As released 16 Nov 2026"). As planned on 12 Nov, the only configuration was a shared secret, `PICTURE_SERVICE_SECRET`, in the function secrets and in the Vercel project.
- The secret is never printed, logged, committed or put in an error message. Tests assert redaction.
- Pixel bar: every PNG the service writes (generation canvas, mask, delivered final, verify's logo-area crop) and every decode is identical to today's, pixel for pixel. JPEG outputs (marks and verify reads, the Story band, the opening frame, kit stills, the title read-back) keep today's dimensions and quality settings; they feed models only, and two JPEG encoders never agree byte for byte.
- After this plan the edge workers import no image library: the `imagescript` import leaves `supabase/functions/design-worker/index.ts` and `supabase/functions/_shared/video/steps.ts`, and no `Image.` call remains on the live paths.
- Every service call is bounded: `PICTURE_CALL_TIMEOUT_MS = 60_000`, one retry after `PICTURE_RETRY_AFTER_MS = 2_000` on a transient failure (network error, timeout, 429, 5xx), then the step fails with the service's reason and the job spends a try as any other failure does.
- Edge functions import only their own folder and `_shared` (`supabase/tests/_shared/packaging.test.ts` enforces it). `server/` imports Deno-free modules from `supabase/functions/_shared` by relative path; nothing under `supabase/functions` imports `server/`.
- Tests live outside deployed folders: `supabase/tests/<same path as the code>` for edge code; `server/test/` for the server. Server test files start with `// @vitest-environment node`.
- Every new file starts with a header comment: its path, what it does and why, with a date where a decision needs one.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work happens on branch `trends` in `/Users/user/Documents/AI Workflows/Dashboard/moburst-socialytics-trends`; nothing is pushed or deployed before Task 10.
- Checks before every commit: `npx vitest run <the files the task touched>`; before the final tasks the whole suite `npx vitest run --maxWorkers=4` (345 files, 3,496 tests today, plus the new ones), `deno check --no-lock supabase/functions/design-worker/index.ts supabase/functions/video-worker/index.ts supabase/functions/design-request/index.ts`, `npm run typecheck --prefix server`, `npm run build --prefix server`.

## Decisions made while planning (rulings against the spec, with the reason)

1. Folder `server/`, not `services/picture`: the spec's Scope section names `server/` and the server is the home later slices move into.
2. Deploy path: the repository already deploys to the Vercel team `moburst-ai` from GitHub Actions with the `VERCEL_TOKEN` secret (job `vercel` in `.github/workflows/deploy.yml`); the service ships through a second job of the same shape. No Git app is linked to GalMafri's repository and none is needed. Preview deployments per branch are not part of this slice (CI runs on `main` only); the spec's preview line is dropped.
3. Timeout 60 s, not 120 s: an edge request has a 150 s wall limit and the design worker's step loop runs up to 50 s before a step starts, so a 120 s call could outlive its request. A Story finish takes seconds.
4. Replaced at release (16 Nov 2026, the note at the top): there is no secret. As planned on 12 Nov: the secret lives in the function environment (`PICTURE_SERVICE_SECRET`, read with `Deno.env.get`, the way `SOCIALYTICS_N8N_SECRET` is) and in the Vercel project's environment. No edge function reads Vault today, and SQL never calls the service, so Vault holds no copy.
5. The video routes are `title-read` and `transcode`: the title layer is drawn by the image model and stored as is; the only bitmap work is the read-back (alpha box, grey ground, half-size JPEG). The frame and kit steps only re-encode a model PNG as a JPEG. The kit's source-still size comes from the JPEG header, with no service call.
6. The generation canvas and mask are built by the service (`canvas` route): the `generate` step decodes the logo and builds both today, contrary to the spec's section 2 wording.
7. Lifecycle: the 11 Nov gap is at request creation. `create` and `planNow` park a video in the filming wait without reading the post's time; the 10-minute filming sweep then closes it `post_passed`. The week path already checks first. The rule becomes: a person's video for a post whose time has passed, or is less than a day away, is made from the client's posts. `closeFilming` (genuine footage waits) and `classifyPost` (the week button) stay as they are; settlement and the sweep already apply no date rule.
8. Replay reference set: the 32 designs finished since 2 Nov 2026 (7 on 2 Nov, 24 on 3 Nov, 1 on 11 Nov; all 4:5 pages; finish arithmetic unchanged since d90214c). No Story has ever finished, so the Story bar is a synthetic 2160x3840 test plus the acceptance run.
9. The `locate` proof is decode equivalence: the service runs the very `findLogo` module the worker runs today, so identical decoded pixels give identical answers by construction. The replay prints the service's rectangle beside the stored one for information; stored rectangles from before 7b8397b came from the earlier search and may differ.
10. Canvas, mask and title read-back have no stored references (they were never written to storage), so they are proved against imagescript 1.3.0 from npm, run in the tests as the oracle.
11. A secret-gated `picture_check` action on design-worker runs N finishes against the deployed service at once and reports durations. It is the load test of the spec's section 4 and stays as an operations check; the controller triggers it through SQL with the Vault copy of the operational secret, so nobody handles the service secret by hand.
12. Signed URL lifetimes: 600 s for reads; upload URLs keep Supabase's own validity. Logs: Vercel's request logs plus one JSON line per call.
13. CI moves to Node 22 for both jobs (`engines` says `>=20`; the frontend build runs the same on 22).

## Review Focus

Five inputs the spec implies but names no test for, most likely first, each pinned to a task's test:

1. The service is down, slow or refuses the call (wrong secret after a rotation): the step must fail with a readable reason after one retry and the request must still end within its bounds, never hang. Task 6 `client.test.ts` ("retries once...", "does not retry a refusal...", "never puts the secret in a message").
2. A logo rectangle partly outside the picture (the model drew the logo at the edge, or a placement pushes it off the page): finish and the mask clip instead of throwing or writing out of bounds. Task 4 `ops.test.ts` ("clips a logo rectangle that leaves the picture...", "clips a logo the placement pushes past the page edge...").
3. The input URL serves no picture (a deleted object, an HTML error page, a 60 MB file): the service answers `{ ok: false, reason }` in the product's words and never crashes the function. Task 5 `routes.test.ts` ("answers with a reason when the picture is missing...", "...when the bytes are not a picture", "...when the picture is larger than 64 MB").
4. A title layer with no visible pixels (the model returned a blank transparent PNG): `title-read` answers a null box and the worker throws "The title came back empty." as today. Task 4 ("gives no box and no read-back for an empty layer"), Task 7 `hook.test.ts` ("hookBoxOf throws the empty-title error").
5. PNG files of other color types (a palette or grayscale logo a client uploads, a 16-bit export): decoding gives the same RGBA as imagescript did, or the difference is known. Task 3 `raster.test.ts` ("decodes RGBA, RGB, palette and gray PNGs to the pixels imagescript gives", "decodes a 16-bit PNG to within one step of imagescript").

---

## File structure

New and changed files, with each one's responsibility:

```
server/
  package.json                 socialytics-server: hono, sharp, zod; esbuild, typescript, @types/node, tsx, imagescript (test oracle)
  package-lock.json
  tsconfig.json                ES2022, bundler resolution, strict, noEmit, allowImportingTsExtensions, types node
  vercel.json                  framework null, build "npm run build", output "public", functions api/*.mjs maxDuration 90
  public/index.html            one line, so the deploy has a static output
  src/index.ts                 Vercel entry: export default { fetch } of createApp with the env secret
  src/app.ts                   createApp(deps): Hono with /api/health, the secret gate, the picture routes, JSON 404
  src/auth.ts                  constant-time secret check (shared with Deno's secretEquals when it is runtime-neutral)
  src/log.ts                   one JSON line per call
  src/storage.ts               fetchBytes (signed GET, size cap), putBytes (signed PUT, x-upsert)
  src/picture/raster.ts        Raster type; decode/encode with sharp; fill, crop, overlay, resizeNearest, alphaBox (imagescript ports)
  src/picture/canvas.ts        generationCanvas: canvas + mask + rect (today's generateDesign arithmetic)
  src/picture/locate.ts        locateLogo: canvasLogoRect + findLogo on decoded rasters
  src/picture/read.ts          readPictures: page-size JPEG raster, Story band crop, logo-area crop
  src/picture/finish.ts        finishPicture: scaled rectangle, logo resample, in-place blend, output resample
  src/picture/title.ts         titleRead: alpha box, grey ground, overlay, half-size nearest
  src/picture/schemas.ts       zod schemas for the six request bodies
  src/picture/routes.ts        the six POST routes: fetch inputs, run the op, put outputs, answer
  scripts/replay.ts            the proof: stored designs through finishPicture, pixel comparison, decode equivalence
  test/app.test.ts, raster.test.ts, ops.test.ts, routes.test.ts, storage.test.ts
supabase/functions/_shared/picture/
  contract.ts                  routes, request/result types, URL and limits, JPEG qualities, title constants (no imports)
  headers.ts                   pngSize (moved from canva/jobs.ts), jpegSize
  geometry.ts                  scaledRect, logoAreaRect (verify's margin arithmetic)
  client.ts                    callPicture, PictureError, signedRead, signedWrite (Deno side)
supabase/functions/_shared/canva/jobs.ts          re-exports pngSize from picture/headers.ts
supabase/functions/_shared/video/hook.ts          hookBoxOf(result)
supabase/functions/_shared/design/requestRules.ts canFilm(postAt, now)
supabase/functions/design-request/postTime.ts     postTimeOf(admin, clientId, postKey)
supabase/functions/design-request/index.ts        create and planNow use canFilm
supabase/functions/design-worker/index.ts         generate, locate, marks, finish, verify call the service; picture_check action
supabase/functions/_shared/video/steps.ts         title_check, frame and kit call the service; jpegSize for the kit source
supabase/tests/_shared/picture/{headers,contract,geometry,client}.test.ts
supabase/tests/_shared/video/hook.test.ts, supabase/tests/_shared/design/requestRules.test.ts (added cases)
supabase/tests/design-request/postTime.test.ts
vitest.config.ts               include "server/**/*.{test,spec}.ts"
eslint.config.js               server/** gets Node globals
.gitignore                     server/api/ (the built bundle)
.vercelignore                  /server (the frontend project never uploads it)
.github/workflows/deploy.yml   Node 22; server install, typecheck and build in the build job; job vercel-server
```

---

### Task 1: The contract and the header parsers

**Files:**
- Create: `supabase/functions/_shared/picture/contract.ts`
- Create: `supabase/functions/_shared/picture/headers.ts`
- Modify: `supabase/functions/_shared/canva/jobs.ts:49-54` (move `pngSize` out, re-export it)
- Test: `supabase/tests/_shared/picture/contract.test.ts`, `supabase/tests/_shared/picture/headers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (contract.ts, no imports, Deno-free):

```ts
export const PICTURE_SERVICE_URL = "https://socialytics-server-moburst-ai.vercel.app";
export const PICTURE_API_BASE = "/api/picture";
export const PICTURE_SECRET_HEADER = "x-socialytics-secret";
export const PICTURE_CALL_TIMEOUT_MS = 60_000;
export const PICTURE_RETRY_AFTER_MS = 2_000;
export const PICTURE_MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const READ_JPEG_QUALITY = 92;
export const FRAME_JPEG_QUALITY = 92;
export const KIT_JPEG_QUALITY = 90;
export const TITLE_GROUND: [number, number, number] = [70, 70, 76];
export const TITLE_ALPHA_MIN = 16;
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Rgb = [number, number, number];
export type Placement = { anchor: "left" | "center" | "right"; width: number; top: number; left?: number };
/** Every request names its job and step, for the service's log line. */
export type PictureMeta = { job: string; step: string };
export type CanvasRequest = PictureMeta & { logo: string; page: Size; placement: Placement; background: Rgb; out: { canvas: string; mask: string } };
export type CanvasResult = { rect: Rect; canvas: Size; mask: Size };
export type LocateRequest = PictureMeta & { design: string; logo: string; placement: Placement; background: Rgb; scales: [number, number] };
export type LocateResult = { x: number; y: number; width: number; height: number; score: number; usual: Rect; frame: [number, number] };
export type ReadRequest = PictureMeta & { picture: string; page: Size; band?: Rect; area?: Rect; out: { page: string; band?: string; area?: string } };
export type ReadResult = { picture: Size; page: Size; band?: Size; area?: Size };
export type FinishRequest = PictureMeta & { picture: string; logo: string; rect: Rect; frame: [number, number]; output: Size; out: string };
export type FinishResult = { picture: Size; output: Size; bytes: number };
export type TranscodeRequest = PictureMeta & { picture: string; quality: number; out: string };
export type TranscodeResult = { size: Size; bytes: number };
export type TitleReadRequest = PictureMeta & { layer: string; out: string };
export type TitleReadResult = { layer: Size; box: Rect | null; read: Size | null };
export type PictureRoute = "canvas" | "locate" | "read" | "finish" | "transcode" | "title-read";
export const PICTURE_ROUTES: readonly PictureRoute[] = ["canvas", "locate", "read", "finish", "transcode", "title-read"];
export type PictureRequests = { canvas: CanvasRequest; locate: LocateRequest; read: ReadRequest; finish: FinishRequest; transcode: TranscodeRequest; "title-read": TitleReadRequest };
export type PictureResults = { canvas: CanvasResult; locate: LocateResult; read: ReadResult; finish: FinishResult; transcode: TranscodeResult; "title-read": TitleReadResult };
export type PictureAnswer<R extends PictureRoute> = { ok: true; result: PictureResults[R]; ms: number } | { ok: false; reason: string };
```

  URL strings in requests are signed storage URLs (`logo`, `design`, `picture`, `layer` are GET URLs; every `out` entry is a signed upload URL). `rect` in `FinishRequest` is in `frame` pixels, as `state.logo_rect` and `state.logo_frame` are stored today. `area` and `band` in `ReadRequest` are in the pixels of `picture` and of `page` respectively.

- Produces (headers.ts, no imports): `export function pngSize(bytes: Uint8Array, source = "The logo"): [number, number]` (moved verbatim from jobs.ts) and `export function jpegSize(bytes: Uint8Array, source = "The still"): [number, number]` (walks the JPEG markers from offset 2; at a start-of-frame marker `0xC0..0xCF` other than `0xC4`, `0xC8`, `0xCC` it returns `[width, height]` from the big-endian 16-bit fields at segment offsets 7 and 5; a file that is not a JPEG or has no frame throws `${source} must be a JPEG file.`).

- [ ] **Step 1: Write the failing tests**

`supabase/tests/_shared/picture/contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PICTURE_API_BASE, PICTURE_CALL_TIMEOUT_MS, PICTURE_ROUTES, PICTURE_SECRET_HEADER, PICTURE_SERVICE_URL, TITLE_ALPHA_MIN, TITLE_GROUND } from "../../../functions/_shared/picture/contract";

describe("the picture service contract", () => {
  it("names the service's production address and route base, with no environment to set", () => {
    expect(PICTURE_SERVICE_URL).toBe("https://socialytics-server-moburst-ai.vercel.app");
    expect(PICTURE_API_BASE).toBe("/api/picture");
    expect(PICTURE_ROUTES).toEqual(["canvas", "locate", "read", "finish", "transcode", "title-read"]);
  });
  it("bounds every call well inside an edge request's wall time and keeps the product's header name", () => {
    expect(PICTURE_CALL_TIMEOUT_MS).toBe(60_000);
    expect(PICTURE_SECRET_HEADER).toBe("x-socialytics-secret");
  });
  it("keeps the title read-back's ground and threshold as the worker had them", () => {
    expect(TITLE_GROUND).toEqual([70, 70, 76]);
    expect(TITLE_ALPHA_MIN).toBe(16);
  });
});
```

`supabase/tests/_shared/picture/headers.test.ts`: build a minimal JPEG in the test: `[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, ...14 bytes of APP0..., 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x03, 0xC0, 0x02, 0x1C, ...]` (SOF0 with height 960 = `0x03C0`, width 540 = `0x021C`); build a PNG header with `pngSize`'s layout (signature, IHDR length, "IHDR", width 2160, height 2160).

```ts
describe("jpegSize", () => {
  it("reads the frame size from a baseline JPEG's start-of-frame segment", () => { expect(jpegSize(jpeg540x960)).toEqual([540, 960]); });
  it("skips application segments of any length before the frame", () => { /* APP1 of length 300 before SOF2 (0xC2) with width 1088, height 1936 */ });
  it("refuses bytes that are not a JPEG, naming the file", () => { expect(() => jpegSize(new Uint8Array([1, 2, 3]), "The frame")).toThrow("The frame must be a JPEG file."); });
});
describe("pngSize", () => {
  it("still reads a PNG's size after moving, and jobs.ts still exports it", async () => {
    const jobs = await import("../../../functions/_shared/canva/jobs");
    expect(jobs.pngSize).toBe(pngSize);
    expect(pngSize(png2160)).toEqual([2160, 2160]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run supabase/tests/_shared/picture`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `contract.ts` and `headers.ts`; move `pngSize`**

In jobs.ts replace lines 49-54 with `export { pngSize } from "../picture/headers.ts";` and import it there for `logoSize`.

- [ ] **Step 4: Run the tests, the jobs tests and the packaging test**

Run: `npx vitest run supabase/tests/_shared/picture supabase/tests/_shared/canva/jobs.test.ts supabase/tests/_shared/packaging.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/picture supabase/functions/_shared/canva/jobs.ts supabase/tests/_shared/picture
git commit -m "Picture service: the contract between the workers and the service, and the header parsers"
```

---

### Task 2: The server skeleton, deployable

**Files:**
- Create: `server/package.json`, `server/package-lock.json`, `server/tsconfig.json`, `server/vercel.json`, `server/public/index.html`, `server/src/index.ts`, `server/src/app.ts`, `server/src/auth.ts`, `server/src/log.ts`
- Modify: `vitest.config.ts:47-53` (include), `eslint.config.js` (server override), `.gitignore` (`server/api/`), `.vercelignore` (`/server`)
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: `PICTURE_API_BASE`, `PICTURE_SECRET_HEADER` from the contract.
- Produces:
  - `export type AppDeps = { secret: string | undefined; fetchImpl?: typeof fetch; now?: () => number; log?: (line: Record<string, unknown>) => void };`
  - `export function createApp(deps: AppDeps): Hono` in `server/src/app.ts`: `GET /api/health` answers `{ ok: true, service: "socialytics-server" }` with no secret; every other `/api/*` route first passes the secret gate (`401 { ok: false, reason: "Not allowed." }` when the header is missing, wrong, or the configured secret is empty); unknown routes answer `404 { ok: false, reason: "Unknown route." }`; the picture routes are mounted by Task 5 (`app.route(PICTURE_API_BASE, pictureRoutes(deps))`).
  - `export async function secretEquals(candidate: string | null | undefined, secret: string | null | undefined): Promise<boolean>` in `server/src/auth.ts`: re-export of `supabase/functions/_shared/auth/secretEquals.ts` if `grep -n "Deno" supabase/functions/_shared/auth/secretEquals.ts` prints nothing (it uses `crypto.subtle` and `TextEncoder`, both global in Node 22); otherwise a copy with the same signature and the same SHA-256 constant-time comparison.
  - `export type Log = (line: Record<string, unknown>) => void; export const stdoutLog: Log` in `server/src/log.ts` (`console.log(JSON.stringify(line))`).
  - `server/src/index.ts`: `const app = createApp({ secret: process.env.PICTURE_SERVICE_SECRET, log: stdoutLog }); export default { fetch: (request: Request) => app.fetch(request) };`

- [ ] **Step 1: Create the package**

`server/package.json`:

```json
{
  "name": "socialytics-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 --external:sharp --outfile='api/[...path].mjs'",
    "typecheck": "tsc --noEmit -p ."
  },
  "dependencies": { "hono": "4.13.18", "sharp": "0.35.5", "zod": "4.6.7" },
  "devDependencies": { "@types/node": "<exact current 22.x>", "esbuild": "<exact current>", "imagescript": "1.3.0", "tsx": "<exact current>", "typescript": "<exact current 5.x>" }
}
```

Pin exact versions (`npm view <pkg> version` for the current ones; `@types/node` at the newest `22.x`). Run `npm install --prefix server` to write the lockfile.

`server/tsconfig.json`: `{ "compilerOptions": { "target": "ES2022", "lib": ["ES2023"], "module": "ESNext", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true, "strict": true, "skipLibCheck": true, "types": ["node"], "esModuleInterop": true }, "include": ["src", "test", "scripts"] }`.

`server/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "installCommand": "npm ci --no-audit --no-fund",
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": { "api/*.mjs": { "maxDuration": 90 } }
}
```

`server/public/index.html`: `<!doctype html><title>Socialytics server</title><p>Socialytics server.</p>`.

Root changes: `vitest.config.ts` include gains `"server/**/*.{test,spec}.ts"`; `eslint.config.js` gains an entry `{ files: ["server/**/*.ts"], languageOptions: { globals: globals.node } }` placed after the browser entry; `.gitignore` gains `server/api/` with a comment that it is the built bundle; `.vercelignore` gains `/server` with a comment.

- [ ] **Step 2: Write the failing test**

`server/test/app.test.ts` (first line `// @vitest-environment node`):

```ts
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { PICTURE_SECRET_HEADER } from "../../supabase/functions/_shared/picture/contract.ts";

const app = createApp({ secret: "s3cret", log: () => {} });

describe("the server's door", () => {
  it("answers health with no secret", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "socialytics-server" });
  });
  it("refuses a picture call without the secret, or with the wrong one", async () => {
    for (const headers of [{}, { [PICTURE_SECRET_HEADER]: "wrong" }]) {
      const res = await app.request("/api/picture/finish", { method: "POST", headers, body: "{}" });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, reason: "Not allowed." });
    }
  });
  it("refuses every call when no secret is configured, even an empty header", async () => {
    const bare = createApp({ secret: undefined, log: () => {} });
    const res = await bare.request("/api/picture/finish", { method: "POST", headers: { [PICTURE_SECRET_HEADER]: "" }, body: "{}" });
    expect(res.status).toBe(401);
  });
  it("answers an unknown route as JSON", async () => {
    const res = await app.request("/api/nothing", { headers: { [PICTURE_SECRET_HEADER]: "s3cret" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, reason: "Unknown route." });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run server/test/app.test.ts`
Expected: FAIL (no `app.ts`).

- [ ] **Step 4: Write `app.ts`, `auth.ts`, `log.ts`, `index.ts`**

The secret gate is Hono middleware on `/api/*` that skips `/api/health`. 404 uses `app.notFound`.

- [ ] **Step 5: Run the test, the typecheck and the build**

Run: `npx vitest run server/test/app.test.ts && npm run typecheck --prefix server && npm run build --prefix server && ls server/api`
Expected: PASS; `[...path].mjs` listed; `git status` shows `server/api/` ignored.

- [ ] **Step 6: Commit**

```bash
git add server vitest.config.ts eslint.config.js .gitignore .vercelignore
git commit -m "Picture service: the server package, its door and its build"
```

---

### Task 3: Raster core, byte-exact with imagescript

**Files:**
- Create: `server/src/picture/raster.ts`
- Test: `server/test/raster.test.ts`

**Interfaces:**
- Consumes: `Rect` from the contract; `sharp`; `imagescript` (tests only).
- Produces, in `raster.ts`:

```ts
/** RGBA, straight alpha, row-major, 4 bytes per pixel: the layout imagescript's Image.bitmap had. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };
export function raster(width: number, height: number): Raster;              // zeroed
export async function decodeRaster(bytes: Uint8Array): Promise<Raster>;     // sharp(bytes).ensureAlpha().raw(); any failure throws Error("The file is not a picture that can be read.")
export async function encodePng(r: Raster): Promise<Uint8Array>;            // sharp raw -> png({ compressionLevel: 6 })
export async function encodeJpeg(r: Raster, quality: number): Promise<Uint8Array>; // sharp raw -> removeAlpha() -> jpeg({ quality }); quality clamped 1..100 as imagescript did
export function fill(r: Raster, rgba: [number, number, number, number]): Raster;   // in place, returns r
export function crop(src: Raster, x: number, y: number, width: number, height: number): Raster;
export function overlay(bg: Raster, fg: Raster, x: number, y: number): Raster;     // in place on bg, returns bg
export function resizeNearest(src: Raster, width: number, height: number): Raster;
export function alphaBox(r: Raster, min: number): Rect | null;              // the box of pixels with alpha > min
```

  The arithmetic is imagescript 1.3.0's, ported line for line (the source is in the scratchpad folder `picture-service/imagescript-src/`; `v2/ops/overlay.mjs` `blend`, `v2/ops/resize.mjs` `nearest`, `ImageScript.js` `crop`/`__crop__`):
  - `overlay`: for each foreground pixel inside both rasters: `fa = fg alpha; if fa === 0 skip; if fa === 255 copy the pixel; else alpha = 1 + fa, inv = 256 - fa, channel = (alpha * F + inv * B) >> 8 for R, G, B, out alpha = max(fa, bg alpha)`. Offsets `x`, `y` truncated with `| 0`; the overlap is `left = max(x, 0)`, `top = max(y, 0)`, `width = min(bg.width, x + fg.width) - left`, `height = min(bg.height, y + fg.height) - top`; nothing when either is `<= 0`.
  - `resizeNearest`: `width`, `height` floored; `xw = (1 / width) * src.width`, `yw = (1 / height) * src.height`; source pixel for `(x, y)` is `((y * yw) | 0) * src.width + ((x * xw) | 0)`. Keep that exact floating-point order (not `floor(x * sw / w)`).
  - `crop`: `x`, `y`, `width`, `height` truncated with `~~`; `width` and `height` clamped to the source's; rows copied as `src.row(y + ty).subarray(x, x + width)` on 32-bit pixel views, as imagescript does (a crop that starts inside the row and runs past its end reads on into the next row, as the original did).
  - `alphaBox`: the loop in `_shared/video/steps.ts:203-212`, returning `{ x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }` or `null`.

- [ ] **Step 1: Write the failing tests**

`server/test/raster.test.ts` (`// @vitest-environment node`). Helpers: `seeded(seed)` LCG; `randomRaster(w, h, seed, alphaMode: "opaque" | "random" | "edges")`; `toImage(r): imagescript.Image` (new Image(w, h) with bitmap.set); `fromImage(img): Raster`.

```ts
describe("overlay", () => {
  it("matches imagescript's composite pixel for pixel on random layers, including offsets that leave the ground", () => {
    for (const [seed, x, y] of [[1, 0, 0], [2, 10, 7], [3, -5, -9], [4, 50, 40], [5, 63, 47], [6, 70, 0]]) {
      const bg = randomRaster(64, 48, seed, "random"), fg = randomRaster(20, 30, seed + 100, "edges");
      const expected = toImage(clone(bg)).composite(toImage(fg), x, y);
      expect(Buffer.from(overlay(bg, fg, x, y).data)).toEqual(Buffer.from(expected.bitmap));
    }
  });
});
describe("resizeNearest", () => {
  it("matches imagescript's resize for the title's half size and for odd ratios", () => {
    for (const [sw, sh, w, h] of [[1088, 1936, 544, 968], [37, 53, 20, 11], [10, 10, 25, 7]]) { /* compare with toImage(src).resize(w, h) */ }
  });
});
describe("crop", () => {
  it("matches imagescript's crop, including one that runs past the row", () => { /* (5, 7, 20, 10) on 32x24; (30, 0, 10, 5) on 32x24 */ });
});
describe("decodeRaster and encodePng", () => {
  it("decodes RGBA, RGB, palette and gray PNGs to the pixels imagescript gives", async () => {
    // make each variant with sharp from one random 40x30 raster: .png() / .removeAlpha().png() / .png({ palette: true, colours: 64 }) / .toColourspace("b-w").png()
    // for each: expect(decodeRaster(bytes).data) toEqual imagescript Image.decode(bytes).bitmap
  });
  it("decodes a 16-bit PNG to within one step of imagescript", async () => { /* .toColourspace("rgb16").png(); max channel difference <= 1, same size */ });
  it("round-trips through encodePng unchanged, and imagescript reads the result back identically", async () => { /* decodeRaster(await encodePng(r)).data equals r.data; Image.decode same */ });
  it("refuses bytes that are not a picture, in the product's words", async () => {
    await expect(decodeRaster(new TextEncoder().encode("<html>not found</html>"))).rejects.toThrow("The file is not a picture that can be read.");
  });
});
describe("encodeJpeg", () => {
  it("writes a JPEG of the raster's size at the asked quality, dropping alpha as the old encoder did", async () => { /* sharp(bytes).metadata(): width, height, format jpeg, channels 3 */ });
});
describe("alphaBox", () => {
  it("finds the box of visible pixels above the threshold, and nothing on an empty layer", () => {
    const r = raster(100, 60); /* set alpha 200 at (10,5), (40,30); alpha 16 at (90,50) which must not count */
    expect(alphaBox(r, 16)).toEqual({ x: 10, y: 5, width: 31, height: 26 });
    expect(alphaBox(raster(8, 8), 16)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run server/test/raster.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `raster.ts`**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/test/raster.test.ts`
Expected: PASS. If the 16-bit case differs by more than one step, report the measured difference in the task report and stop at that test: the ruling is recorded by the controller (no 16-bit file exists in storage today; the manifest of Task 10 lists every file's bit depth).

- [ ] **Step 5: Commit**

```bash
git add server/src/picture/raster.ts server/test/raster.test.ts
git commit -m "Picture service: raster core, pixel for pixel what imagescript did"
```

---

### Task 4: The five picture operations

**Files:**
- Create: `server/src/picture/canvas.ts`, `server/src/picture/locate.ts`, `server/src/picture/read.ts`, `server/src/picture/finish.ts`, `server/src/picture/title.ts`
- Test: `server/test/ops.test.ts`

**Interfaces:**
- Consumes: Task 3's `raster.ts`; `resampleRGBA`, `canvasLogoRect` from `supabase/functions/_shared/canva/brief.ts`; `findLogo` from `supabase/functions/_shared/design/logoMatch.ts`; `Placement`, `Rect`, `Rgb`, `Size`, `LocateResult`, `TITLE_GROUND`, `TITLE_ALPHA_MIN` from the contract.
- Produces:

```ts
// canvas.ts: today's generateDesign, design-worker/index.ts:474-491
export function generationCanvas(logo: Raster, placement: Placement, page: Size, background: Rgb): { canvas: Raster; mask: Raster; rect: Rect };
// locate.ts: today's locate step, design-worker/index.ts:284-287
export function locateLogo(design: Raster, logo: Raster, placement: Placement, background: Rgb, scales: [number, number]): LocateResult;
// read.ts: today's marks read (:322-323) and verify reads (:386-388, :400-402, :411-417, the crops given as rectangles)
export function readPictures(picture: Raster, page: Size, crops: { band?: Rect; area?: Rect }): { page: Raster; band?: Raster; area?: Raster };
// finish.ts: today's finish step, design-worker/index.ts:348-375
export function finishPicture(picture: Raster, logo: Raster, rect: Rect, frame: [number, number], output: Size): Raster;
// title.ts: today's title_check, _shared/video/steps.ts:203-216
export function titleRead(layer: Raster): { box: Rect | null; read: Raster | null };
```

  - `generationCanvas`: `rect = canvasLogoRect(placement, logo.width, logo.height, page.width, page.height)`; the logo resampled with `resampleRGBA` to `rect`; canvas `fill(raster(page), [r, g, b, 255])` then `overlay(canvas, logoAtRect, rect.x, rect.y)`; mask `raster(page)` with `[255, 255, 255, 255]` at every page pixel under a logo pixel whose alpha is not 0, pixels off the page skipped.
  - `locateLogo`: `usual = canvasLogoRect(placement, logo.width, logo.height, design.width, design.height)`; `found = findLogo(design.data, design.width, design.height, logo.data, logo.width, logo.height, usual, background, { scales })`; returns `{ ...found, usual, frame: [design.width, design.height] }`.
  - `readPictures`: `page` raster = `resampleRGBA(picture, page)`; `band` = `crop(pageRaster, band)` when given; `area` = `crop(picture, area)` when given (full resolution).
  - `finishPicture`: `k = picture.width / frame[0]`; `r = { x: round(rect.x * k), y: round(rect.y * k), width: round(rect.width * k), height: round(rect.height * k) }`; `lp = resampleRGBA(logo, r.width, r.height)`; the in-place blend of `:356-371` (skip alpha 0; `f = a / 255`; `Math.round(lp * f + px * (1 - f))` per channel; alpha 255; skip pixels off the picture); then `resampleRGBA(picture, output)` into a new raster.
  - `titleRead`: `box = alphaBox(layer, TITLE_ALPHA_MIN)`; `null` box gives `{ box: null, read: null }`; else ground `fill(raster(layer), [...TITLE_GROUND, 255])`, `overlay(ground, layer, 0, 0)`, `read = resizeNearest(ground, Math.round(layer.width / 2), Math.round(layer.height / 2))`.

- [ ] **Step 1: Write the failing tests with imagescript references**

`server/test/ops.test.ts` (`// @vitest-environment node`). The oracle for each operation is the worker's current code, transcribed into the test with imagescript (`Image`), so the test file quotes `design-worker/index.ts:474-491` (canvas and mask), `:355-375` (finish) and `steps.ts:201-216` (title) as its reference implementations. Fixtures are synthetic, built with the seeded helpers of Task 3 at the real sizes: a 2176x2720 page picture; a 2160x2160 square logo (a ring and a bar with anti-aliased edges, alpha 0 outside); a 700x239 wide logo; a 1088x1936 title layer (three blobs of lettering-like alpha on a transparent ground); a 2160x3840 Story picture.

```ts
describe("generationCanvas", () => {
  it("builds the canvas and the logo-shaped mask the generate step built, pixel for pixel", () => {
    // placement { anchor: "center", width: 0.32, top: 0.08 }, page 1088x1360, background [12, 34, 56], the wide logo
    // expect canvas.data equals the reference canvas bitmap; mask.data equals the reference mask bitmap; rect equals canvasLogoRect(...)
  });
  it("clips a logo the placement pushes past the page edge instead of throwing", () => {
    // placement { anchor: "left", left: 0.95, width: 0.32, top: 0.97 } -> same as the reference (which skips off-page pixels)
  });
});
describe("finishPicture", () => {
  it("places the logo file where the model drew it and delivers 1440 wide, pixel for pixel as the finish step did", () => {
    // picture 2176x2720, square logo, rect { x: 980, y: 2240, width: 370, height: 370 }, frame [2176, 2720], output { 1440, 1800 }
  });
  it("scales a rectangle found on a frame of another size by the picture's width, as the step did", () => {
    // frame [1088, 1360] with rect { x: 490, y: 1120, width: 185, height: 185 } on the 2176x2720 picture -> same as reference with k = 2
  });
  it("clips a logo rectangle that leaves the picture", () => {
    // rect { x: -40, y: 2600, width: 370, height: 370 } -> same as the reference, no throw
  });
  it("finishes a Story at 2160x3840 to 1440x2560 in a few seconds", () => {
    // output size; Date.now() difference under 10_000 ms
  });
});
describe("readPictures", () => {
  it("brings the picture to the page size for reading, cuts the Story's band from it and the logo's area at full size", () => {
    // Story picture 2160x3840, page 1152x2048, band { x: 69, y: 287, width: 1014, height: 1044 }, area { x: 502, y: 1335, width: 538, height: 465 }
    // page raster 1152x2048 equals resampleRGBA reference; band 1014x1044 equals imagescript crop of the page image; area 538x465 equals imagescript crop of the picture
  });
});
describe("titleRead", () => {
  it("finds the lettering's box and makes the grey read-back at half size, pixel for pixel as title_check did", () => { /* layer 1088x1936 */ });
  it("gives no box and no read-back for an empty layer", () => { expect(titleRead(raster(1088, 1936))).toEqual({ box: null, read: null }); });
});
describe("locateLogo", () => {
  it("finds a logo drawn smaller than usual where it was drawn, and reports the usual spot and the frame", () => {
    // as supabase/tests/_shared/design/pipeline.test.ts:30-58: 40x16 logo, 320x240 page, stamped at 0.8x and offset; scales [0.45, 1.15]
    // found within 2 px of the stamp; score >= 0.75; usual equals canvasLogoRect(...); frame [320, 240]
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run server/test/ops.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the five modules**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/test/ops.test.ts server/test/raster.test.ts`
Expected: PASS (the Story timing test well under its bound).

- [ ] **Step 5: Commit**

```bash
git add server/src/picture server/test/ops.test.ts
git commit -m "Picture service: canvas, locate, read, finish and title read, as the workers did them"
```

---

### Task 5: Storage I/O and the six routes

**Files:**
- Create: `server/src/storage.ts`, `server/src/picture/schemas.ts`, `server/src/picture/routes.ts`
- Modify: `server/src/app.ts` (mount `pictureRoutes`)
- Test: `server/test/storage.test.ts`, `server/test/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 4; the contract's request and result types; `zod`.
- Produces:

```ts
// storage.ts
export type Fetcher = typeof fetch;
export class StorageError extends Error {}   // message in the product's words
export async function fetchBytes(url: string, fetchImpl: Fetcher, maxBytes = PICTURE_MAX_INPUT_BYTES): Promise<Uint8Array>;
//   GET url; non-2xx -> StorageError("A picture could not be read from storage."); Content-Length above maxBytes, or a body that grows past it while streaming -> StorageError("A picture is larger than 64 MB.")
export async function putBytes(url: string, bytes: Uint8Array, contentType: string, fetchImpl: Fetcher): Promise<void>;
//   PUT url with headers { "content-type": contentType, "x-upsert": "true" }; non-2xx -> StorageError("A picture could not be stored.")
// schemas.ts: one zod schema per route body (strict objects; URLs as https strings; sizes and rects as non-negative integers except rect x/y which may be negative; quality 1..100)
// routes.ts
export function pictureRoutes(deps: { fetchImpl: Fetcher; log: Log; now: () => number }): Hono;
```

  Each `POST /<route>`: parse the body with its schema (`400 { ok: false, reason: "The request is not well formed: <path of the first issue>" }`); fetch and decode inputs; run the operation; encode and put outputs; answer `200 { ok: true, result, ms }`. A `StorageError` or a decode error answers `200 { ok: false, reason }`. Any other error answers `500 { ok: false, reason: "The picture service could not finish this call." }` and is logged with its message. Every answer is preceded by one log line `{ at, route, job, step, ms, ok, reason?, in: { <name>: "WxH" }, out: { <name>: "WxH, <bytes> B" } }`.

  Route bodies and outputs:
  - `canvas`: inputs `logo`; `generationCanvas`; puts `out.canvas` (PNG) and `out.mask` (PNG); result `{ rect, canvas: page, mask: page }`.
  - `locate`: inputs `design`, `logo`; `locateLogo`; no outputs.
  - `read`: input `picture`; `readPictures`; puts `out.page` (JPEG `READ_JPEG_QUALITY`), `out.band` (JPEG, same quality) when `band` given, `out.area` (PNG) when `area` given; result sizes.
  - `finish`: inputs `picture`, `logo`; `finishPicture`; puts `out` (PNG); result `{ picture, output, bytes }`.
  - `transcode`: input `picture`; `encodeJpeg(raster, quality)`; puts `out`; result `{ size, bytes }`.
  - `title-read`: input `layer`; `titleRead`; puts `out` (JPEG `READ_JPEG_QUALITY`) only when a box was found; result `{ layer, box, read }`.

- [ ] **Step 1: Write the failing tests**

`server/test/storage.test.ts`: a fake `fetchImpl` keyed by URL.

```ts
describe("fetchBytes", () => {
  it("returns the bytes of a 200 answer", ...);
  it("names a missing object in the product's words", async () => { await expect(fetchBytes(url404, f)).rejects.toThrow("A picture could not be read from storage."); });
  it("refuses a picture larger than 64 MB from its Content-Length, before reading it", ...);
});
describe("putBytes", () => {
  it("PUTs with the content type and x-upsert, and names a refused upload", ...);
});
```

`server/test/routes.test.ts`: `createApp({ secret: "s3cret", fetchImpl: fake, log: lines.push, now })` where `fake` serves PNG bytes by URL (`https://store.test/get/<name>`) and records PUTs by URL (`https://store.test/put/<name>` -> bytes, content type). Fixtures as in Task 4 but smaller where the operation allows (the canvas and finish cases keep real sizes once each).

```ts
describe("POST /api/picture/canvas", () => {
  it("writes the canvas and the mask and answers the rectangle", async () => {
    // puts["canvas.png"] decodes to generationCanvas(...).canvas.data exactly; same for the mask; result.rect; one log line with route "canvas", job, step, ok true
  });
});
describe("POST /api/picture/finish", () => {
  it("writes the delivered PNG at the output size and answers its byte count", ...);
});
describe("POST /api/picture/read", () => {
  it("writes the page JPEG, the band JPEG and the area PNG, each at its size", ...);
  it("writes only the page JPEG when no crop is asked", ...);
});
describe("POST /api/picture/locate", () => { it("answers the rectangle, the score, the usual spot and the frame", ...); });
describe("POST /api/picture/transcode", () => { it("writes a JPEG at the asked quality and answers its size", ...); });
describe("POST /api/picture/title-read", () => {
  it("answers the lettering's box and writes the read-back", ...);
  it("answers a null box and writes nothing for an empty layer", ...);
});
describe("what the service answers when it cannot work", () => {
  it("answers with a reason when the picture is missing from storage", async () => { /* 200 { ok: false, reason: "A picture could not be read from storage." } */ });
  it("answers with a reason when the bytes are not a picture", async () => { /* 200 { ok: false, reason: "The file is not a picture that can be read." } */ });
  it("answers with a reason when the picture is larger than 64 MB", ...);
  it("answers with a reason when storage refuses the upload", ...);
  it("rejects a body that is not well formed, naming the field", async () => { /* 400, reason starts with "The request is not well formed: " */ });
  it("logs one line per call, with the reason when there is one, and never the secret", ...);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run server/test/storage.test.ts server/test/routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `storage.ts`, `schemas.ts`, `routes.ts`; mount in `app.ts`**

- [ ] **Step 4: Run every server test, the typecheck and the build**

Run: `npx vitest run server && npm run typecheck --prefix server && npm run build --prefix server`
Expected: PASS; the bundle builds (sharp external, everything else inlined).

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "Picture service: the six routes, reading and writing through signed storage URLs"
```

---

### Task 6: The Deno client, the geometry, and the design worker

**Files:**
- Create: `supabase/functions/_shared/picture/client.ts`, `supabase/functions/_shared/picture/geometry.ts`
- Modify: `supabase/functions/design-worker/index.ts` (imports `:16-28`; `Deno.serve` actions `:71-72`; `locate` `:281-303`; `marks` `:318-342`; `finish` `:343-382`; `verify` `:383-428`; `generateDesign` `:466-505`)
- Test: `supabase/tests/_shared/picture/client.test.ts`, `supabase/tests/_shared/picture/geometry.test.ts`

**Interfaces:**
- Consumes: the contract; `outputSize`, `pictureSize` (`_shared/canva/finish.ts`); `storyTextBand` (`_shared/design/story.ts`); `LOGO_SCALES`, `logoFound` (`_shared/design/logoMatch.ts`).
- Produces (client.ts):

```ts
export class PictureError extends Error { constructor(message: string, readonly route: PictureRoute, readonly transient: boolean); }
export type PictureDeps = { fetchImpl?: typeof fetch; secret?: string | null; baseUrl?: string; timeoutMs?: number; sleep?: (ms: number) => Promise<void> };
/** One call to the picture service. Transient failures (network error, timeout, 429, 5xx) are tried once more after PICTURE_RETRY_AFTER_MS; everything else fails at once. */
export async function callPicture<R extends PictureRoute>(route: R, body: PictureRequests[R], deps?: PictureDeps): Promise<{ result: PictureResults[R]; ms: number }>;
export async function signedRead(admin: any, bucket: string, path: string, seconds = 600): Promise<string>;   // createSignedUrl
export async function signedWrite(admin: any, bucket: string, path: string): Promise<string>;               // createSignedUploadUrl(path, { upsert: true }).signedUrl
export function notePicture(state: any, route: PictureRoute, ms: number): void;  // state.picture_ms = { ...state.picture_ms, [route]: ms }
```

  Defaults: `secret = Deno.env.get("PICTURE_SERVICE_SECRET")`, `baseUrl = PICTURE_SERVICE_URL`, `timeoutMs = PICTURE_CALL_TIMEOUT_MS`, `fetchImpl = fetch`. Request: `POST ${baseUrl}${PICTURE_API_BASE}/${route}`, headers `content-type: application/json` and `[PICTURE_SECRET_HEADER]: secret`, `signal: AbortSignal.timeout(timeoutMs)`. Answers: `2xx` with `ok: true` returns `{ result, ms }`; `2xx` with `ok: false` throws `PictureError(reason, route, false)`; `400`, `401`, `404` throw `PictureError("The picture service refused the call (<status>).", route, false)`; `429`, `5xx`, a thrown fetch or a timeout: wait `PICTURE_RETRY_AFTER_MS` and try once more, then throw `PictureError("The picture service did not answer: <status or 'timeout' or 'network'>.", route, true)`. A missing secret throws `PictureError("The picture service secret is not set.", route, false)` before any request. No message ever contains the secret or the signed URLs.

  Produces (geometry.ts, no imports beyond the contract types):

```ts
export function scaledRect(rect: Rect, k: number): Rect;   // Math.round on each field
/** The area verify reads around the logo on the delivered picture: 0.6 of the logo's height around its rectangle, clipped to the picture (design-worker verify, 11 Nov 2026). */
export function logoAreaRect(logoRect: Rect, frame: [number, number], final: Size): Rect;
```

- [ ] **Step 1: Write the failing tests**

`geometry.test.ts`:

```ts
it("scales a rectangle found on the 2x picture down to a 1440-wide delivery with rounding", () => {
  expect(scaledRect({ x: 980, y: 2240, width: 370, height: 370 }, 1440 / 2176)).toEqual({ x: 649, y: 1482, width: 245, height: 245 });
});
it("reads 0.6 of the logo's height around it, clipped to the delivered picture", () => {
  expect(logoAreaRect({ x: 980, y: 2240, width: 370, height: 370 }, [2176, 2720], { width: 1440, height: 1800 })).toEqual({ x: 502, y: 1335, width: 538, height: 465 });
});
```

`client.test.ts` (fake `fetchImpl` recording calls; `sleep` recording waits):

```ts
describe("callPicture", () => {
  it("posts the body to the route with the secret header and answers the result and its time", ...);
  it("fails at once, with the service's reason, when the service says it could not work", async () => { /* 200 { ok: false, reason: "A picture could not be read from storage." } -> PictureError with that message, transient false, no second call */ });
  it("does not retry a refusal, and says so without the secret", async () => { /* 401 -> "The picture service refused the call (401)."; message lacks "s3cret" */ });
  it("retries once after two seconds when the service is busy or down, then gives up", async () => { /* 503 then 200 ok -> result, sleep called with 2000; 503 then 503 -> PictureError transient true, exactly 2 calls */ });
  it("treats a timeout as a transient failure", async () => { /* fetchImpl rejects with an AbortError named "TimeoutError" twice -> "did not answer: timeout" */ });
  it("refuses to call without a secret", ...);
});
describe("signed URLs", () => {
  it("asks storage for a 600 second read link and an upserting upload link", ...);  // fake admin recording createSignedUrl / createSignedUploadUrl arguments
});
describe("notePicture", () => { it("keeps the last duration of each route on the job's state", ...); });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run supabase/tests/_shared/picture`
Expected: FAIL.

- [ ] **Step 3: Write `client.ts` and `geometry.ts`, run the tests to green, commit**

```bash
git add supabase/functions/_shared/picture/client.ts supabase/functions/_shared/picture/geometry.ts supabase/tests/_shared/picture
git commit -m "Picture service: the workers' client, and the rectangles verify reads"
```

- [ ] **Step 4: Rewrite the design worker's steps**

In `supabase/functions/design-worker/index.ts`:
- Imports: remove `Image` (`:17`) and `resampleRGBA` (`:25`, keep `GenerateInput`, `canvasLogoRect`, `designPrompt`); add `callPicture, PictureError, notePicture, signedRead, signedWrite` from `../_shared/picture/client.ts`, `logoAreaRect` from `../_shared/picture/geometry.ts`, `READ_JPEG_QUALITY` from `../_shared/picture/contract.ts`.
- `generateDesign` (`:466-505`): replace `:474-495` with one `canvas` call: `logo: await signedRead(admin, BUCKET, job.input.logo_path)`, `page: { width: W, height: H }`, `placement: job.input.placement`, `background: hexRgb(g.background)`, `out: { canvas: await signedWrite(admin, BUCKET, \`${base}/canvas-${s.generations}.png\`), mask: await signedWrite(admin, BUCKET, \`${base}/mask-${s.generations}.png\`) }` (`base` and `s` passed in or recomputed; `job.id` and `"generate"` as `job`/`step`); then `images = [{ bytes: await download(admin, canvasPath), name: "canvas.png" }]` and `mask = await download(admin, maskPath)` passed to `imageEdit` as before. `notePicture(s, "canvas", ms)`.
- `locate` (`:281-303`): one `locate` call with `design: signedRead(s.design_path)`, `logo: signedRead(job.input.logo_path)`, `placement`, `background: hexRgb(g.background)`, `scales: LOGO_SCALES`; `found = result`, `usual = result.usual`, `s.logo_frame = result.frame`; the rest unchanged (`logoFound(found, usual.width)`, `designAgain`, `s.logo_rect`).
- `marks` (`:318-342`): one `read` call with `picture: signedRead(s.nologo_path)`, `page`, `out: { page: signedWrite(\`${base}/marks-${s.generations}-${s.unlogos}.jpg\`) }`; then `image = base64Encode(await download(admin, thatPath))`; the Claude call and the decision unchanged.
- `finish` (`:343-382`): one `finish` call with `picture: signedRead(s.nologo_path)`, `logo: signedRead(job.input.logo_path)`, `rect: s.logo_rect`, `frame: s.logo_frame`, `output: { width: ow, height: oh }`, `out: signedWrite(path)` where `path` keeps its `final-<base36>.png` name; `s.final_path = path`.
- `verify` (`:383-428`): one `read` call with `picture: signedRead(s.final_path)`, `page`, `band: storyTextBand(page.width, page.height)` for a Story, `area: logoAreaRect(s.logo_rect, s.logo_frame, { width: ow, height: oh })` when `s.logo_rect && s.logo_frame`, outputs `${base}/verify-<base36>.jpg`, `-band.jpg`, `-area.png`; then the three Claude reads from the downloaded files, decisions unchanged.
- Each call is followed by `notePicture(s, route, ms)`. A `PictureError` is not caught: it fails the step like any other error (a try is spent, `error` holds the reason).
- `pageOf`, `hexRgb`, `download`, `upload` stay.

- [ ] **Step 5: Add the `picture_check` action**

In `Deno.serve` after the `advance` line: `if (body?.action === "picture_check") return json(await pictureCheck(admin, Math.min(40, Number(body.count) || 3)));`. `async function pictureCheck(admin: any, count: number): Promise<{ elapsed_ms: number; results: Array<{ job: string; ms: number; ok: boolean; reason?: string }> }>`: selects the newest `count` rows of `canva_finish_jobs` with `status = 'done'`, `input->>'kind'` not `video`, and `state->>'nologo_path'`, `state->'logo_rect'`, `state->'logo_frame'`, `input->>'logo_path'` present; runs one `finish` call per row at once (`Promise.allSettled`) to `out = picture-check/${job.id}.png` with `step: "picture_check"`; returns each call's `ms` or the error's message. Synchronous (not `background`), so the caller reads the answer.

- [ ] **Step 6: Check the worker**

Run: `grep -n "imagescript\|Image\.\|resampleRGBA" supabase/functions/design-worker/index.ts` (expected: nothing); `deno check --no-lock supabase/functions/design-worker/index.ts` (expected: clean); `npx vitest run supabase/tests/_shared/picture supabase/tests/_shared/packaging.test.ts supabase/tests/_shared/canva` (expected: PASS).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/design-worker/index.ts
git commit -m "Design worker: every picture step calls the picture service; picture_check for the deployed service"
```

---

### Task 7: The video worker

**Files:**
- Modify: `supabase/functions/_shared/video/steps.ts` (`:36` import; `title_check` `:197-237`; `frame` `:261-266`; `makeKit` `:644-645`, `:657-659`, `:669`)
- Modify: `supabase/functions/_shared/video/hook.ts` (add `hookBoxOf`)
- Test: `supabase/tests/_shared/video/hook.test.ts`

**Interfaces:**
- Consumes: `callPicture`, `notePicture`, `signedRead`, `signedWrite` (client.ts); `jpegSize` (headers.ts); `FRAME_JPEG_QUALITY`, `KIT_JPEG_QUALITY`, `TitleReadResult`, `Rect`, `Size` (contract.ts).
- Produces (hook.ts): `export function hookBoxOf(result: TitleReadResult): { box: Rect; layer: Size }`, throwing `new Error("The title came back empty.")` when `result.box` is null.

- [ ] **Step 1: Write the failing test**

`supabase/tests/_shared/video/hook.test.ts`:

```ts
describe("hookBoxOf", () => {
  it("returns the lettering's box and the layer's size from the service's answer", () => {
    expect(hookBoxOf({ layer: { width: 1088, height: 1936 }, box: { x: 100, y: 800, width: 888, height: 300 }, read: { width: 544, height: 968 } }))
      .toEqual({ box: { x: 100, y: 800, width: 888, height: 300 }, layer: { width: 1088, height: 1936 } });
  });
  it("throws the empty-title error when the layer had no visible pixels", () => {
    expect(() => hookBoxOf({ layer: { width: 1088, height: 1936 }, box: null, read: null })).toThrow("The title came back empty.");
  });
});
```

- [ ] **Step 2: Run it to see it fail, write `hookBoxOf`, run it to green**

Run: `npx vitest run supabase/tests/_shared/video/hook.test.ts`

- [ ] **Step 3: Rewrite the three bitmap sites in `steps.ts`**

- Remove the imagescript import (`:36`).
- `title_check` (`:199-216`): replace the download, decode, loop and JPEG with one `title-read` call: `layer: await signedRead(admin, BUCKET, s.hook_path)`, `out: await signedWrite(admin, BUCKET, \`${base}/hook-${s.hooks}-read.jpg\`)`, `job: job.id`, `step: "title_check"`; `const { box, layer } = hookBoxOf(result); s.hook_box = box; s.hook_layer = layer;` `notePicture(s, "title-read", ms)`; the Claude read takes `base64Encode` of the downloaded read-back file; everything after unchanged.
- `frame` (`:261-266`): after `png` arrives, upload it as `${base}/frame-${n}.png` (`contentType: "image/png"`), then one `transcode` call: `picture: signedRead(that png)`, `quality: FRAME_JPEG_QUALITY`, `out: signedWrite(\`${base}/frame-${n}.jpg\`)`, `step: "frame"`; `s.frame_path` stays the `.jpg` path. `notePicture(s, "transcode", ms)`.
- `makeKit` (`:644-645`): `const size = kitEditSize(...jpegSize(still.bytes));` (the source stills are the ffmpeg JPEGs; a cleaned still fed back is the stored JPEG too). (`:657-659`): upload `png` to `REFERENCES` at `${job.client_id}/style/kit-${i}-edit.png`, then one `transcode` call with `quality: KIT_JPEG_QUALITY` and `out: signedWrite(admin, REFERENCES, path)`; (`:669`) the next edit's input becomes the stored JPEG: `still = { bytes: await downloadFrom(REFERENCES, path), name: "still.jpg" }` (a small download helper beside the existing ones). Kit errors keep their handling (`keepKitError`, no job failure).

- [ ] **Step 4: Check the worker**

Run: `grep -n "imagescript\|Image\." supabase/functions/_shared/video/steps.ts` (expected: nothing); `deno check --no-lock supabase/functions/video-worker/index.ts` (clean); `npx vitest run supabase/tests/_shared/video supabase/tests/_shared/packaging.test.ts` (PASS).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/video supabase/tests/_shared/video/hook.test.ts
git commit -m "Video worker: the title read-back, the frame and the kit stills go through the picture service"
```

---

### Task 8: One request lifecycle: a person's request is never parked for a date

**Files:**
- Modify: `supabase/functions/_shared/design/requestRules.ts` (add `canFilm` after `filmingOutcome`, `:86-92`)
- Create: `supabase/functions/design-request/postTime.ts`
- Modify: `supabase/functions/design-request/index.ts` (`create` `:90-98`; `planNow` `:319-330`)
- Test: `supabase/tests/_shared/design/requestRules.test.ts` (add a describe), `supabase/tests/design-request/postTime.test.ts`

**Interfaces:**
- Produces:

```ts
// requestRules.ts
/** Whether a video may wait for footage: only while the post is more than FILMING_CLOSE_HOURS away. A post whose time is unknown is not held to a date. A person's request for a post past that point is made from the client's posts instead, never parked (12 Nov 2026). */
export function canFilm(postAt: Date | null, now: Date): boolean;   // postAt === null ? true : filmingOutcome(postAt, now, false) === "keep"
// design-request/postTime.ts
/** The post's instant in the client's time zone, from calendar_posts and clients.timezone; null when the post is not in the calendar. */
export async function postTimeOf(admin: any, clientId: string, postKey: string): Promise<Date | null>;
```

- [ ] **Step 1: Write the failing tests**

requestRules.test.ts, new block:

```ts
describe("canFilm", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  it("lets a video wait for footage while its post is more than a day away", () => { expect(canFilm(new Date("2026-11-14T10:00:00Z"), now)).toBe(true); });
  it("does not park a video whose post is less than a day away, or already passed", () => {
    expect(canFilm(new Date("2026-11-13T09:00:00Z"), now)).toBe(false);
    expect(canFilm(new Date("2026-11-10T10:00:00Z"), now)).toBe(false);
  });
  it("holds a post whose time is unknown to no date", () => { expect(canFilm(null, now)).toBe(true); });
});
```

postTime.test.ts with `fakeDb` from `_shared/lifecycle/fakeDb`:

```ts
it("reads the post's time in the client's time zone", async () => {
  const db = fakeDb({ calendar_posts: [{ client_id: "c1", post_key: "k1", post_date: "2026-11-14", posting_time: "09:30" }], clients: [{ id: "c1", timezone: "Asia/Jerusalem" }] });
  expect((await postTimeOf(db, "c1", "k1"))?.toISOString()).toBe("2026-11-14T07:30:00.000Z");
});
it("answers null for a post that is not in the calendar", async () => { /* no row -> null */ });
```

- [ ] **Step 2: Run them to see them fail, write `canFilm` and `postTime.ts`, run to green**

Run: `npx vitest run supabase/tests/_shared/design/requestRules.test.ts supabase/tests/design-request/postTime.test.ts`

- [ ] **Step 3: Apply the rule in `create` and `planNow`**

`create` (`:90-98`): after `const route = ...`, add `const postAt = await postTimeOf(admin, clientId, postKey); const routeNow = designKind(body.format, body.platform) === "video" && !route && !canFilm(postAt, new Date()) ? "posts" : route;` with a comment ("A video for a post whose time has passed, or is less than a day away, is made from the client's posts: nothing is parked for footage that cannot arrive in time (12 Nov 2026)."); use `routeNow` in the filming test and in `startRequest`'s `route`.

`planNow` (`:319`): before computing `generatedVideo`, if `request.kind === "video" && !request.footage_path && request.video_route !== "posts"` and `!canFilm(await postTimeOf(admin, request.client_id, request.calendar_post_key), new Date())`, update the row `video_route: "posts"` (`.eq("id", request.id)`) and set `request.video_route = "posts"` so the rest of `planNow` plans it as a posts-route video (no style wait, no filming).

- [ ] **Step 4: Check**

Run: `deno check --no-lock supabase/functions/design-request/index.ts && npx vitest run supabase/tests/design-request supabase/tests/_shared/design`
Expected: clean, PASS (the existing `weekDecision`, `filmingOutcome` and `classifyPost` tests unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/design/requestRules.ts supabase/functions/design-request supabase/tests/_shared/design/requestRules.test.ts supabase/tests/design-request/postTime.test.ts
git commit -m "Design requests: a person's video is never parked for footage its post cannot wait for"
```

---

### Task 9: CI, the Vercel project, and the deploy job

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md` (a short "server/" section: what it is, `npm ci --prefix server`, how it deploys)
- Controller step (no subagent): the Vercel project.

- [ ] **Step 1 (controller, with the Vercel connector): create the project**

`create_project` in team `moburst-ai`: `{ name: "socialytics-server", framework: null, ssoProtection: null, resourceConfig: { fluid: true, functionDefaultMemoryType: "performance", functionDefaultTimeout: 90, functionDefaultRegions: ["iad1"] } }`; then `update_project` `{ nodeVersion: "22.x" }`. Confirm the project's domains include `socialytics-server-moburst-ai.vercel.app`; if Vercel assigned another name, change `PICTURE_SERVICE_URL` in the contract (and its test) before Task 10. Deployment protection stays off: the service authenticates every call with the secret and `/api/health` is public by design.

- [ ] **Step 2: Change the workflow**

In `.github/workflows/deploy.yml`:
- `node-version: '22'` in every `setup-node` step.
- In job `build`, after "Install": `- name: Install server` `run: npm ci --no-audit --no-fund --prefix server`; `- name: Typecheck server` `run: npm run typecheck --prefix server`; `- name: Build server` `run: npm run build --prefix server`. The existing "Test" step already runs the server tests through the root include.
- A new job `vercel-server` after `vercel`, a copy of it with `VERCEL_PROJECT: socialytics-server`, concurrency group `vercel-server-production`, and `--cwd server` added to every `npx "$VERCEL_CLI" ...` command (`project add`, `link`, `pull`, `build`, `deploy`). Its comment says: the picture service, deployed from `server/` as its own project; the workers call its production alias; it is inert until `PICTURE_SERVICE_SECRET` is set on both sides.

- [ ] **Step 3: Check the workflow parses and the local pieces run**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/deploy.yml"); puts "ok"'` (expected `ok`); `npm ci --no-audit --no-fund --prefix server && npm run typecheck --prefix server && npm run build --prefix server` (expected: clean).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "CI: Node 22, the server's checks, and the picture service's deploy job"
```

---

### Task 10: Proof, release and acceptance (the spec's section 4, in order)

**Files:**
- Create: `server/scripts/replay.ts`
- The manifest `picture-replay-manifest.json` is exported by the controller from the database into the scratchpad folder (`/private/tmp/claude-501/-Users-user-Desktop/9c67f1f0-e01f-4bec-9d3f-be9198793d9a/scratchpad/picture-service/`) and never committed: rows `{ job, client, page: Size, logo_path, design_path, nologo_path, logo_rect, logo_frame, final_path, placement, background }` for the 32 designs done since 2026-11-02 (`canva_finish_jobs` where `status = 'done'`, kind not video, `state->>'nologo_path'`, `state->'logo_rect'`, `state->>'final_path'` present).

**Interfaces:** `npx tsx server/scripts/replay.ts <manifest.json>`; public URL base `https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/public/generated-media/`.

- [ ] **Step 1: Write `replay.ts`**

For each row: fetch logo, design, nologo and final; decode each with `decodeRaster` and with imagescript's `Image.decode`; count differing bytes (decode equivalence; also print each PNG's bit depth and color type from its IHDR); run `finishPicture(nologo, logo, logo_rect, logo_frame, outputSize(page))` and count pixels that differ from the decoded stored final; run `locateLogo(design, logo, placement, background, LOGO_SCALES)` and print it beside the stored rectangle; time each operation. Print one line per job and a summary: `finish: N/32 identical`, `decode: N identical`, `locate: N same rectangle`, slowest finish in ms. Exit code 1 when any finish or decode differs.

- [ ] **Step 2: Run the replay (controller exports the manifest first)**

Run: `npx tsx server/scripts/replay.ts <manifest path>`
Expected: `finish: 32/32 identical`, every decode identical, every file 8-bit. A difference stops the plan here: the port is wrong, not the bar.

- [ ] **Step 3: Whole-suite checks, then commit the script**

Run: `npx vitest run --maxWorkers=4` (all green, count reported), the three `deno check` commands, `npm run typecheck --prefix server`, `npm run build --prefix server`, `npx tsc -b --force`.

```bash
git add server/scripts/replay.ts
git commit -m "Picture service: the replay that proves finish and decode against every delivered design"
```

- [ ] **Step 4: Release the code (controller, the release routine)**

From `/Users/user/Documents/AI Workflows/Dashboard/moburst-socialytics-canva`: `git fetch origin && git merge --ff-only origin/main && git merge --ff-only trends && git push origin canva-finish:main`. CI runs the tests and the `vercel-server` job. Then: `curl -s https://socialytics-server.vercel.app/api/health` answers `{"ok":true,"service":"socialytics-server"}`. The edge functions are not deployed yet; nothing calls the service.

- [ ] **Step 5: replaced at release (16 Nov 2026), nothing to do**

This step asked a person to generate `PICTURE_SERVICE_SECRET` and enter it in Lovable and in Vercel. It was removed: nobody sets anything, and the service checks each call through the database. The current release order is in the spec, "As released 16 Nov 2026".

- [ ] **Step 6: The deployed service under load (controller)**

Deploy `design-worker` from the merge commit first (it carries `picture_check`; the other functions wait). Trigger through SQL with the Vault copy of the operational secret: `select net.http_post(url := '.../functions/v1/design-worker', headers := jsonb_build_object('Content-Type','application/json','X-Socialytics-Secret',(select decrypted_secret from vault.decrypted_secrets where name='socialytics_n8n_secret')), body := '{"action":"picture_check","count":33}'::jsonb, timeout_milliseconds := 120000)`, then read the answer from `net._http_response`. Expected: 33 of 33 `ok`, every `ms` under 10,000, the slowest noted in the task report. This is the spec's load test (a Moburst week: 11 posts, 3 options).

- [ ] **Step 7: The workers' release (controller)**

Deploy `video-worker` and `design-request` from the same commit (design-worker is already live). From here every design and video step calls the service and no edge function decodes a picture.

- [ ] **Step 8 (Lital's go-ahead on spend): acceptance**

Three real requests, each ending in a design or a reason within its bounds, with `state.picture_ms` filled: a Pay The Pyper single (the square logo that killed the worker on 11 Nov), a Bader Law Story (2160x3840), a Moburst video (title read-back, frame, kit). Watch `canva_finish_jobs.state` and `design_requests` through SQL; no request may stay `preparing` past 90 minutes and none may close `post_passed`.

- [ ] **Step 9: Close out**

Update the spec's status line to "built and live <date>", the memory notes, and the SDD ledger. Remove nothing from storage: the `picture-check/` outputs and scratch reads are small.

---

## Self-review notes

- Spec coverage: section 1 routes (canvas, locate, read-picture as `read`, finish, kit-still and frame as `transcode`, title as `title-read`) in Tasks 4 and 5; signed URLs, shared secret, idempotent deterministic outputs, bounded calls and product-worded reasons in Tasks 5 and 6; logging in Task 5; section 2 worker changes in Tasks 6 and 7, attempts counted as today (no change needed: a thrown `PictureError` goes through `recordFailure`); section 3 lifecycle in Task 8; section 4 order in Task 10 (service, proof, load, workers, acceptance); section 5 costs: no new vendor; Scope: `server/` project, CI deploy, secret pattern, logs, tests (Tasks 2, 9).
- The spec's `verify` keeps reading the delivered file: Task 6's verify reads `s.final_path` through the service, logo-area crop included.
- Types used across tasks: `Raster` (Task 3) consumed by Tasks 4 and 5; `PictureResults["locate"]` carries `usual` and `frame` (Task 1) consumed by Task 6's locate step; `TitleReadResult` (Task 1) consumed by Task 7's `hookBoxOf`; `logoAreaRect` (Task 6) consumed by verify in the same task.
- Not covered by a test, stated: the rewritten step bodies in `design-worker/index.ts` and `steps.ts` (no injected dependencies today, as before this plan); they are proved by the replay (same arithmetic the service runs), `picture_check` (the deployed call path) and the three acceptance runs.
