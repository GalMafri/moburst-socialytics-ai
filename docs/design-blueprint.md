# Socialytics design blueprint

The visual system (Intercept liquid glass, Geist, the green accent) is fixed. This document is about
composition: what each screen is for, what a reader needs first, and how the same few building blocks
are arranged so every screen feels like one product. Decisions marked (owner) were taken by the
product owner on 2026-09-03.

## What the product does

Moburst's social team runs Socialytics for its clients. Once a month it pulls each client's Sprout
Social performance, scrapes TikTok and Instagram trends, benchmarks the client against three confirmed
competitors through RivalIQ, and has AI turn that into a report the team presents and the client can
read: what happened, why, what to do next month, and a content calendar to act on it. Between reports
staff use live analytics for any date range, the competitor feed and alerts, and the content planner.

## Principles

1. **Inverted pyramid.** The most important numbers first, the story and its drivers next, granular
   detail last. A reader should get the headline within five seconds.
2. **One reading path.** Single column, sections stacked in a fixed order, a sticky section nav to
   jump. No side rails on reports; rails are for filters on dashboards, not for content.
3. **Nothing is hidden.** AI passages render in full. Long text is made readable by structure (bold
   lead-ins, numbered items, 15px at a 65 to 72 character measure, columns on wide cards), never by
   truncation.
4. **One section pattern.** Title and one line of context on a slim glass band; the content in cards
   below it (owner).
5. **One title row per screen.** Title, context line, meta chips and the actions, on a glass card that
   shares the content column's width. The top bar carries the greeting and the date only.
6. **One text size for sentences: 15px** (owner). 13px for labels and badges. Headings 24 / 20 / 18,
   stats 30. Sentences are white; grey (#b1b7c1) only for labels.
7. **One primary action per screen.** Green for the main action, outline for secondary, the rest in
   a menu.

## Building blocks

| Block | Component | Use |
|---|---|---|
| Page header | `PageHeader` via `AppLayout` props (`title`, `description`, `meta`, `actions`, `back`, `width`) | Title row |
| Section | `Section` (`src/components/ui/section.tsx`) | Band with title and one line; content below |
| Section nav | `SectionNav` | Sticky chips that jump to sections on long reports |
| KPI strip | `StatCard` grid | Six metrics with sign-coloured deltas |
| Passage | `Prose` | Any AI-written text; columns when long |
| Action | `ActionCard` | One recommendation, source-tagged, one link |

## Monthly report: composition and why

Order of the Overview tab, following the reporting convention used by Sprout Social, Rival IQ,
Hootsuite and the agency reporting guides (executive summary, platform overview, deep dive, content
highlights, recommendations):

1. **At a glance**: six KPI tiles, this period against the previous one.
2. **Highlights**: the month-over-month summary and the numbered key insights, plus top performing
   content types. The "why" behind the numbers.
3. **Against the field**: benchmark score, share of voice, cadence, with the link to the Competitive tab.
4. **Period-over-period performance**: the comparison chart.
5. **Performance by platform**: one card per connected account, every insight shown.
6. **Top posts**: by impressions and by engagement, with a platform filter.
7. **Content pillar alignment**.
8. **Where to act next**: every recommendation with its evidence link, closing the report.
9. **In this report**: data counts, as a footer band.

Other tabs stay: Content Ideas, Trends, Competitive.

Sources consulted: Sprout Social Profile Performance Report documentation (performance summary, audience
growth, top posts), Rival IQ reporting template and landscape features (at-a-glance stats, scorecard,
top posts grid), Hootsuite and Sprout Social reporting guides (executive summary to recommendations
order), and dashboard design guidance (inverted pyramid, KPI row, grouped sections, five-second rule).

## Other screens

**Dashboard.** KPI strip for the portfolio, then the client grid. A client card shows name, platforms,
last report, and two actions (Analytics, Run); everything else is in the card menu.

**Competitive report.** Title row with run chips and actions, platform filter, KPI strip, then sections
in reading order: executive summary, scorecard, the field, posting rhythm with the recommended
schedule, gaps, what wins for them, mood boards, top posts.

**Analytics.** Title row with market and language chips, back link, range presets and export in the
header. Performance opens with the live KPI strip for the window, then by-profile and top posts, then
the trend chart and report history.

**Forms (setup, run, settings).** A narrower column (max-w-4xl or 5xl) shared by header and content,
one primary action in the header.
