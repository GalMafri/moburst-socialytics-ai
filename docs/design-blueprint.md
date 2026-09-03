# Socialytics design blueprint

The visual system (Intercept liquid glass, Geist, the green accent) is fixed. This document is about
composition: what each screen is for, what a reader needs first, and how the same few building blocks
are arranged so every screen feels like one product.

## Principles

1. **Numbers, then the story, then the evidence.** Every report screen opens with the KPI strip, follows
   with the written insight, and only then shows charts, per-platform cards and posts.
2. **What to do sits beside what happened.** On wide screens the recommendations live in a right-hand
   rail next to the narrative, not at the bottom of a long scroll.
3. **Nothing is hidden.** AI passages render in full. Long text is made readable by structure (bold
   lead-ins, numbered items, 16px at a 65 to 72 character measure, two columns on wide cards), never by
   truncation.
4. **One title row per screen.** Title, one line of context, meta chips, and the actions on the right.
   The top bar carries the greeting and the date only.
5. **One stat tile, one section header, one card padding.** `StatCard`, `Section` (title plus one
   line), 20px card padding, 16px inner surfaces. Grey is for 13px labels only; sentences are white.
6. **One primary action per screen.** Green button for the main action, outline for secondary, the
   rest in a menu.

## Building blocks

| Block | Component | Use |
|---|---|---|
| Page header | `PageHeader` via `AppLayout` props | Title, context line, chips, actions |
| KPI strip | `StatCard` grid | Six metrics with sign-coloured deltas |
| Section | `Section` (h2 + description) then a `Card` | Every content block |
| Passage | `Prose` | Any AI-written text; columns when long |
| Rail card | `Card` with `t-label` heading | Compact context: field position, counts |
| Action | `ActionCard` | One recommendation, source-tagged, one link |

## Screens

**Dashboard.** KPI strip for the portfolio (active clients, completed reports, this month, running),
then the client grid. A client card shows name, platforms, last report, and two actions (Analytics,
Run); everything else is in the card menu.

**Monthly report.** Tabs Overview, Content Ideas, Trends, Competitive. Overview is a two-column
composition at 1280px and up: main column with KPI strip, Key insights, period-over-period chart,
performance by platform, top posts, pillar alignment; rail with Against the field, Where to act next,
In this report. Below 1280px the rail follows the main column.

**Competitive report.** Title row with run chips and the platform filter, KPI strip, then sections
in reading order: executive summary, scorecard, the field, posting rhythm with the recommended schedule,
gaps, what wins for them, mood boards, top posts. Every section uses the same header pattern.

**Analytics.** Title row with market and language chips, range presets and export, then Performance,
Trends and Competitive tabs. Performance opens with the live KPI strip for the window, then by-profile
and top posts, then the trend chart and report history.

## Type ramp

30/36 stat, 24/30 page title, 20/26 section, 18/24 card title, 16/26 passages, 15/24 body,
13/18 labels. Body text white or `#e5e7eb`; labels `#b1b7c1`.
