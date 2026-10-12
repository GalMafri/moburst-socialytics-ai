# Self-serve design: review and fix plan

This is a review only. No code changes are made by this plan. Where something below was not checked in source, it says so.

## Verdict

The parts that judge and deliver (the measured checks, the human pick, the move into scheduling) are sound. The part that makes the designs is not. Today the client almost always ends up with nothing, because:
- the brand profile is learned from all of a client's channels and applied to any one post;
- a picture model is asked to draw content it can't be trusted with;
- the planner can talk itself out of every option.

There are also two permission holes, and the run lease has no ownership check. Fix those before any further work on output quality.

## Answers to the five questions

1. **Architecture.** Keep the checks, the pick and the delivery. Change how the first design is made: start from the client's own top posts on the same platform, recompose them with the new copy, then place the real logo file. Your earlier test showed this approach keeps both the composition and the copy. Use the agent loop as the repair step, not as the primary generator. Drop the request for new photos from the picture model as the default. Use it only when the chosen layout has a picture slot and the platform's own imagery supports one.
2. **When nothing passes.** Never end on "dropped" in front of the client. Always deliver a guaranteed fallback: a text-only card built from the brand's colours, fonts and real logo, and checked by the same gate. It already works for video. If even that fails, show "Our team is finishing this one" and alert staff. Keep the technical reason for staff only.
3. **Frontend.** There is double polling, the post key is fragile, there is no realtime, and the progress panel shows stale information. Details are in item 9.
4. **Server.** Clients can set their own run budget and edit option files. The lease has no owner, uploads are unscoped, and a reject after a pick leaves the design attached to the post. Details are in items 1–4.
5. **Video.** It's missing a sound bed, a caption file, platform-safe lengths and a real moving shot, and the client can't preview it before picking. Details are in item 10.

## Prioritized fixes

1. **The client controls the run budget (cost hole).**
   - Where: `supabase/migrations/20261012100000_design_runs.sql`, the policy "Client members and staff can queue design runs".
   - What's wrong: it only checks `status = 'queued'` and `created_by`. A client can insert their own `budget`, `sizes`, `platform`, `format` and `copy`, and can insert as many rows as they like.
   - Fix (new migration): add a BEFORE INSERT trigger on `design_runs` that resets `budget`, `spent`, `plan`, `attempts`, `lease_until` and `sizes` to server defaults. It should also accept `platform` and `format` only from a fixed list, cap `copy` length, and refuse a new run while one is still queued or running for the same client, post and kind. Add a per-client daily cap on runs.
2. **Clients can rewrite option files.**
   - Where: the policy "Client members and staff can pick design options" grants UPDATE on every column. `design_rules` has the same problem.
   - Fix: revoke UPDATE from signed-in users on `design_options` and `design_rules`, and route every change through `design-pick` (already service role). Also add a rule-retire operation to `design-pick`.
   - Not checked: the 20261012120000 video migration may have changed these policies.
3. **The lease has no owner, so two workers can finish the same run.**
   - Where: `design_runs_lease`, `design_runs_extend`, and `design-store` ops `extend`, `finish`, `write_options` and `upload`. `LEASE_SECONDS = 300` in `engine/design_engine/worker/main.py`.
   - What's wrong: `design_runs_lease` takes back any running run whose lease expired. The heartbeat only runs once per model turn, and a turn can take longer than 300 s. After that, `finish` and `write_options` from the first worker still succeed.
   - Fix:
     - Add a `lease_token uuid` that is set on lease.
     - Require the matching token on `extend`, `finish` and `write_options`, and refuse any of them on a mismatch.
     - Heartbeat on a timer every 60 s, not once per turn.
     - Raise the lease to 900 s.
     - Make `write_options` idempotent with a unique constraint on (`run_id`, `option_key`).
4. **design-store and design-pick edge cases.**
   - `design-store` `upload`: the path is built from caller-supplied `client_id`, `run_id` and `name` with `upsert: true` on a public bucket. Check that `run_id` belongs to `client_id`, that the run is leased by the caller, and that `name` matches `^[A-Z0-9._-]+$`.
   - `design-store` `seed_profile`: confirm it can't overwrite a confirmed profile without a version bump (not read in this review).
   - `design-pick`, reject after pick: it is allowed, but the `post_iterations` row stays attached. Archive `picked_iteration_id` when a picked option is rejected.
   - `design-pick`, second pick: picking a second option doesn't release the first one. Mark the other options in the run as not picked, or refuse the second pick.
   - `design-pick`, slide order: carousel slides are ordered by the `option_key` text, so "A.10" sorts before "A.2". Order by a numeric slide index instead.
   - `design-pick` CORS: the headers lack `Access-Control-Allow-Methods`. This works today, but it's fragile.
5. **Apply the brand profile per platform, not across all channels (the beer-and-bar problem).**
   - Where: `engine/scripts/learn_client.py` and `engine/design_engine/learn/profile.py`.
   - Fix: learn families, imagery and palette per platform from that platform's posts. Store imagery as *allowed subject categories*, not literal scene descriptions. In `engine/design_engine/picture/brief.py`, stop pasting the learned imagery text into prompts. Use only the category and an explicit "no people holding products, no text, no signage, no jerseys" list.
   - Add a sector guard to the brief, for example legal or healthcare means no alcohol, sport celebrations or party scenes.
6. **Make the first design from the client's own posts.**
   - Where: `engine/design_engine/run/loop.py` and `run/tools.py`.
   - Fix: add a `recompose` tool that takes one of the client's top posts on the same platform as the layout and picture reference, swaps in the new copy, and composites the real logo file. Try it first. Fall back to the current plan, picture and compose path only after it fails the gate. The building blocks for recomposing whole posts already exist in `supabase/functions/_shared/design-prompts/wholePost.ts`. Reuse that logic in the worker, or call it.
7. **Guarantee a deliverable (the fallback).**
   - Where: `engine/design_engine/worker/main.py`, where `status = "offered" if result.options else "dropped"`.
   - Fix: when nothing is offered, render the text-only brand card through the same compose and gate path and offer it as option "T". Set `status = 'dropped'` only if that also fails. In that case, write `failure` for staff and a separate client-facing `plan.message`, and alert staff (an n8n check on `design_runs_status().failed_today`).
   - `DesignTab.tsx` failure block: show "Our team is finishing this design; you'll see it here", never the gate reason.
8. **Stop the self-test from emptying the carousel cover role, and run pictures in parallel.**
   - Where: `engine/design_engine/learn/selftest.py` and the carousel planner in `run/tools.py`.
   - Fix: if the self-test removes every family a role allows, keep the best-scoring one and record a warning, rather than leaving the role empty. Fix the typographic families' rendering, which is a template bug, not a brand fact. Also run the picture requests in a turn concurrently, with a per-turn wall-clock limit below the heartbeat.
   - Logo check failing on landscape: in the compose templates, reserve the logo's clear-space rectangle and make the subline wrap or shrink inside its slot, never grow into the logo area.
9. **Frontend: polling, post keys, the Design tab and the progress panel.**
   - `DesignTab.tsx` polls on its own every 10 s, and `DesignRunsContext.tsx` also polls every 8 s, so it's double work and the two can briefly disagree. Have the tab read its run from the shared state and fetch options only when the shared status changes.
   - Switch the shared state to a realtime subscription on `design_runs`, filtered by `client_id`, with polling kept only as a fallback. Realtime is already used for reports.
   - `DesignTab.tsx`, `create`: it inserts runs from the browser. Move this to a `design-queue` edge function so item 1 is enforced in one place.
   - `useEffect` dependency lists in `DesignTab.tsx` miss `load`, so a client switch can show the previous client's run. Reset `run` and `options` when `postKey` changes.
   - Post key (`calendarRevision.ts`, `calendarWithRevisions`): the key is a JSON string of report, day and position indexes plus the copy. If a report is regenerated or reordered, the post gets a new key and its runs are orphaned. `DesignRunsDock.tsx` also parses this string to build titles. Store `post_key` together with a separate `report_id` and `post_index` on `design_runs`, and take the dock's titles from `postByKey` only.
   - `DesignRunsContext.tsx`: the `.limit(200)` query without a report filter on the client view will silently drop old runs. Filter by report always.
   - The dock's "recent" window uses the browser clock against `created_at`. Use `finished_at`.
10. **Video as a real deliverable.**
    - Where: `engine/design_engine/video/make.py`, `video/broll.py` and `engine/video` (Remotion).
    - Add:
      - a licensed music bed with loudness normalised to -14 LUFS, with a mute option;
      - burned-in and SRT captions;
      - per-platform length and size presets (9:16 for Reels and Shorts, 1:1 and 4:5 for the LinkedIn and Instagram feeds);
      - a branded end card with the logo and call to action;
      - safe zones per platform interface.
    - Make the b-roll come from the client's own footage or brand-safe stock first; Higgsfield last.
    - In `DesignTab.tsx`, render a `<video>` element with the poster image so the client can watch before choosing "Use this one".
    - Confirm that `schedule-sprout-post` media upload handles MP4 size and length limits (not checked).
11. **Health monitoring.** Add an hourly check on `design_runs_status()` that alerts on runs that are stuck, or on any client whose runs drop more than half the time over 24 h. Also record the cost per offered option from `spent`, so the cost of a client's design that the client actually uses is visible.

## Order of work

```text
Now:    1, 2, 3, 4       (permissions and the lease)
Next:   7, 5, 8           (the client always gets something on brand)
Then:   6                 (making designs from the client's own posts)
After:  9, 10, 11
```

## Technical notes

- Items 1–3 need one new migration: an insert trigger, revoking UPDATE, a `lease_token` column, and new versions of `design_runs_lease`, `design_runs_extend` and `finish`. The migration also needs a unique constraint on (`run_id`, `option_key`). `design-store` and the worker's `BridgeStore` must send the lease token.
- Claims checked in source for this review:
  - the insert and update policies;
  - `LEASE_SECONDS = 300` and heartbeats sent per model turn;
  - the dropped-status path in `worker/main.py`;
  - the post-key construction;
  - the dock parsing the post key;
  - the two polling loops;
  - `design-pick` slide ordering and reject behaviour;
  - the `design-store` upload path.
- Not checked: the `tools.py` internals, `selftest.py` logic, `brief.py` prompt assembly and the video migration's policy changes. Those items rest on your production description.
