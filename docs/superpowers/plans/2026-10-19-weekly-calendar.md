# Weekly calendar: build plan

Spec: docs/superpowers/specs/2026-10-19-weekly-calendar-design.md (approved by Lital 19 Oct 2026 with all four proposals: no separate trend posts and no report posts, rhythm from what the client publishes with a staff setting, hidden posts exported then deleted, platform trends stay monthly for now).

## Data (migration 20261019140000_weekly_calendar.sql, applied with query_database)

1. `calendar_plans` (client_id, week_start Monday, unique), status queued|planning|ready|failed, trigger monday|button|cutover, requested_by, evidence, rhythm, model, input_tokens, output_tokens, revisions jsonb[], pending_revision jsonb, error, timestamps. RLS: read for staff and client members; writes only through the service role.
2. `calendar_posts.plan_id` (fk, on delete set null); source check becomes plan|ad_hoc|insight (report and trend_slot rows are converted or removed at cutover).
3. `clients.social_voice` jsonb (voice profile per platform + example posts, built_at, post_count) and `clients.posting_rhythm` jsonb (staff override: platform -> posts per week; null follows what the client publishes).
4. `brand_voice_learnings`: status active|replaced, times_confirmed, last_confirmed_at, source copy_edit|revise_note, replaced_by, evidence; backfilled from confidence/source_iterations, which are then dropped.
5. `scheduled_jobs.kind` adds week_plan, week_revise, voice_profile. `occurrence` = the week's Monday for week jobs.
6. `calendar_request_week(client, week, trigger, user)`: inserts the plan (on conflict nothing) and its week_plan job, plus a voice_profile job when the client's profile is missing or older than this month's first Monday. Returns the plan.
7. `calendar_request_revision(plan, note, user, scope)`: one pending revision at a time; queues a week_revise job.
8. `enqueue_scheduled_report_jobs`: same body, plus on Mondays one calendar_request_week per active client for the following week (active = not archived, not excluded from reporting, Sprout profiles or a linked landscape).
9. Removed: calendar_posts_current, calendar_weeks, calendar_assign_week(), crons calendar-keep-planned and calendar-fill-trend-slots. Kept: calendar_post_worked(), touched_at.

## Shared code (pure parts tested with Vitest)

- `_shared/calendar/evidence.ts`: own-post scoring (median per platform and post type by impressions, 48 h settle, multiples), competitor scoring (per company and channel, engagement per follower against the last four stored weeks, likely-boosted Facebook posts out), rhythm from 8 weeks of published posts, best examples, thin-data flags, evidence ids.
- `_shared/calendar/weekPlan.ts`: plan prompt (voice block, evidence, rhythm, dates, one test at most), reply parser, reason labels built from evidence numbers plus the model's "fits" sentence.
- `_shared/calendar/runWeek.ts` (I/O): gather evidence (Sprout via collectOwnedCompetitive, rivaliq_snapshots, competitive_alerts minus dismissed, competitive_learnings, latest report findings), call the planner, insert posts, finish the plan; revise a week.
- `_shared/voice/clientVoice.ts`: loadClientVoice + voicePromptBlock (team preferences, then social voice, then brief).
- `_shared/voice/profile.ts`: voice profile prompt/parse and build.
- `_shared/voice/memory.ts`: merge prompt/parse, applyMergeOps, mergeSignal.
- Guard test: every function that writes post copy imports loadClientVoice.

## Functions

- run-scheduled-jobs: runs week_plan, week_revise, voice_profile; status labels.
- calendar-posts: plan_next_week, revise_week (members); save_copy feeds memory for human edits; old actions removed.
- regenerate-post-copy, generate-ad-hoc-post: loader + claude-opus-5-5 + anthropicMessages.
- analyze-post-edits: removed (save_copy merges).
- update-report: no calendar import, no keep_planned. fromReport.ts, plans.ts, planner.ts removed.
- design-request auto: reads calendar_posts.
- refreshFeed: stores client_company_id in the snapshot.
- api serializers: calendar field returns the client's planned posts from the report date on.

## Frontend

- calendarPosts.ts: table reads, plan types, reason helpers; no view, no trend slots.
- ClientCalendar: week header with Plan next week and Revise this week for staff and client members, plan status with polling.
- PostCard + PostPanel: reason line on the card; evidence (link, date, numbers) in the post.
- CalendarIndex, AllClientsWeek, ReportCalendarLink, ClientOverview: table reads.
- CopyEditor: no analyze-post-edits call.
- ClientSetup: learned preferences (active, times confirmed, source); posting rhythm per platform in Content strategy.
- ReportView / ContentIdeasTab: no report board for reports without one; link to the calendar.

## Cutover (in order)

1. Deploy functions and frontend with the migration's additive part applied.
2. Export the posts the view hides to storage (calendar-archive/2026-10-19-hidden-posts.json), delete them.
3. Create plan rows for every client week with plan posts; set plan_id and source plan.
4. Apply the removals (view, calendar_weeks, functions, crons).
5. Enqueue week_revise (scope empty) for weeks with empty trend posts, after Lital's OK on credits (7 calls).
6. n8n social report: drop the 7-day plan from the AI Synthesis Agent prompt and the deck's calendar slide.

## Proof

Vitest suite green; evidence packs for Bader, Moburst, Pay The Pyper with no model call; then, with OK on credits, one plan each for Moburst and Pay The Pyper and one revise on Bader; check the app as staff and as a client user.
