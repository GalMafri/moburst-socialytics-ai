# Socialytics QA fixes

These are versioned patches for the existing Socialytics and Competitive Analysis workflows. The production workflows were patched and published on 17 September 2026; the latest verified versions are recorded below. The transformers remain tied to their audited baselines and must not be reapplied to the current production graph. `code/` contains n8n Code-node bodies, not standalone JavaScript modules. ESLint excludes those fragments; `npm run test:qa` executes them in a fixture sandbox instead.

## What changes

- Resolve the brief ID from the webhook body. Skip Drive when no file is configured; read exported Google Docs/text bytes and extract text-based PDFs before the brief agent. Unsupported, empty or failed files produce a visible report warning, with saved brief text used as a fallback. Scanned PDFs and DOCX are not silently treated as readable text.
- Bypass TikTok/Instagram actors when trends are disabled or usable keywords are missing. Enabled requests keep their existing limits (50/80) and receive nonempty queries/hashtags. Skipped branches still supply empty placeholders to the merge.
- Poll Gamma every 30 seconds for up to 20 checks. Only use a real URL from a completed generation. Keep usable analysis with a presentation warning on failure/timeout. Do not retry a generation-creation POST blindly after a transport failure.
- Send critical social-workflow failures back to the app and then stop with an error so the existing error workflow can notify. Completed reports are protected from late failure callbacks.
- Include both dates in competitive cadence calculations. Generate numeric benchmark dimensions from RivalIQ/aggregate numbers instead of the language model's suggested values. The shared metric implementation also corrects historical numeric views without rewriting stored reports.

## Prepare the existing workflows

Export the two current workflows from n8n to private files. They can contain credentials or inline secrets: **do not commit or share the exports or generated outputs**. Structural fixtures in `fixtures/` contain fake credential/header values and cannot be deployed.

```sh
node n8n/apply-qa-patches.mjs social /private/social.json /private/social-patched.json
node n8n/apply-qa-patches.mjs competitive /private/competitive.json /private/competitive-patched.json
```

The transformer refuses versions other than the audited baseline. If a version changed, rebase the patch against the new graph and revalidate it; do not bypass that check. Preserve existing credentials, trigger paths and workflow IDs. When applying node-level changes, duplicate the existing social callback node within n8n for `Mark Social Report Failed`, retaining its configured header, then change only its payload. Do not replace production credentials with fixture or redacted values.

## Coordinated release order

1. Back up current versions and apply the two additive database migrations. No existing role policies or portal authentication mappings change.
2. Deploy `schedule-sprout-post`, `run-report`, `trigger-scheduled-reports`, `update-report` and `update-competitive-report`, including their shared imports.
3. Apply the n8n node/connection patches to the existing workflows, validate them and publish the intended versions. Confirm the active version matches the tested draft.
4. Publish the app. New copy revisions require the new column; do not release the frontend ahead of its migration.
5. Verify through the existing portal with a designated test client: edit → reload → schedule; successful/failed report callbacks; paired scheduled competitive → social completion. A real Sprout schedule and paid report generation were not performed during this implementation.

The scheduler stores the exact competitive report it is waiting for. An atomic service-role-only claim prevents the daily scheduler and a completion callback from dispatching the same schedule twice. An interrupted claim does **not** expire automatically: inspect the created report and n8n execution before releasing `dispatch_claimed_at`. An uncertain POST may already have started work. A failed competitive dependency holds its social schedule until that report succeeds; retrying it uses its existing ID.

For rollback, restore previous app/edge/workflow versions. Leave additive columns/functions in place rather than deleting saved copy or dependency records. Inspect in-flight runs before changing their schedule state.

## Reproduce QA

```sh
npm test
npm run test:qa
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

SQL migration/privilege checks use an isolated PGlite PostgreSQL engine; it is a test-only installation outside the app:

```sh
npm install --prefix ../sql-qa --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.5.8
QA_SQL_MODULE="$(pwd)/../sql-qa/node_modules/@electric-sql/pglite/dist/index.js" node scripts/qa-sql.mjs
```

`node n8n/runtime-qa.mjs /private/runtime-qa-sdk.mjs` produces a manual-only n8n SDK test workflow. Validate it before creating an isolated workflow. It uses synthetic text/PDF bytes and pending Gamma responses, has no credentials or external-service nodes, and checks real binary extraction plus the 20-iteration polling bound. Archive the temporary workflow afterward.

The isolated runtime tests passed in n8n executions **451759** and **451774** on 2026-09-17. The second also checks disabled/enabled trend routing and actor-input constraints. Neither test calls Apify. Both temporary workflows (`o40X0dsb1R81zqiT`, `Yja3rapMoFoyHuHh`) were archived. Both complete patched graphs passed SDK validation; the validator retained pre-existing `builtInTools`/`responsesApiEnabled` warnings on existing model nodes. Those model settings were not changed.

## Deliberately unchanged

The withdrawn client-access finding (QA-03) is not a fix target. Portal login and external user management stay intact. Webhook perimeter protection (QA-04) was subsequently coordinated and tested on 23 September, as recorded below. Portal permissions were not changed.

## Release verification — 17 September 2026, 16:04 IDT

Fresh connector reads confirmed both published graphs match their current drafts:

- Socialytics: `1a8b6f71-2ec4-4cf7-ba74-d8646f2e2a49`.
- Competitive Analysis: `ca4c7fa7-6cd9-406b-9359-309d81dcca59` (schema-repair follow-up verified at 16:20 IDT).

The later metric patches use Sprout profile-period comments/shares instead of lifetime post substitutions, validate pagination and date ranges, preserve metric scope and collection timestamps, and identify the actual tracked RivalIQ client independently of the focus company. The competitive parser uses a dedicated Chat Completions repair model. Isolated executions 451998 and 451999 exercised recovery on the recorded Bader typo and preserved all values; the original analysis model remains unchanged. Execution 451992 documented the rejected response with the prior repair configuration. The temporary workflow was archived.

Production execution 451859 completed with both enabled trend scrapers. Execution 451933 regenerated Moburst August 1–31 with trends deliberately disabled; all seven aggregate metrics matched the verified Sprout source. Two Subliy reports were marked failed because their landscape tracked Jobber, not Subliy; existing payloads were retained for audit. No real Sprout post was scheduled.

As of this check, 422 app/patch tests and 116 backend/workflow checks passed. The live frontend bundle `index-BBwSuJON.js` matched the local tested build byte-for-byte. Final downloaded-PDF acceptance checks across all report types remain outstanding.

## Webhook authentication — 23 September 2026

App sender headers were deployed first (3371807, included in d30da96). Both report webhooks now use native header authentication with the dedicated `Socialytics App Webhook` credential and existing `X-Socialytics-Secret` value. Only trigger authentication and credential assignment changed; all other nodes, connections and settings were compared unchanged. No in-flight executions or intervening version edits were present.

Isolated native HTTP tests returned 200 with the correct secret and 403 with missing/incorrect headers. Both live endpoints then rejected missing/incorrect headers with 403 and created no executions. A new full paid report was not replayed for this change. The isolated test workflow 8VtLnAcpPUP6g3T7 was unpublished and archived.

Published versions (active equals draft):
- Socialytics: `97ccb734-1155-4f5c-9d70-0c491a7ab593`.
- Competitive: `26834222-cd01-4fc1-8c85-364701df4d29`.

Rollback versions are the 17 September versions above. Sender headers are additive and compatible with those versions; do not delete the shared secret on rollback. Existing model-node validation warnings remain unchanged.
