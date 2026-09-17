# Socialytics QA fixes

These are versioned patches for the existing Socialytics and Competitive Analysis workflows. They have **not been published**. `code/` contains n8n Code-node bodies, not standalone JavaScript modules. ESLint excludes those fragments; `npm run test:qa` executes them in a fixture sandbox instead.

## What changes

- Resolve the brief ID from the webhook body. Skip Drive when no file is configured; read exported Google Docs/text bytes and extract text-based PDFs before the brief agent. Unsupported, empty or failed files produce a visible report warning, with saved brief text used as a fallback. Scanned PDFs and DOCX are not silently treated as readable text.
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

The isolated runtime test passed in n8n execution **451759** on 2026-09-17. The temporary workflow `o40X0dsb1R81zqiT` was archived. Both complete patched graphs passed SDK validation; the validator retained pre-existing `builtInTools`/`responsesApiEnabled` warnings on existing model nodes. Those model settings were not changed.

## Deliberately unchanged

The withdrawn client-access finding (QA-03) is not a fix target. Portal login and external user management stay intact. Webhook perimeter protection (QA-04) remains unverified: do not enable receiver authentication without coordinating and testing all senders. Neither finding justifies a speculative production permission change.
