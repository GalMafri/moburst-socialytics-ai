# Seasonal posts that fit, and report insights from the data

Status: design, 3 Nov 2026. Nothing is built. Lital approved both fixes on 3 Nov.

Read for this note: the calendar planner (`supabase/functions/_shared/calendar/`), the voice memory, the Trends profile, the content strategy block, both report pipelines, `_shared/reports/`, the report screens, and the Anthropic API docs bundled with Claude Code for Opus 5.5 and Sonnet 5.5. Not read: the database, the two 23 Sep reports, n8n, Sprout. The 23 Sep note doesn't say which report kind differed, so part 2 covers both.

## Decisions for Lital

1. Sensitive moments are civic or political, religious, remembrance or tragedy, and conflict or disaster. A brand is part of that space when its pillars, strategy or brief name it, or it posted on that same moment last year. Right list, right proof? (An Israeli brand that posted a Rosh Hashanah greeting last year would be offered it again.)
2. A removed seasonal post blocks that moment for the client from then on. Two removals in one category, with no seasonal post of that category kept through its week, block the category. Agree?
3. Report insights worded by Sonnet 5.5 (about $0.06 a report) or Opus 5.5 (about $0.12)?
4. After go-live, rewrite the insights of stored reports (69 social reports by 20 Oct, plus [competitive report count]), or only reports from go-live on?

## 1. Seasonal posts that fit the client

### Today

- The planner picks moments from its own knowledge. Its one rule: a holiday, awareness day or industry event "that matters in the client's market this week can carry a post", no evidence needed (weekPlan.ts:120). Its context is `Market:` from `clients.geo` (runWeek.ts:451) plus pillars, strategy and voice, in the same call that writes the posts.
- No code checks the choice: `parseWeekPlan` keeps any post the model calls seasonal (weekPlan.ts:157-163), and the reason shows the model's own moment and fit text (reasonText.ts:126-138). That is how Moburst got a LinkedIn post for US Election Day.
- A removal teaches nothing. Staff delete posts straight from the browser (CalendarPostActions.tsx:48-60); the memory learns only from copy edits and Revise notes (voice.ts:273-275).

### Where moments come from

- A new shared weekly job, `moments_list`, makes one Sonnet 5.5 call with web search per country in any active client's market. It lists the next five weeks' moments: name, date, last year's date, country or global, category, and the source link. Code keeps a moment only with a link and a date in range, in a new `moments` table. (My call.)
- Categories: public holiday, cultural or commercial, awareness day, sports, civic or political, religious, remembrance or tragedy, conflict or disaster. The last four are sensitive.
- Industry events reach the plan as competitor topics or trend themes, which carry evidence already. They are never moments. (My call.)

### How each moment is judged

A new job, `week_moments`, runs before `week_plan`, which waits for it as it waits for the voice profile (runWeek.ts:328). The result is kept on the plan (`calendar_plans.moments`). If the job runs out of tries, the week is planned with no moments.

1. Code drops, with no model call, any moment outside the client's countries (`clients.geo`, else the headquarters country in `clients.location`, else global moments only), outside the week, removed before by this client, or in a blocked category. A sensitive moment is dropped unless the client's own data shows it belongs to that space (decision 1).
2. Code gathers each remaining moment's evidence: the client's own posts from that moment last year (one Sprout read of last year's date ±7 days, posts matched on the moment's name or hashtag, scored against that window's median for the platform and format with the ratio at evidence.ts:147, early signal under 5 posts); competitor posts in the stored feeds that name it, per company; the pillars, brief, the strategy's audience, positioning and what to avoid, the trend profile's audience, fit rubric and exclusions, the voice summary and preferences.
3. One Sonnet 5.5 call keeps or drops each moment with a reason (off brand, wrong audience, sensitive, no angle). A keep carries one client-facing sentence on why it fits, citing pillar names or post ids.
4. Code checks the answer: cited pillars exist, cited posts were in the input, and a sensitive moment stays only on the client's own evidence. Competitors posting about it are never proof. A failed keep is dropped. (My call.)

For Moburst, US Election Day is civic or political, so step 1 drops it unless Moburst's own pillars, strategy, brief or past posts are about elections. The ad-auction angle can't bring it back.

### What the planner and the post show

- Kept moments become evidence items M1, M2 with their numbers. The rule at weekPlan.ts:120 becomes "a seasonal post cites one M id"; `parseWeekPlan` drops a seasonal post without one and notes it in the plan's evidence for staff. (My call.)
- The moment's name and date come from the evidence, never the model. `evidenceSentence` gets a moment case: "Halloween, Oct 31. Your Instagram reel for it last year got 2.3x your usual engagement." Without history it gives the competitor count or the moment alone, then the judge's fit sentence under the `clientFit` rules. Saved reasons keep their label.

### What a removal teaches

- An after-delete trigger on `calendar_posts`: when a signed-in person deletes a planned seasonal post, it writes a `moment_removals` row (client, moment key, category, who, when) and queues a `moment_feedback` job. It can never fail the delete. (My call.)
- The job sends a new memory signal, `moment_removed`, to `learnFromSignal`, so the memory can add or confirm a topics preference such as "Skip civic and political moments". The planner reads it through the voice block; the judge reads it too.
- In code, a removed moment key ("us:election-day", no year) is never offered to that client again, and categories block per decision 2.

### What the check costs

`moments_list`: about 10K input and 3K output tokens per country per week, about $0.05 plus Anthropic's web search charge per search (rate not checked here), shared by the country's clients. `week_moments`: about 8K in and 3K out per client per week, about $0.05 (about $2.60 a client a year), and no call when step 1 leaves nothing. `moment_feedback`: under $0.01 per removal. These are estimates from prompt sizes; the first Moburst run measures them.

## 2. Report insights from the data

### Today

- The numbers are worked out in code: month-over-month changes in the social aggregate (social/nodes.ts:323-327, 480-510), comparison metrics in the competitive one (competitive/aggregate.ts:195, reportMetrics.ts:312). That is why the two reports' numbers matched.
- The insights come from one Opus 5.5 call at effort high (n8n's prompts, ported) that reads all the data and picks which facts matter: the social synthesis (social/analysis.ts:45-60, 85-95) and the competitive analysis (competitive/analysis.ts:122-130). Each run can pick differently, and inputs that move between runs (team preferences, suppressed insights, aggregate.ts:115) change the text too. n8n's agents work the same way.
- No sampling setting fixes this. Opus 5.5 rejects `temperature`, `top_p` and `top_k` with a 400, Sonnet 5.5 rejects non-default values, and API version 2026-10-21 rejects all three on every model; the docs note temperature 0 never gave identical output. Opus 5.5 can't turn thinking off; effort is the only depth control.
- `report_text` already harvests every figure a report shows and refuses a rewrite that adds one (reportText.ts:63, 135, 422).

### Facts first, in code

A new pure module, `reports/facts.ts`, reads the figures a report shows (`socialFigures`, `competitiveFigures` "shown"), the same for n8n and in-app reports, and lists:

- changes: current against previous, absolute and percent, overall and per platform (`calcChange`);
- rankings: the client's place among its competitors on each comparison metric, with the leader and the set median;
- outliers: posts far above or below their account's median for the platform and format (evidence.ts:147);
- shares: each platform's share of engagements and impressions, each pillar's share of posts.

A change is a finding when it exceeds the client's usual month-to-month swing in that metric (the median absolute change across its stored reports); with fewer than three earlier reports, the five largest changes are kept. (My call.) Facts are sorted by score, then a fixed key (kind, platform, metric, company), and numbered F1, F2. No clock, object order or model touches the list.

### The model only words them

- One call (decision 3) gets the numbered facts and returns the insight fields the screens use today, each with its fact ids, through structured outputs (`output_config.format`) at effort medium. The competitive call also gets the post sample its style fields describe and the team's verdicts. Recommendations cite at least one fact; insights are ordered by their first fact. (My call.)
- Code checks the answer: ids exist, every number written is a cited fact's value at that precision, and "rose", "fell", "up" and "down" match the sign. A failed answer is asked once more with its problems named; a second failure shows the facts as sentences written in code ("Impressions rose 26.5% to 12,400."). Nothing on screen says anything failed.
- Same data, same insights: answers are stored in a new `report_insights` table under a hash of the exact input (facts, sample, verdicts, prompt version, model). A stored hash is reused with no call. When the input changes, such as a hidden gap, a new answer is written over the same facts.
- Under each insight, a "Based on" line built in code shows its numbers ("Impressions 12,400 in October against 9,800 in September, +26.5%, from Sprout"). Ids never show. A gap's verdict keys on its facts instead of its words (useInsightFeedback.ts:34), so rewording keeps it. (My call.)

### Landing after 7 Nov

- Before 7 Nov nothing report-related deploys: `social_v1`, `competitive_v1`, the report screens and n8n stay as they are, and the 7 Nov replays of ee82b373 and 6d9f301c run on unchanged code.
- After the comparison, `report_text` queues `report_insights` when it finishes, for both engines' reports. The screens (ReportView.tsx:344-345, CompetitiveReportView.tsx:725-731, CompetitiveSnapshot.tsx:134, Analytics.tsx:261-263) show them in place of the model's fields, which stay stored untouched, as Trends did on 28 Oct. The calendar's report findings (runWeek.ts:264) read them too.
- Until the social report leaves n8n, n8n's Gamma deck keeps its own wording. The in-app deck step moves to `report_insights` with Trends task 16.
- Part 1 can ship before 7 Nov; its `run-scheduled-jobs` deploy carries the existing guard (`npm test` and both free replays matching).

Cost: about $0.06 a report on Sonnet 5.5 (10K in, 4K out) or $0.12 on Opus 5.5, nothing for a stored hash, at most double with the retry.

## Tests

- `calendar/moments.test.ts`: the filter drops wrong country, wrong week, a removed key and a blocked category, and keeps a global day; Election Day is dropped before any call for a Moburst fixture with no political evidence and kept for one with its own Election Day post last year; early signal under 5 posts; the answer check drops unknown pillars or post ids and a sensitive keep resting on competitors only.
- `weekPlan.test.ts`, `reasonText.test.ts`: M items listed, no free-moment rule, a seasonal post without an M id dropped, moment maps to seasonal; moment sentences with and without history, no ids, old labels unchanged.
- `runWeek.test.ts`, `voice.test.ts`: the plan waits for `week_moments` and goes on without moments when it runs out of tries; `mergePrompt` handles `moment_removed`; `copyWritersUseVoice.test.ts` covers the judge.
- Migration test: a person's delete of a seasonal plan post writes `moment_removals` and queues `moment_feedback`; a service delete or other post does neither; a failing insert never blocks the delete.
- `reports/facts.test.ts`: the same report twice, or with shuffled arrays, gives equal facts and ids; n8n and in-app reports with the same figures match; the threshold comes from the client's history, with the fallback under three reports.
- `reports/insights.test.ts`: refuses an uncited number, an unknown id, a direction against the sign; the template covers every fact; a stored hash makes no call and returns identical words; a changed verdict makes a new hash over the same facts.
- Screens: `report_insights` shown with "Based on" lines when present, old fields otherwise; a reworded gap keeps its verdict.
- 7 Nov guard: `npm test` and the free replays of ee82b373 and 6d9f301c match before any report-related deploy.

## Files

- New, part 1: `_shared/calendar/moments.ts` (+ test), `_shared/calendar/runMoments.ts` (the three jobs), `supabase/migrations/20261110100000_seasonal_moments.sql` (`moments`, `moment_removals`, `calendar_plans.moments`, the delete trigger, job kinds, `moment_removed` as a memory source).
- Changed, part 1: `calendar/evidence.ts`, `calendar/weekPlan.ts`, `calendar/reasonText.ts`, `calendar/runWeek.ts`, `voice/voice.ts`, `voice/load.ts`, `run-scheduled-jobs/index.ts`, `calendar-posts/index.ts` (`preview_evidence` shows judged moments).
- New, part 2: `_shared/reports/facts.ts` and `_shared/reports/insights.ts` (+ tests), `supabase/migrations/20261110110000_report_insights.sql`, applied after 7 Nov.
- Changed, part 2, after 7 Nov: `reports/correctText.ts`, `calendar/runWeek.ts` (findings), `src/pages/ReportView.tsx`, `src/pages/CompetitiveReportView.tsx`, `src/components/competitive/CompetitiveSnapshot.tsx`, `src/pages/Analytics.tsx`, `src/hooks/useInsightFeedback.ts`, `_shared/reports/payloads.ts`, `pipelines/social/nodes.ts` (deck, with Trends task 16).
