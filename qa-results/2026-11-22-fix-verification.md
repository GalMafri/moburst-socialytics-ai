# Fix verification: `qafix/all-findings`, 22 Nov 2026

Branch tip verified: `d73f88f` (165 commits on `main` at `2649d457`, fixing the 22 Nov bug hunt's findings). Checks ran in the cloud container (4 cores, 15 GB). Every test used fakes; no live service or database was called. Nothing was deployed, merged or pushed to `main`, and no PR was opened.

**Outcome.** Every fix has a regression test that passes on the branch, and 213 of the 216 finding IDs named in the commits have a test that fails on the old code by assertion. The re-hunt found 7 regressions the fixes introduced, all confirmed with a failing test and fixed in 7 commits on this branch. Three of them would have hurt in production: every video ending at its opening-frame step (R5), the Higgsfield link being lost after a database hiccup during a token refresh (R6), and the n8n competitive report node crashing (R2). After the fixes, the type check, full suite and build all pass.

## 1. Full checks

| Check | Branch tip `d73f88f` (as received) | After the 7 fix commits (`ba05280`) |
|---|---|---|
| `npm ci` | pass (npm audit warnings only) | (same install) |
| `npx tsc -b --force` | **fail**: 1 error, `supabase/functions/_shared/sprout/publishRules.ts(63,20): TS2339 Property 'Segmenter' does not exist on type 'typeof Intl'` (passes on `main`) | pass |
| `npx vitest run` | **4 failed**, 732 passed, 1 skipped files; tests 6892 passed, 4 failed, 4 skipped (6900) | 739 passed, 1 skipped files; tests 6899 passed, 4 skipped (6903) |
| `npm run build` | pass | pass |

The 4 failing tests on the branch as received:

| Test | Cause | On `main` | Resolution |
|---|---|---|---|
| `src/test/lifecycle/socialRead.test.ts` › snapshotOf › starts a new bio read after a changed profile's run can no longer be read, though an older bio is kept meanwhile | Regression R3 (P39-03 fix) | passes | fixed, `f95596f` |
| `supabase/tests/_shared/calendar/migration.replan.test.ts` › names the columns the app reads and writes for a parked account | Regression R4 (P39-05 refactor; test reads source text) | passes | fixed, `296718f` |
| `supabase/tests/_shared/pipelines/competitive/n8nParity.test.ts` › Aggregate Competitive Data … and Assemble Report Data | Regression R2 (P52-03 fix) | passes | fixed, `7c5f550` |
| `src/test/qa/deploymentPublication.test.ts` › publishes assets before the page and preserves the working release when a build fails | Environment: `rsync: command not found` in this container | fails the same way | passes once `rsync` is installed (local temp folder only); no code change |

The final suite has 3 more test files than the first run: the regression tests added for R5, R6 and R7.

## 2. Does each fix's test fail on the old code?

**Method.** The 205 test files added or changed between `2649d457` and `d73f88f` (`git diff --name-only 2649d457 HEAD -- src/test supabase/tests server/test`, plus 3 changed `supabase/functions/_shared/api/*.test.ts`) were run on the branch (from the full run) and then against the old application code: a worktree at `2649d457` with those test files and the 3 changed test helpers (`src/test/competitive/competitorReviewFake.tsx`, `supabase/tests/_shared/auth/fakeAdmin.ts`, `supabase/tests/_shared/canva/jobRow.ts`) copied in, and nothing else. For a changed file, "new tests" are the test cases whose names are not in the old version of the file (the old version was run on the old code first as a baseline; all passed). Where no name is new, the file's tests were only edited, and all are counted ("edited tests").

**Result.**

| On old code | Files |
|---|---|
| Fails by assertion (red) | 194 |
| Fails to load: the module it tests is new (`advance-creative-plan/stale.ts`) | 1 |
| Fails to load: the migration file it tests is new (PGlite tests of the SQL) | 4 |
| Passes: proves nothing | 6 |
| Passes on the branch | 205 of 205 |

796 test cases are new or edited in these files; 304 of them fail on the old code. The rest are guard cases (the case that must keep working) sitting beside the red ones, in 52 files. No red test's first failure on old code is a missing function or export: each is an assertion, a "promise rejected instead of resolving" or an element not found. Each file's first failure is in the appendix; I read them by category and spot-checked them against their commits, not one by one.

By finding ID (as named in the commit bodies: 216 distinct IDs, against the 214 findings in the brief; I did not reconcile the difference): 213 have an assertion-level red test. The other three:

- **P37-03** (`adaed25`): weak. The only test, `supabase/tests/advance-creative-plan/stale.test.ts`, tests the new helper `submittedGivenUp` alone. Nothing tests that `advance-creative-plan/index.ts` calls it in its look-up error path, so removing that call would keep every test green.
- **S1** (`2d4e510`): fails on old code only because its migration file is new, but the test runs the policies on PGlite and holds its own "refused before the migration" case, so it does prove the fix.
- **P46-05** (`4734ae1`): that commit has no test, but `supabase/tests/_shared/render/qa.single_weight_brand_font.test.ts` (added in `978a11b`) names P46-05 in its header and fails on old code with its symptom ("Google Fonts has no Bebas Neue 700").

P53-08's follow-up `3fed130` changes only a fixture; its fix `9ba748a` has red tests.

### Tests that prove nothing

All six are existing tests edited to keep passing under the new behaviour, not regression tests. Each fix they belong to has other red tests.

| File | What changed | Fix it belongs to |
|---|---|---|
| `src/test/analytics/trendsTab.test.tsx` | Finds the trends rpc by name, since the page now also reads strategy-only clients | `06b916f` (P17-01, P17-06) |
| `src/test/clientSetup.onboarding.test.tsx` | Waits for the client to load before asserting | `14fac91` (P18-*) |
| `src/test/clientSetup.trends.test.tsx` | `findByText` → `waitFor` for a loading line that redraws | `14fac91` (P18-*) |
| `supabase/tests/_shared/design/coverDesign.test.ts` | Allows the hold's own `lease_until` condition | `9ef130b` (P29-04 and others) |
| `supabase/tests/_shared/thinkingRoom.test.ts` | Counts `askVision(` calls with `anthropicMessages(` | `d49a875` (P54-02) |
| `supabase/tests/design-request/footage.test.ts` | Fake `start` returns `footage_path` | `5b8b7ef` (P56-04) |

Weak, as noted above: `supabase/tests/advance-creative-plan/stale.test.ts` (P37-03). The four migration tests (`calendarStopPlanIntent`, `clientMemberNeedsRole`, `storageUpsertUpdate`, `videoClipUnorder`) fail on old code only because the migration is new; they are behavioural PGlite tests, and every ID they carry also has another red test.

## 3. Regressions found by the re-hunt

Method: the qa-bug-hunter process (scope: this branch's diff against `main`), reading the diff area by area with the focus areas first, each suspect written as precondition → expected → actual and confirmed only by a failing test that passes on the old code. Repros are in the git-ignored `qa-bug-hunt/repros/`; the hunt's own report is `qa-bug-hunt/bug-report-20261122-133233-qafix-all-findings.md` (local only). Each confirmed regression's test was added to the suite with its fix.

| ID | Status | Introduced by | Precondition → expected → actual | Evidence | Fix |
|---|---|---|---|---|---|
| R5 | Confirmed, **high** | `9ef130b` (P29-04) | A video job runs its opening-frame step (`video/frame.ts`) inside `heldWork`. → The frame is recorded and the job moves to `frame_check`. → The step calls `renewJobLease` inside the hold, writing a lease beside the hold's; the hold's renewals and end only land on its own lease (`canva/hold.ts`), so the frame is never recorded, the lease runs out, a died try is counted and the step runs again, until the job fails "4 times at the same step". Every video would end there. | `supabase/tests/_shared/video/frameHoldLease.test.ts`: red on branch, green on `2649d457` | `f1fcb6b`: `renewJobLease` for a job held in this runtime renews the hold's own lease |
| R6 | Confirmed, **high** | `d6b61bc` (P37-02) with `751e320` (P53-09) | A Higgsfield token refresh rotates the refresh token; the lease-renewal write before saving it fails once. → The rotated pair is saved (P53-09's purpose). → `keepRefresh` reads the failed write as "another caller holds the lease" and returns the new access token without saving: the stored refresh token is the spent one, the next refresh is refused, and an admin must link Higgsfield again. No log line. | `supabase/tests/_shared/higgsfield/oauthKeepRefresh.test.ts`: red on branch, green on `2649d457` | `593f2e9`: only a lease known to be another caller's skips the save |
| R2 | Confirmed, **high** (competitive reports) | `926c5c2` (P52-03) | `postSample.ts` is pasted into the n8n Aggregate Competitive Data node with imports stripped. → The node runs. → The new import leaves `HASHTAG_IN_TEXT` undefined there: `ReferenceError` on the first captioned post. | existing `n8nParity.test.ts`: red on branch, green on `main` | `7c5f550`: the pattern is written out in `postSample.ts` |
| R7 | Confirmed, medium | `14fac91` (P18-02) | Client setup has loaded a client and the person is editing; a later read of the client (after Save, or a lifecycle step's refresh) does not get through. → The form stays. → The page is replaced by "Loading" until a read answers, since React Query keeps `isError` after a failed refresh. | `src/test/clientSetup.refetchFails.test.tsx`: red on branch, green on `2649d457` | `ba05280`: loading shows only until the row has been read |
| R1 | Confirmed, medium | `c95a7f9` (P49-02) | `npx tsc -b --force` → passes → TS2339 on `Intl.Segmenter` (the app's type library is ES2020). | the type check | `9131c4f` |
| R3 | Confirmed, low | `43ec08a` (P39-03) | The same Sprout Instagram profile changes its handle. → Its older bio stays while the new read runs (existing test). → Dropped, since the fix treats any key change as another account; P39-03 is about a different profile. | existing `socialRead.test.ts`: red on branch, green on `main` | `f95596f`: the bio follows the profile id; P39-03's own test still passes |
| R4 | Confirmed, low (test only) | `ce8bdc3` (P39-05) | A source-text check looks for the accounts step's old one-line select; the columns moved into a `columns` constant, all still read. | existing `migration.replan.test.ts` | `296718f`: the check reads the constant |

Suspected (not confirmed; no change made):

| ID | Where | Concern | Why not confirmed |
|---|---|---|---|
| Q1 | `supabase/functions/_shared/video/clipStep.ts:132-140` (`submitRefused`, P53-02) | Any `McpError` with a negative JSON-RPC code counts as "refused, nothing charged", so the order is cleared and a later pass orders the clip again. A server-side -32603 (internal error) may come after Higgsfield started the paid clip, which would mean a second paid clip. | Depends on what Higgsfield's server does before it answers -32603. Worth limiting to codes known to mean "not run" (for example -32600, -32601, -32602). |
| Q2 | `supabase/functions/design-request/footage.ts:66-72` (P56-04) | Footage arriving stops the open video for the post before the new request is known to start; if the start then fails, the post has neither. | Needs `start` to fail right then; not shown with a test. |
| Q3 | `20261122120700_brand_assets_replace.sql` and `20261122131100_storage_upsert_update_policies.sql` | Both create the same UPDATE policy on `brand-books`/`design-references` under two names (two fix groups). Harmless (permissive policies OR together); one is redundant. | Nit. |
| Q4 | `20261122140200_client_member_needs_role.sql` (P24-01) | `is_client_member` now needs a `user_roles` row. A legacy member added by hand in `client_users` without a role would lose access. | The commit says no such profile existed live on 22 Nov; cannot be checked without the live database. |

Checked with no defect found: `calendar_stop_plan` (its body matches the previous definition apart from the intent; grants restated for the new signature); `video_clip_unorder` (the `at` it matches is stored as the same ISO string the step passes); the `claimJob` rest-versus-died rule and the retry pause; `design/advance.ts` per-step tries and the late-hold break; `calendar-posts` named week and revision resend; `design-request/feedback.ts` repeat "Not right"; the new on-screen wording against the `quietSend` rule ("Not downloaded yet.", "…are not saved yet.", the loading states): each states the true state and none shows an error message.

## 4. Commits added to `qafix/all-findings`

| Commit | Regression | Test that failed first |
|---|---|---|
| `9131c4f` | R1 | `npx tsc -b --force` |
| `7c5f550` | R2 | `supabase/tests/_shared/pipelines/competitive/n8nParity.test.ts` |
| `f95596f` | R3 | `src/test/lifecycle/socialRead.test.ts` |
| `296718f` | R4 | `supabase/tests/_shared/calendar/migration.replan.test.ts` (test change only) |
| `f1fcb6b` | R5 | `supabase/tests/_shared/video/frameHoldLease.test.ts` (new) |
| `593f2e9` | R6 | `supabase/tests/_shared/higgsfield/oauthKeepRefresh.test.ts` (new) |
| `ba05280` | R7 | `src/test/clientSetup.refetchFails.test.tsx` (new) |

## 5. Before release

- The R5 fix changes how the shared hold works; it passed all 1052 canva, design and video tests and the full suite, but it is the change most worth a second reader.
- P37-03 has no test of the wiring in `advance-creative-plan/index.ts`.
- Q1 needs a decision from someone who knows Higgsfield's error semantics.
- Lint (`eslint`) was not part of this check; `canva/jobs.ts` has 15 existing `no-explicit-any` errors, none on the changed lines.

## Appendix: per-test-file results

"Finding IDs" are those named by the commits that touched the file. "New tests red on old" is new (or edited) test cases failing on the old code / all new (or edited) test cases in the file.

| # | Test file | A/M | Finding IDs | Branch | Old code | New tests red on old | First failure on old code (shortened) |
|---|---|---|---|---|---|---|---|
| 1 | `src/test/adminDashboard.clientActions.test.tsx` | A | P06-5 | pass (1) | fails | 1/1 | Error: Unable to find an element with the text: Deleting the client…. This could be because the text is broken… |
| 2 | `src/test/analytics/aiDeepInsightsThemesWait.test.tsx` | A | P05-3 | pass (1) | fails | 1/1 | Error: expect(element).toHaveTextContent() |
| 3 | `src/test/analytics/allTimeBeforeFirstReport.test.tsx` | A | P17-01 P17-06 | pass (1) | fails | 1/1 | AssertionError: expected <h2 class="t-h4"></h2> to be null |
| 4 | `src/test/analytics/strategyOnlyNoSproutCall.test.tsx` | A | P17-01 P17-06 | pass (1) | fails | 1/1 | AssertionError: expected [ 'sprout-analytics' ] to deeply equal [] |
| 5 | `src/test/analytics/trendsTab.test.tsx` | M | P17-01 P17-06 | pass (7) | **passes (proves nothing)** | 0/7 (edited tests) |  |
| 6 | `src/test/apiKeys/apiKeyCreateBusy.test.tsx` | A | P09-04 | pass (1) | fails | 1/1 | Error: expect(element).toBeDisabled() |
| 7 | `src/test/auth/blockedStorage.test.ts` | A | P10-03 | pass (2) | fails | 2/2 | AssertionError: expected [Function] to not throw an error but DOMException{ stack: 'SecurityError:…', …(1) } w… |
| 8 | `src/test/auth/logout.test.tsx` | A | P20-5 | pass (2) | fails | 1/2 | AssertionError: expected { access_token: 'token' } to be null |
| 9 | `src/test/auth/returnToOnAuthPage.test.tsx` | A | P10-02 | pass (1) | fails | 1/1 | AssertionError: expected '/' to be '/clients/c1/calendar' // Object.is equality |
| 10 | `src/test/auth/rolesReadFailed.test.tsx` | A | P17-04 | pass (1) | fails | 1/1 | AssertionError: expected <p class="t-secondary"></p> to be null |
| 11 | `src/test/automaticBrandReferencesRereadAfterChoice.test.tsx` | A | P06-1 P06-2 | pass (1) | fails | 1/1 | AssertionError: expected 1 to be greater than 1 |
| 12 | `src/test/automaticBrandReferencesRollback.test.tsx` | A | P06-1 P06-2 P06-3 | pass (2) | fails | 2/2 | Error: expect(element).toHaveAttribute("aria-pressed", "true") // element.getAttribute("aria-pressed") === "tr… |
| 13 | `src/test/calendar/approveChipDoubleClick.test.tsx` | A | P08-03 | pass (2) | fails | 1/2 | Error: Unable to find role="button" and name "Unmark as approved" |
| 14 | `src/test/calendar/calendarIndexArchived.test.tsx` | A | P17-02 | pass (2) | fails | 2/2 | Error: Unable to find role="button" and name '/Go to the week of Nov 16/' |
| 15 | `src/test/calendar/calendarPostActionsPostSwitch.test.tsx` | A | P05-4 | pass (1) | fails | 1/1 | Error: expect(element).toHaveValue(2026-11-12) |
| 16 | `src/test/calendar/designDownloadNotYet.test.tsx` | A | P08-04 | pass (2) | fails | 2/2 | AssertionError: nothing changed on screen; handler rejected with: TypeError: Failed to fetch: expected ' In us… |
| 17 | `src/test/calendar/designWeek.test.tsx` | M | P34-03 | pass (23) | fails | 1/23 (edited tests) | Error: Unable to find an element with the text: Made once there are enough video credits. This could be becaus… |
| 18 | `src/test/calendar/finishingRetryBounded.test.tsx` | A | P09-02 P09-05 | pass (2) | fails | 2/2 | AssertionError: expected 11 to be 1 // Object.is equality |
| 19 | `src/test/calendar/newPostDialogCloseWhileWriting.test.tsx` | A | P05-2 | pass (1) | fails | 1/1 | AssertionError: expected '' to be 'Captains pay last' // Object.is equality |
| 20 | `src/test/calendar/panelStaysOnFailedReread.test.tsx` | A | P08-06 | pass (1) | fails | 1/1 | TestingLibraryElementError: Unable to find an accessible element with the role "dialog" |
| 21 | `src/test/calendar/pendingClipPerPost.test.tsx` | A | P09-01 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(2) ] to deeply equal [ 'a.mp4 -> post:a' ] |
| 22 | `src/test/calendar/postParamOnce.test.tsx` | A | P17-05 | pass (1) | fails | 1/1 | AssertionError: expected [ …(3) ] to have a length of 1 but got 3 |
| 23 | `src/test/calendar/reportDockOpen.test.tsx` | A | P08-02 | pass (1) | fails | 1/1 | AssertionError: expected '/clients/c1/reports/rep1' to be '/clients/c1/calendar?week=2026-11-02&…' // Object.i… |
| 24 | `src/test/calendar/scheduleSpinnerAfterSend.test.tsx` | A | P07-03 | pass (1) | fails | 1/1 | AssertionError: expected "spy" to be called with arguments: [ false ] |
| 25 | `src/test/calendar/scheduleStatePanel.test.tsx` | M | P61-02 | pass (3) | fails | 1/1 | Error: Unable to find an element with the text: /Sending again makes a second draft in Sprout/. This could be … |
| 26 | `src/test/calendar/sendStatePastDue.test.ts` | A | P07-07 | pass (4) | fails | 3/4 | AssertionError: expected 'Sent to Sprout as a draft for Nov 10,…' to be 'Sent to Sprout as a draft for Nov 10,… |
| 27 | `src/test/calendar/shotBriefAskedAgain.test.tsx` | A | P09-02 P09-05 | pass (1) | fails | 1/1 | AssertionError: expected <p …(1)><svg …(11)>…(1)</svg></p> to be null |
| 28 | `src/test/calendar/undoNoteNotYet.test.tsx` | A | P08-05 | pass (2) | fails | 2/2 | AssertionError: expected 'Shorter caption.Rewritten with your n…' not to be 'Shorter caption.Rewritten with yo… |
| 29 | `src/test/calendar/weekPlanStatus.test.tsx` | M | P13-01 P13-02 | pass (26) | fails | 1/1 | AssertionError: expected [ { name: 'calendar-posts', …(2) } ] to deep equally contain { name: 'calendar-posts'… |
| 30 | `src/test/calendar/weekPlanStopAfterReady.test.tsx` | A | P05-1 | pass (1) | fails | 1/1 | AssertionError: expected [ { action: 'stop_plan', …(1) } ] to have a length of +0 but got 1 |
| 31 | `src/test/clientDashboard.failedRead.test.tsx` | A | P06-3 | pass (2) | fails | 1/2 | Error: Unable to find an element with the text: Loading the latest report. This could be because the text is b… |
| 32 | `src/test/clientNotes.test.tsx` | M | P07-09 P41-01 P41-05 P41-06 | pass (11) | fails | 2/2 | TestingLibraryElementError: Unable to find an element with the text: Not read. This could be because the text … |
| 33 | `src/test/clientOverview.approveWeek.test.ts` | A | P13-03 | pass (1) | fails | 1/1 | AssertionError: expected '/clients/c/calendar?week=2026-11-16' to contain 'week=2026-11-23' |
| 34 | `src/test/clientOverview.failedRead.test.tsx` | A | P06-3 | pass (1) | fails | 1/1 | AssertionError: expected <p class="t-secondary"></p> to be null |
| 35 | `src/test/clientSetup.onboarding.test.tsx` | M | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (10) | **passes (proves nothing)** | 0/10 (edited tests) |  |
| 36 | `src/test/clientSetup.partialSave.test.tsx` | A | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (1) | fails | 1/1 | Error: Unable to find an element with the text: The client details are saved. The Sprout account changes are k… |
| 37 | `src/test/clientSetup.readFailed.test.tsx` | A | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (1) | fails | 1/1 | AssertionError: expected <input …(4)></input> to be null |
| 38 | `src/test/clientSetup.saveOnce.test.tsx` | A | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (2) | fails | 2/2 | AssertionError: expected '8b230d25-0bda-4747-972e-63162fbf676d' to be '29680cec-e69a-4cac-8190-71ae1d283f73' /… |
| 39 | `src/test/clientSetup.sproutListLeave.test.tsx` | A | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (1) | fails | 1/1 | AssertionError: expected 4 to be 1 // Object.is equality |
| 40 | `src/test/clientSetup.trends.test.tsx` | M | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (27) | **passes (proves nothing)** | 0/27 (edited tests) |  |
| 41 | `src/test/clientSetup.typingDuringSave.test.tsx` | A | P18-01 P18-02 P18-04 P18-05 P18-07 P18-08 | pass (1) | fails | 1/1 | Error: expect(element).toHaveValue(https://baderlaw.example) |
| 42 | `src/test/clientStrategy.deckNotAsked.test.tsx` | A | P09-06 | pass (1) | fails | 1/1 | TestingLibraryElementError: Unable to find an accessible element with the role "status" |
| 43 | `src/test/competitive/comparedWithChip.test.tsx` | A | P19-1 P19-2 P19-3 | pass (2) | fails | 1/2 | AssertionError: expected "spy" to be called at least once |
| 44 | `src/test/competitive/competitorReview.test.tsx` | A | P20-1 P20-2 P20-3 P20-4 | pass (6) | fails | 5/6 | Error: Unable to find an element with the text: Company x. This could be because the text is broken up by mult… |
| 45 | `src/test/competitive/feedDraftLineFresh.test.tsx` | A | P18-03 P18-06 | pass (1) | fails | 1/1 | AssertionError: expected <p role="status" class="t-secondary"></p> to be null |
| 46 | `src/test/competitive/feedRefreshRefused.test.tsx` | A | P18-03 P18-06 | pass (1) | fails | 1/1 | AssertionError: expected 'Pulled Nov 12, 2026, 8:00 AM · Nov 5,…' to not deeply equal 'Pulled Nov 12, 2026, 8:… |
| 47 | `src/test/competitive/heldReportPeriodRead.test.tsx` | A | P19-1 P19-2 P19-3 | pass (1) | fails | 1/1 | AssertionError: expected 122 to be less than 20 |
| 48 | `src/test/competitive/platformButtonsByChannel.test.tsx` | A | P19-1 P19-2 P19-3 | pass (2) | fails | 1/2 | AssertionError: expected <button …(1)></button> to be null |
| 49 | `src/test/designReferencesRemovedDuringUpload.test.tsx` | A | P07-05 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(2) ] to deeply equal [ 'Acme/c1-5-1.png' ] |
| 50 | `src/test/designRemoveNotYet.test.tsx` | A | P07-08 | pass (2) | fails | 2/2 | Error: expect(element).toBeDisabled() |
| 51 | `src/test/display.compactNumber.test.ts` | A | P14-03 P15-01 | pass (1) | fails | 1/1 | AssertionError: expected '1000K' to be '1M' // Object.is equality |
| 52 | `src/test/hooks/sproutSyncPressDuringRead.test.tsx` | A | P11-1 | pass (1) | fails | 1/1 | AssertionError: expected { added: [], …(1) } to be null |
| 53 | `src/test/hooks/trackViewSecondEntity.test.tsx` | A | P11-2 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(2) ] to deeply equal [ 'report_opened:A', …(3) ] |
| 54 | `src/test/lib/badGatewayNotResent.test.ts` | A | P15-03 | pass (3) | fails | 2/3 | AssertionError: expected true to be false // Object.is equality |
| 55 | `src/test/lib/formatCount.test.ts` | A | P14-03 P15-01 | pass (1) | fails | 1/1 | AssertionError: expected '1000.0K' to be '1.0M' // Object.is equality |
| 56 | `src/test/lib/telemetry.refusedRow.test.ts` | A | P15-02 | pass (1) | fails | 1/1 | AssertionError: expected 6 to be less than or equal to 1 |
| 57 | `src/test/net/safeUrl.test.ts` | M | P41-02 | pass (25) | fails | 3/3 | AssertionError: expected true to be false // Object.is equality |
| 58 | `src/test/preview/previewWrongClient.test.tsx` | A | P07-01 | pass (2) | fails | 2/2 | AssertionError: expected "spy" to not be called at all, but actually been called 1 times |
| 59 | `src/test/qa/allReports.competitivePaging.test.tsx` | A | P17-03 | pass (1) | fails | 1/1 | AssertionError: expected <h2 class="t-h4"></h2> to be null |
| 60 | `src/test/qa/reportActions.test.tsx` | A | P21-01 P21-02 P21-07 | pass (3) | fails | 3/3 | AssertionError: expected "spy" to be called at least once |
| 61 | `src/test/qa/runAnalysisPage.test.tsx` | A | P21-03 P21-04 P21-05 | pass (4) | fails | 3/4 | AssertionError: expected <p></p> to be null |
| 62 | `src/test/qa/usagePage.test.tsx` | A | P21-06 | pass (3) | fails | 2/3 | AssertionError: expected <span class="t-secondary"></span> to be null |
| 63 | `src/test/reports/deckOpenNotYet.test.tsx` | A | P07-06 | pass (1) | fails | 1/1 | Error: Unable to find role="status" |
| 64 | `src/test/strategyDocRemoveCloses.test.tsx` | A | P07-04 | pass (1) | fails | 1/1 | AssertionError: expected <div role="alertdialog" …(7)>…(2)</div> to be null |
| 65 | `src/test/strategyEditSheetCloseWhileSaving.test.tsx` | A | P09-03 | pass (2) | fails | 1/2 | TestingLibraryElementError: Unable to find an accessible element with the role "dialog" |
| 66 | `src/test/strategyEmptyCardSaves.test.tsx` | A | P10-01 | pass (1) | fails | 1/1 | AssertionError: expected { Object (p_client, p_key, ...) } to match object { p_text: 'Nothing listed.', …(1) } |
| 67 | `src/test/ui/creativeProduction.longSubject.test.ts` | A | P13-04 | pass (1) | fails | 1/1 | AssertionError: expected +0 to be 1 // Object.is equality |
| 68 | `src/test/ui/exportPdf.hiddenOpener.test.ts` | A | P14-01 | pass (1) | fails | 1/1 | AssertionError: expected 'still waiting' to be 'done' // Object.is equality |
| 69 | `supabase/tests/_shared/apify/instagramProfile.test.ts` | M | P24-05 P39-02 | pass (6) | fails | 1/2 | AssertionError: expected { state: 'read', bio: null, …(2) } to deeply equal { state: 'failed', run_id: 'r1', …… |
| 70 | `supabase/tests/_shared/apify/linkedinPage.test.ts` | M | P24-05 P39-02 | pass (11) | fails | 1/2 | AssertionError: expected { state: 'read', page: null, …(2) } to deeply equal { state: 'failed', run_id: 'r1', … |
| 71 | `supabase/tests/_shared/auth/requireMember.test.ts` | A | P24-01 P24-04 | pass (4) | fails | 2/4 | AssertionError: expected 403 to be 500 // Object.is equality |
| 72 | `supabase/tests/_shared/calendar/qa.copy_check_false_refusals.test.ts` | A | P27-04 | pass (3) | fails | 2/3 | AssertionError: expected { why: 'shares wording with C1', …(2) } to be null |
| 73 | `supabase/tests/_shared/calendar/qa.moment_listed_twice_planned_twice.test.ts` | A | P27-03 | pass (2) | fails | 2/2 | AssertionError: expected [ '2026-11-05', '2026-11-06' ] to have a length of 1 but got 2 |
| 74 | `supabase/tests/_shared/calendar/qa.moments_cut_off_reply_recorded_empty.test.ts` | A | P27-01 | pass (2) | fails | 2/2 | AssertionError: expected { status: 'done', found: +0 } to not deeply equal { status: 'done', found: +0 } |
| 75 | `supabase/tests/_shared/calendar/qa.plan_finish_loses_rules.test.ts` | A | P28-01 | pass (1) | fails | 1/1 | AssertionError: expected 'outside' to be null |
| 76 | `supabase/tests/_shared/calendar/qa.replanned_week_loses_moments.test.ts` | A | P27-02 | pass (1) | fails | 1/1 | AssertionError: expected 'Waiting for the client\'s trends.' to be 'Waiting for the week\'s dated moments.' //… |
| 77 | `supabase/tests/_shared/calendar/qa.revise_overwrites_designed_post.test.ts` | A | P28-02 | pass (1) | fails | 1/1 | AssertionError: expected 'Warmer new copy' to be 'Old copy' // Object.is equality |
| 78 | `supabase/tests/_shared/calendar/runWeek.test.ts` | M | P28-02 | pass (68) | fails | 1/68 (edited tests) | AssertionError: expected [ 'k1', 'k2', 'k3' ] to deeply equal [ 'k1', 'k1', 'k2', 'k3' ] |
| 79 | `supabase/tests/_shared/canva/attemptsPerStep.test.ts` | A | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (1) | fails | 1/1 | RangeError: Invalid time value |
| 80 | `supabase/tests/_shared/canva/holdLease.test.ts` | A | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (3) | fails | 3/3 | AssertionError: expected null to be '2026-11-22T13:41:51.370Z' // Object.is equality |
| 81 | `supabase/tests/_shared/canva/holdStopped.test.ts` | A | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (1) | fails | 1/1 | AssertionError: expected 1 to be +0 // Object.is equality |
| 82 | `supabase/tests/_shared/canva/overdueClipRendering.test.ts` | A | P53-06 | pass (3) | fails | 1/3 | AssertionError: expected [ 'req-1' ] to deeply equal [] |
| 83 | `supabase/tests/_shared/canva/overdueFinished.test.ts` | A | P29-06 P29-07 | pass (2) | fails | 2/2 | AssertionError: expected { status: 'closed', options_ready: +0 } to deeply equal { status: 'ready', options_re… |
| 84 | `supabase/tests/_shared/canva/pictureCrash.test.ts` | A | P29-02 P32-2 | pass (2) | fails | 2/2 | AssertionError: expected { status: 'running', attempts: +0 } to match object { status: 'failed' } |
| 85 | `supabase/tests/_shared/canva/replacementLogoGone.test.ts` | A | P29-06 P29-07 | pass (1) | fails | 1/1 | AssertionError: expected { status: 'preparing', …(1) } to deeply equal { status: 'closed', …(1) } |
| 86 | `supabase/tests/_shared/canva/stepError.test.ts` | M | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (9) | fails | 1/9 (edited tests) | AssertionError: expected NaN to be greater than 110000 |
| 87 | `supabase/tests/_shared/canva/stepErrorPause.test.ts` | A | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (5) | fails | 5/5 | AssertionError: expected 'retry' to be 'wait' // Object.is equality |
| 88 | `supabase/tests/_shared/competitive/feedRefreshContracts.test.ts` | A | P30-03 P30-04 P30-06 P30-07 | pass (4) | fails | 4/4 | Error: promise rejected "Error: The selected competitors do not ma…" instead of resolving |
| 89 | `supabase/tests/_shared/competitive/followRequestedRefollows.test.ts` | A | P31-01 P31-02 P31-04 P31-05 P31-06 P31-08 S6 | pass (1) | fails | 1/1 | AssertionError: expected 1 to be greater than 1 |
| 90 | `supabase/tests/_shared/competitive/handleLookupBadWebsite.test.ts` | A | P30-02 | pass (1) | fails | 1/1 | AssertionError: expected [ 'running', null ] to not include 'running' |
| 91 | `supabase/tests/_shared/competitive/handleNotAProfile.test.ts` | A | P30-01 | pass (4) | fails | 4/4 | AssertionError: expected { platform: 'youtube', …(2) } to be null |
| 92 | `supabase/tests/_shared/competitive/identifyProposesClient.test.ts` | A | P30-05 | pass (2) | fails | 2/2 | AssertionError: expected [ 'Bader Law', 'Peer Law', …(2) ] to not include 'Bader Law' |
| 93 | `supabase/tests/_shared/competitive/rateTotalsViews.test.ts` | A | P31-03 | pass (1) | fails | 1/1 | AssertionError: expected 0.2 to be close to 0.01, received difference is 0.19, but expected 5e-7 |
| 94 | `supabase/tests/_shared/competitive/refollowSince.test.ts` | A | P31-01 P31-02 P31-04 P31-05 P31-06 P31-08 S6 | pass (1) | fails | 1/1 | AssertionError: expected 172800003 to be less than 3600000 |
| 95 | `supabase/tests/_shared/competitive/selectionChangeLandscape.test.ts` | A | P31-01 P31-02 P31-04 P31-05 P31-06 P31-08 S6 | pass (3) | fails | 2/3 | AssertionError: expected 'L2' to be 'L1' // Object.is equality |
| 96 | `supabase/tests/_shared/competitive/staleLeaseBusy.test.ts` | A | P31-01 P31-02 P31-04 P31-05 P31-06 P31-08 S6 | pass (1) | fails | 1/1 | AssertionError: expected [ 'busy', 'busy', 'busy' ] to not include 'busy' |
| 97 | `supabase/tests/_shared/competitive/verifyMismatchLeaves.test.ts` | A | P31-01 P31-02 P31-04 P31-05 P31-06 P31-08 S6 | pass (3) | fails | 3/3 | AssertionError: expected [ …(5) ] to deeply equal [] |
| 98 | `supabase/tests/_shared/dbFake.test.ts` | A | P31-07 | pass (2) | fails | 2/2 | Error: promise resolved "{ data: [ { id: 'row' } ], …(2) }" instead of rejecting |
| 99 | `supabase/tests/_shared/design/boxedLogo.test.ts` | A | P33-2 | pass (3) | fails | 1/3 | AssertionError: expected null to be 'stored' // Object.is equality |
| 100 | `supabase/tests/_shared/design/carouselWaitCycle.test.ts` | A | P32-1 | pass (1) | fails | 1/1 | AssertionError: expected false to be true // Object.is equality |
| 101 | `supabase/tests/_shared/design/coverDesign.test.ts` | M | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (19) | **passes (proves nothing)** | 0/1 |  |
| 102 | `supabase/tests/_shared/design/headlinePictograph.test.ts` | A | P34-01 P34-02 | pass (3) | fails | 3/3 | AssertionError: expected false to be true // Object.is equality |
| 103 | `supabase/tests/_shared/design/headlineTypography.test.ts` | A | P34-01 P34-02 | pass (2) | fails | 2/2 | AssertionError: expected false to be true // Object.is equality |
| 104 | `supabase/tests/_shared/design/holdStartsEarly.test.ts` | A | P32-3 P57-05 | pass (3) | fails | 1/3 | AssertionError: expected [ 'locate', 'unlogo' ] to deeply equal [ 'locate' ] |
| 105 | `supabase/tests/_shared/design/logoSetSiteGone.test.ts` | A | P33-3 | pass (2) | fails | 2/2 | AssertionError: expected [] to deeply equal [ 'logo-set' ] |
| 106 | `supabase/tests/_shared/design/searchLastCallTimeout.test.ts` | A | P33-4 | pass (2) | fails | 1/2 | AssertionError: expected { status: 'running', attempts: +0 } to deeply equal { status: 'failed', attempts: 4 } |
| 107 | `supabase/tests/_shared/design/stillDrawnShade.test.ts` | A | P33-1 | pass (2) | fails | 1/2 | AssertionError: expected true to be false // Object.is equality |
| 108 | `supabase/tests/_shared/design/weekRules.test.ts` | M | P34-03 | pass (29) | fails | 1/1 | AssertionError: expected { post_key: 'v', kind: 'video', …(5) } to match object { state: 'queued', …(1) } |
| 109 | `supabase/tests/_shared/higgsfield/oauth.test.ts` | M | P53-09 | pass (25) | fails | 2/2 | Error: Could not keep the Higgsfield tokens: connection reset |
| 110 | `supabase/tests/_shared/higgsfield/refreshLease.test.ts` | A | P37-01 P37-02 | pass (2) | fails | 2/2 | Error: STACK_TRACE_ERROR |
| 111 | `supabase/tests/_shared/higgsfield/tokenMidRender.test.ts` | A | P37-01 P37-02 | pass (1) | fails | 1/1 | Error: promise rejected "McpError: Higgsfield rejected the session… { code: … }" instead of resolving |
| 112 | `supabase/tests/_shared/lifecycle/fakeDb.test.ts` | A | P38-3 | pass (4) | fails | 4/4 | AssertionError: expected 'running' to be 'failed' // Object.is equality |
| 113 | `supabase/tests/_shared/lifecycle/location.test.ts` | M | P38-2 | pass (21) | fails | 1/1 | AssertionError: expected 'America/Los_Angeles' to be 'Australia/Perth' // Object.is equality |
| 114 | `supabase/tests/_shared/lifecycle/policy.test.ts` | M | P39-01 | pass (14) | fails | 1/1 | AssertionError: expected { set_id: 's1', …(1) } to deeply equal { set_id: 's1' } |
| 115 | `supabase/tests/_shared/lifecycle/run.queued.test.ts` | A | P38-1 | pass (1) | fails | 1/1 | AssertionError: expected { failedBefore: +0 } to deeply equal { failedBefore: 2 } |
| 116 | `supabase/tests/_shared/lifecycle/run.test.ts` | M | P39-04 | pass (12) | fails | 1/12 (edited tests) | AssertionError: expected { …(12) } to match object { status: 'waiting', result: { …(3) } } |
| 117 | `supabase/tests/_shared/lifecycle/socialRead.instagram_bio_failed_never_reread.test.ts` | A | P39-02 P39-03 | pass (1) | fails | 1/1 | AssertionError: expected [ 'kitcaster' ] to deeply equal [ 'kitcaster', 'kitcaster' ] |
| 118 | `supabase/tests/_shared/lifecycle/socialRead.instagram_bio_other_account_kept.test.ts` | A | P39-02 P39-03 | pass (1) | fails | 1/1 | AssertionError: expected { …(2) } to be null |
| 119 | `supabase/tests/_shared/lifecycle/steps.accountsPaged.test.ts` | A | P39-05 | pass (1) | fails | 1/1 | AssertionError: expected [ 900, 901 ] to deeply equal [ 900 ] |
| 120 | `supabase/tests/_shared/lifecycle/steps.test.ts` | M | P39-04 | pass (195) | fails | 3/195 (edited tests) | AssertionError: expected { status: 'done', result: { …(7) } } to deeply equal { status: 'waiting', …(3) } |
| 121 | `supabase/tests/_shared/lifecycle/steps.trackingVerify.test.ts` | A | P39-01 | pass (1) | fails | 1/1 | AssertionError: expected { status: 'failed', …(1) } to not deeply equal { status: 'failed', …(1) } |
| 122 | `supabase/tests/_shared/lifecycle/steps.voiceRebuild.test.ts` | A | P39-04 | pass (1) | fails | 1/1 | AssertionError: expected { status: 'done', queued: +0 } to deeply equal { status: 'waiting', queued: 1 } |
| 123 | `supabase/tests/_shared/notes/docx.test.ts` | M | P41-03 | pass (7) | fails | 2/2 | AssertionError: expected 4884.808647 to be less than 1000 |
| 124 | `supabase/tests/_shared/notes/read.test.ts` | M | P41-01 P41-05 P41-06 | pass (13) | fails | 1/1 | AssertionError: expected 6291456 to be less than or equal to 5242880 |
| 125 | `supabase/tests/_shared/notes/run.test.ts` | M | P41-01 P41-05 P41-06 | pass (18) | fails | 3/4 | AssertionError: expected { Object (client_id, kind, ...) } to match object { state: 'nothing', …(1) } |
| 126 | `supabase/tests/_shared/openai/key.test.ts` | A | P41-04 | pass (4) | fails | 1/4 | AssertionError: expected true to be false // Object.is equality |
| 127 | `supabase/tests/_shared/pipelines/qa.confirmed_top3_by_name.test.ts` | A | P43-03 | pass (1) | fails | 1/1 | AssertionError: expected { '1': true, '2': false, '3': true } to deeply equal { '1': false, '2': true, '3': tr… |
| 128 | `supabase/tests/_shared/pipelines/qa.cut_off_answer_sent_to_repair.test.ts` | A | P43-04 | pass (3) | fails | 3/3 | AssertionError: expected { type: 'next', step: 'repair', …(2) } to not match object { type: 'next', step: 'rep… |
| 129 | `supabase/tests/_shared/pipelines/qa.deck_decline_all_metrics.test.ts` | A | P45-01 P45-02 P45-04 | pass (1) | fails | 1/1 | AssertionError: expected 'Create a professional Social Media Pe…' not to match /decline across all metrics/ |
| 130 | `supabase/tests/_shared/pipelines/qa.direct_reasked_on_submit_retry.test.ts` | A | P43-01 P43-02 | pass (2) | fails | 2/2 | AssertionError: expected [ 1, 1 ] to deeply equal [ 1 ] |
| 131 | `supabase/tests/_shared/pipelines/qa.fresh_analysis_reuses_stale_direct.test.ts` | A | P43-01 P43-02 | pass (3) | fails | 2/3 | AssertionError: expected 'next' to be 'poll' // Object.is equality |
| 132 | `supabase/tests/_shared/pipelines/qa.metrics_summary_new_activity.test.ts` | A | P45-01 P45-02 P45-04 | pass (1) | fails | 1/1 | AssertionError: expected +0 not to be +0 // Object.is equality |
| 133 | `supabase/tests/_shared/pipelines/qa.pillar_alignment_optional.test.ts` | A | P45-01 P45-02 P45-04 | pass (1) | fails | 1/1 | AssertionError: expected undefined to be defined |
| 134 | `supabase/tests/_shared/pipelines/qa.sprout_token_retry.test.ts` | A | P45-03 | pass (1) | fails | 1/1 | Error: promise rejected "Error: token endpoint blip" instead of resolving |
| 135 | `supabase/tests/_shared/pipelines/qa.trends_filter_outage_never_retried.test.ts` | A | P44-02 | pass (1) | fails | 1/1 | AssertionError: expected 'none' not to be 'none' // Object.is equality |
| 136 | `supabase/tests/_shared/pipelines/qa.trends_hung_source_stops_week.test.ts` | A | P44-01 | pass (2) | fails | 1/2 | AssertionError: expected 'stopped' to be 'done' // Object.is equality |
| 137 | `supabase/tests/_shared/pipelines/qa.trends_region_eu.test.ts` | A | P44-03 | pass (1) | fails | 1/1 | AssertionError: expected 'EU' not to be 'EU' // Object.is equality |
| 138 | `supabase/tests/_shared/render/qa.single_weight_brand_font.test.ts` | A | P46-01 P46-02 P46-03 P46-04 P46-06 P46-07 P46-08 | pass (4) | fails | 4/4 | Error: promise rejected "Error: Google Fonts has no Bebas Neue 700…" instead of resolving |
| 139 | `supabase/tests/_shared/render/qa.v1_compose_text_layout.test.ts` | A | P46-01 P46-02 P46-03 P46-04 P46-06 P46-07 P46-08 | pass (3) | fails | 3/3 | AssertionError: expected 1490.2 to be less than or equal to 588.6 |
| 140 | `supabase/tests/_shared/render/qa.v2_emphasis_words_glued.test.ts` | A | P46-01 P46-02 P46-03 P46-04 P46-06 P46-07 P46-08 | pass (1) | fails | 1/1 | AssertionError: expected 280 to be greater than or equal to 300 |
| 141 | `supabase/tests/_shared/reports/competitivePreviousPeriod.test.ts` | A | P47-03 P47-04 P47-06 | pass (1) | fails | 1/1 | AssertionError: expected 'Acme\'s engagements 620 in March agai…' not to contain 'in February' |
| 142 | `supabase/tests/_shared/reports/facts.test.ts` | M | P47-03 P47-04 P47-06 | pass (14) | fails | 2/14 (edited tests) | AssertionError: expected [ …(2) ] to deeply equal [ …(2) ] |
| 143 | `supabase/tests/_shared/reports/nameDigits.test.ts` | A | P47-02 S5 | pass (2) | fails | 2/2 | AssertionError: expected [ Array(1) ] to deeply equal [] |
| 144 | `supabase/tests/_shared/reports/outlierMultiple.test.ts` | A | P47-03 P47-04 P47-06 | pass (1) | fails | 1/1 | AssertionError: expected 'An Instagram video post got 10 engage…' to contain '5x the platform\'s usual per pos… |
| 145 | `supabase/tests/_shared/reports/payloadReadErrors.test.ts` | A | P47-01 | pass (3) | fails | 3/3 | AssertionError: expected { report_id: 'r1', …(22) } to be an instance of Error |
| 146 | `supabase/tests/_shared/reports/promptCompareWords.test.ts` | A | P47-07 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(1) ] to deeply equal [] |
| 147 | `supabase/tests/_shared/reports/rateFactLabel.test.ts` | A | P47-03 P47-04 P47-06 | pass (1) | fails | 1/1 | AssertionError: expected 'engagement rate rose 1 points to 3%.' to contain 'reported engagement rate' |
| 148 | `supabase/tests/_shared/reports/recommendationsEmptyInsights.test.ts` | A | P48-02 | pass (1) | fails | 1/1 | AssertionError: expected [] to deeply equal [ 'Post two Reels a week.', …(1) ] |
| 149 | `supabase/tests/_shared/reports/repairStored.test.ts` | M | P45-01 P45-02 P45-04 | pass (14) | fails | 1/14 (edited tests) | AssertionError: expected { impressions_change: 18806, …(2) } to deeply equal { impressions_change: 18806, …(2)… |
| 150 | `supabase/tests/_shared/reports/textCheckHeldCompetitive.test.ts` | A | P47-05 | pass (3) | fails | 1/3 | AssertionError: expected +0 to be 1 // Object.is equality |
| 151 | `supabase/tests/_shared/socialytics-api/analyticsBadDate.test.ts` | A | P48-03 | pass (1) | fails | 1/1 | AssertionError: expected RangeError: Invalid time value to be an instance of ApiError |
| 152 | `supabase/tests/_shared/socialytics-api/setupReadyRoutes.test.ts` | A | P48-01 | pass (1) | fails | 1/1 | AssertionError: expected true to be false // Object.is equality |
| 153 | `supabase/tests/_shared/sprout/brandsSplitName.test.ts` | A | P49-03 | pass (1) | fails | 1/1 | AssertionError: expected { by: 'name', clients: [ { …(6) } ] } to be null |
| 154 | `supabase/tests/_shared/sprout/publishRulesXLinks.test.ts` | A | P49-02 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(1) ] to deeply equal [] |
| 155 | `supabase/tests/_shared/sprout/topPostsProfile.test.ts` | A | P49-01 | pass (2) | fails | 2/2 | AssertionError: expected [ 'created_time', 'perma_link', …(3) ] to include 'customer_profile_id' |
| 156 | `supabase/tests/_shared/strategy/qa.brand_name_read_as_evidence_id.test.ts` | A | P50-02 P50-03 P50-04 | pass (1) | fails | 1/1 | AssertionError: expected [ Array(1) ] to deeply equal [] |
| 157 | `supabase/tests/_shared/strategy/qa.capped_read_post_count_over_90_days.test.ts` | A | P50-02 P50-03 P50-04 | pass (1) | fails | 1/1 | AssertionError: expected 'Brand: Acme\nMarket: not set; content…' not to contain '12 posts from 2026-08-04 to … |
| 158 | `supabase/tests/_shared/strategy/qa.public_read_drops_finished_run.test.ts` | A | P50-01 P50-05 | pass (2) | fails | 2/2 | AssertionError: expected [] to deeply equal [ 'Acme' ] |
| 159 | `supabase/tests/_shared/strategy/qa.x_followers_key_mismatch.test.ts` | A | P50-02 P50-03 P50-04 | pass (1) | fails | 1/1 | AssertionError: expected { platform: 'X', …(7) } to match object { basis: 'measured', followers: 4100 } |
| 160 | `supabase/tests/_shared/thinkingRoom.test.ts` | M | P54-02 | pass (6) | **passes (proves nothing)** | 0/6 (edited tests) |  |
| 161 | `supabase/tests/_shared/trends/brandTagOvermatch.test.ts` | A | P52-01 | pass (3) | fails | 2/3 | AssertionError: expected true to be false // Object.is equality |
| 162 | `supabase/tests/_shared/trends/hashtagMarks.test.ts` | A | P52-03 | pass (3) | fails | 3/3 | AssertionError: expected false to be true // Object.is equality |
| 163 | `supabase/tests/_shared/trends/syncTermsErrors.test.ts` | A | P52-04 | pass (1) | fails | 1/1 | Error: promise resolved "undefined" instead of rejecting |
| 164 | `supabase/tests/_shared/trends/twinThemes.test.ts` | A | P52-02 | pass (2) | fails | 2/2 | AssertionError: expected 2 to be 3 // Object.is equality |
| 165 | `supabase/tests/_shared/video/advance.test.ts` | A | P53-01 | pass (4) | fails | 2/4 | AssertionError: expected { id: 'job-1', client_id: 'c1', …(13) } to match object { step: 'clip', attempts: +0 … |
| 166 | `supabase/tests/_shared/video/clip.test.ts` | M | P53-07 | pass (15) | fails | 1/1 | AssertionError: expected 'failed' to be 'running' // Object.is equality |
| 167 | `supabase/tests/_shared/video/clipStep.test.ts` | M | P53-02 P53-03 | pass (22) | fails | 6/9 | Error: Could not hand the opening frame to the video service. |
| 168 | `supabase/tests/_shared/video/compose.test.ts` | M | P53-05 P53-08 | pass (40) | fails | 2/2 | AssertionError: expected 258 to be 861 // Object.is equality |
| 169 | `supabase/tests/_shared/video/kitStep.test.ts` | M | P29-01 P29-03 P29-04 P29-05 P32-4 | pass (9) | fails | 1/9 (edited tests) | AssertionError: expected { id: 'job-1', client_id: 'c1', …(13) } to match object { Object (status, attempts, .… |
| 170 | `supabase/tests/_shared/video/sandbox.test.ts` | A | P53-04 P54-01 P54-02 | pass (10) | fails | 5/10 | AssertionError: expected { state: 'running' } to match object { state: 'failed' } |
| 171 | `supabase/tests/_shared/video/steps.sandbox.test.ts` | A | P53-04 P54-01 P54-02 | pass (5) | fails | 5/5 | AssertionError: expected 4 to be 1 // Object.is equality |
| 172 | `supabase/tests/_shared/video/titleStep.test.ts` | M | P54-03 | pass (14) | fails | 4/8 | AssertionError: expected 'title' to be 'frame' // Object.is equality |
| 173 | `supabase/tests/_shared/voice/load.test.ts` | M | P54-04 | pass (11) | fails | 1/2 | AssertionError: expected { …(6) } to deeply equal { …(5) } |
| 174 | `supabase/tests/_shared/voice/voice.test.ts` | M | P54-05 | pass (32) | fails | 1/1 | AssertionError: expected 'How Acme writes. When these disagree,…' to contain 'X: Short, dry one-liners.' |
| 175 | `supabase/tests/advance-creative-plan/stale.test.ts` | A | P37-03 | pass (2) | fails (new module) | all (load) | Cannot find module '../../functions/advance-creative-plan/stale' imported from '/workspace/old/supabase/tests/… |
| 176 | `supabase/tests/calendar-posts/lostReply.test.ts` | A | P13-01 P13-02 | pass (3) | fails | 2/3 | AssertionError: expected '2026-11-30' to be '2026-11-23' // Object.is equality |
| 177 | `supabase/tests/calendar-posts/reviseWeekResend.test.ts` | A | P56-01 P56-02 | pass (2) | fails | 1/2 | AssertionError: expected 409 to be 202 // Object.is equality |
| 178 | `supabase/tests/calendar-posts/stopPlanIntent.test.ts` | A | P05-1 P56-07 | pass (3) | fails | 2/3 | AssertionError: expected 'canceled' to be 'ready' // Object.is equality |
| 179 | `supabase/tests/design-request/canceledStaysCanceled.test.ts` | A | P56-06 | pass (2) | fails | 1/2 | AssertionError: expected 'needs_filming' to be 'canceled' // Object.is equality |
| 180 | `supabase/tests/design-request/closeFilmingOldFootage.test.ts` | A | P56-05 | pass (2) | fails | 1/2 | AssertionError: expected 'closed' to be 'needs_filming' // Object.is equality |
| 181 | `supabase/tests/design-request/feedback.test.ts` | M | P14-02 P56-01 P56-02 P56-03 P56-07 | pass (8) | fails | 2/3 | AssertionError: expected "spy" to not be called at all, but actually been called 1 times |
| 182 | `supabase/tests/design-request/footage.test.ts` | M | P56-04 | pass (6) | **passes (proves nothing)** | 0/6 (edited tests) |  |
| 183 | `supabase/tests/design-request/footageWhilePreparing.test.ts` | A | P56-04 | pass (1) | fails | 1/1 | AssertionError: expected null to be 'c1/post-9-1-2.mp4' // Object.is equality |
| 184 | `supabase/tests/design-request/noReferencePosts.test.ts` | A | P56-09 | pass (2) | fails | 1/2 | AssertionError: expected { id: 'r1', client_id: 'c1', …(11) } to match object { status: 'closed', …(1) } |
| 185 | `supabase/tests/design-request/shotBriefRetry.test.ts` | A | P56-08 | pass (4) | fails | 2/4 | TypeError: .toMatch() expects to receive a string, but got undefined |
| 186 | `supabase/tests/design-worker/pass.test.ts` | A | P57-01 P57-02 P57-06 | pass (3) | fails | 3/3 | AssertionError: expected false to be true // Object.is equality |
| 187 | `supabase/tests/get-creative-plan/refusal.test.ts` | A | P09-05 P57-03 | pass (1) | fails | 1/1 | AssertionError: expected 500 to be less than 500 |
| 188 | `supabase/tests/hub-auth-bridge/roleExactFirst.test.ts` | A | P57-04 | pass (1) | fails | 1/1 | AssertionError: expected 'Socialytics Reports' to be 'Socialytics' // Object.is equality |
| 189 | `supabase/tests/migrations/brandAssetsReplace.test.ts` | A | P06-4 | pass (2) | fails | 2/2 | AssertionError: expected 0 to be greater than 0 |
| 190 | `supabase/tests/migrations/calendarStopPlanIntent.test.ts` | A | P05-1 P56-07 | pass (6) | fails (new migration file) | all (load) | ENOENT: no such file or directory, open '/workspace/old/supabase/migrations/20261122131000_calendar_stop_plan_… |
| 191 | `supabase/tests/migrations/clientMemberNeedsRole.test.ts` | A | P24-01 P24-04 | pass (2) | fails (new migration file) | all (load) | ENOENT: no such file or directory, open '/workspace/old/supabase/migrations/20261122140200_client_member_needs… |
| 192 | `supabase/tests/migrations/storageUpsertUpdate.test.ts` | A | S1 | pass (3) | fails (new migration file) | all (load) | ENOENT: no such file or directory, open '/workspace/old/supabase/migrations/20261122131100_storage_upsert_upda… |
| 193 | `supabase/tests/migrations/videoClipUnorder.test.ts` | A | P53-02 P53-03 | pass (7) | fails (new migration file) | all (load) | ENOENT: no such file or directory, open '/workspace/old/supabase/migrations/20261122150300_video_clip_unorder.… |
| 194 | `supabase/tests/record-design-feedback/concept.test.ts` | A | P58-02 | pass (1) | fails | 1/1 | AssertionError: expected undefined to be 'A lawyer at a desk' // Object.is equality |
| 195 | `supabase/tests/research-brand-identity/modelFailure.test.ts` | A | P58-03 | pass (1) | fails | 1/1 | AssertionError: expected 502 to be less than 500 |
| 196 | `supabase/tests/run-scheduled-jobs/alertRearmed.test.ts` | A | P60-1 | pass (1) | fails | 1/1 | AssertionError: expected [ …(6) ] to deeply equal [] |
| 197 | `supabase/tests/run-scheduled-jobs/sproutOnboarding.test.ts` | M | P60-3 | pass (20) | fails | 1/1 | AssertionError: expected 'created' to be 'later' // Object.is equality |
| 198 | `supabase/tests/run-scheduled-jobs/transientError.test.ts` | A | P60-2 | pass (2) | fails | 1/2 | AssertionError: expected 'blocked' to be 'queued' // Object.is equality |
| 199 | `supabase/tests/schedule-sprout-post/otherProfile.test.ts` | A | P61-01 | pass (1) | fails | 1/1 | AssertionError: expected true not to be true // Object.is equality |
| 200 | `supabase/tests/schedule-sprout-post/send.test.ts` | M | P61-01 | pass (23) | fails | 2/23 (edited tests) | AssertionError: expected [ Array(1) ] to deeply equal [ Array(1) ] |
| 201 | `supabase/tests/sprout-analytics/readErrors.test.ts` | A | P61-04 | pass (3) | fails | 2/3 | AssertionError: expected 403 to be 500 // Object.is equality |
| 202 | `supabase/tests/video-worker/retryPause.test.ts` | A | P61-05 | pass (3) | fails | 2/3 | AssertionError: expected [ 'v1', 'v2' ] to deeply equal [ 'v2' ] |
| 203 | `supabase/functions/_shared/api/callback.test.ts` | M | P24-02 P24-03 P24-06 | pass (9) | fails | 2/2 | AssertionError: expected 'pending' to match object { status: null, …(1) } |
| 204 | `supabase/functions/_shared/api/core.test.ts` | M | P24-02 P24-03 P24-06 | pass (14) | fails | 2/2 | AssertionError: expected URIError: URI malformed to be an instance of Response |
| 205 | `supabase/functions/_shared/api/router.test.ts` | M | P24-02 P24-03 P24-06 | pass (9) | fails | 1/1 | URIError: URI malformed |
