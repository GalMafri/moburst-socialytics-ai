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
2. **One reading path.** Single column of content, sections stacked in a fixed order, with a
   section rail down the left to jump between them. The rail is navigation, never content: it is
   `AppLayout`'s own left column (pass `nav`), so it starts level with the page header and the
   header and every card below it keep one left edge — never a column wedged inside the content,
   which pushes the page right of its own header. Pass it on every tab of a page that has it on
   any tab, so nothing shifts sideways when the tab changes. Below `xl` there is no room for a
   column, so it becomes a plain row at the top that scrolls away with the page.
   The rail is a spine, not a panel: a hairline with a dot per section, no fill and no card, in
   `AppLayout`'s own 180px column, and the page widens to 1660 to pay for it rather than taking
   the width out of the report.

3. **Numbers as numbers.** Where a passage recites figures the report already holds, render the
   figures: a stat beside the sentence, a row of posts with their engagement, a peak read off the
   same counts the chart draws. Prose earns its place when it makes a claim, not when it reads a
   table aloud. Hiding a wall behind a toggle is not a fix.

4. **Nothing is hidden.** A passage that makes a claim renders in full, made readable by structure
   (bold lead-ins, numbered items, figures in white, 15px at a 65 to 90 character measure), never by
   truncation and never behind a control. A passage that only reads the page's own figures aloud is
   replaced by those figures — that is rule 3, and it is not the same as hiding it. Verbatim source
   text a reader can open at its source (a post caption) may be clamped, because the full text is
   one click away.
5. **One section pattern.** Title and one line of context on a slim glass band; the content in cards
   below it (owner).
6. **One title row per screen.** Title, context line, meta chips and the actions, on a glass card that
   shares the content column's width. The top bar carries the greeting and the date only.
7. **One text size for sentences: 15px** (owner). 13px for labels and badges. Headings 24 / 20 / 18,
   stats 30. Sentences are white; grey (#b1b7c1) only for labels.
8. **One primary action per screen.** Green for the main action, outline for secondary, the rest in
   a menu.

## Building blocks

| Block | Component | Use |
|---|---|---|
| Page header | `PageHeader` via `AppLayout` props (`title`, `description`, `meta`, `actions`, `back`, `width`) | Title row |
| Section | `Section` (`src/components/ui/section.tsx`) | Band with title and one line; content below |
| Overlay | `Dialog`, `Sheet`, `AlertDialog` | The card's material over an 85% scrim, never a flat panel; menus and selects stay near-opaque |
| Section nav | `SectionNav` | Left rail that jumps to sections on long pages; drops sections that have no data, and shows nothing at all below two |
| KPI strip | `StatCard` grid | Six metrics with sign-coloured deltas |
| Passage | `Prose` | Any AI-written text; a briefing list when its paragraphs are labelled, columns when long |
| Action | `ActionCard` | One recommendation, source-tagged, one link |

## Monthly report: composition and why

Order of the Overview tab, following the reporting convention used by Sprout Social, Rival IQ,
Hootsuite and the agency reporting guides (executive summary, platform overview, deep dive, content
highlights, recommendations):

1. **At a glance**: six KPI tiles, this period against the previous one.
2. **Highlights**: the month-over-month summary and the numbered key insights, plus top performing
   content types. The "why" behind the numbers.
3. **Where to act next**: every recommendation with its evidence link. It sits third, not last: the
   reader who stops after the headline still leaves with the actions.
4. **Against the field**: benchmark score, share of voice, cadence, with the link to the Competitive tab.
5. **Period-over-period performance**: the comparison chart.
6. **Performance by platform**: one card per connected account, every insight shown.
7. **Top posts**: by impressions and by engagement, with a platform filter.
8. **Content pillar alignment**.

**In this report** closes the page as an unnumbered footer band carrying the data counts.

Other tabs stay: Content Ideas, Trends, Competitive.

Sources consulted: Sprout Social Profile Performance Report documentation (performance summary, audience
growth, top posts), Rival IQ reporting template and landscape features (at-a-glance stats, scorecard,
top posts grid), Hootsuite and Sprout Social reporting guides (executive summary to recommendations
order), and dashboard design guidance (inverted pyramid, KPI row, grouped sections, five-second rule).

## Other screens

**Dashboard.** KPI strip for the portfolio, then the client grid. A client card shows name, platforms,
last report, and two actions (Analytics, Run); everything else is in the card menu.

**Competitive report.** Title row with run chips and actions, platform filter, KPI strip, then sections
in reading order: executive summary, since the last report (movements against the previous
comparable report on the same landscape: cadence, engagement, channels entered or left, format
shifts, companies that went quiet), scorecard, the field, audience and momentum (RivalIQ's own
period totals per company against the previous period: followers, engagement, estimated
impressions, posts, likely boosted Facebook posts), posting rhythm with the recommended schedule,
gaps, what wins for them, mood boards, top posts. Chapter numerals follow the sections present.

**Competitor feed.** Trends this week, since last week (the same movement cards against the
previous weekly pull, only when the two pulls cover different weeks), filters, posts.

**Analytics.** Title row with market and language chips, back link, range presets and export in the
header. Performance opens with the live KPI strip for the window, then by-profile and top posts, then
the trend chart and report history.

**Forms (setup, run, settings).** A narrower column (max-w-4xl or 5xl) shared by header and content,
one primary action in the header.

## Accessibility and copy rules (settled in the final QA pass, 2026-09-07)

Audited with axe-core on every page; these are the rules that keep it clean.

- **The sidebar inset carries `min-w-0`.** It is the flex item, and a flex item's automatic minimum
  is its content's min-content width, so a wide table anywhere below it widens the whole page on a
  narrow screen. Never remove it; put `min-w-0` on any new flex or grid column that can hold a table.
- **One control per control.** A card is a surface. If it holds buttons, the card itself is not a
  button; the title is the thing that opens it. `ClickableCard` is only for cards with nothing
  interactive inside.
- **Negative text is `#f87171`, never `text-destructive`.** The button red (hsl 0 70% 50%) is 3.5:1 as
  text on this ground. Positive stays `text-success`.
- **Brand colour on the icon and the edge, words in white.** LinkedIn blue and Instagram red fail
  contrast as text here; a `PlatformBadge` shows the platform by its icon and tint.
- **Small grey is `#9ca3af` at the darkest.** `#6b7280` fails at 13px.
- **Card titles are `h2`** (styled `t-h3`). The page title is the only `h1`; sections are `h2`; inside
  a section, sub-blocks are `h3`. No level is skipped.
- **Every click target is at least 24px tall**, including text links (`inline-flex items-center
  min-h-[24px]`).
- **One `<main>`.** `SidebarInset` renders it; `AppLayout` renders a `div`.
- **Sentence case** for headings, tabs and buttons ("Report history", "Run analysis"). Form field
  labels keep Title Case as their own convention.

## Generated designs (settled 2026-09-07)

- **The image model draws pictures, the app types the words.** Designs are picture-only by
  default (`render_text: false`): the prompt asks for a calm upper third and a quiet spot for a
  button, and the editor opens with the post's headline and call-to-action already set in the
  brand's typeface, loaded from Google Fonts and used for both preview and export. Letting the
  model draw the words is a switch a reviewer turns on, because it misspells and invents lettering.
- **No letterforms that are not words of the message.** No logos, wordmarks, monograms, or a large
  initial as a watermark. The client's real logo is a compositing job, never a drawing job.
- **One accent colour, from the palette.** The call-to-action wears the brand accent and nothing
  else does; no colour enters that the design language does not name.
- **Reject and learn.** A rejected variant is hidden and its reason becomes one or two avoid/prefer
  rules in `design_learnings`, read into every later prompt for that client right after the brand
  language. Archive hides without teaching. Both are staff actions, like approval.
