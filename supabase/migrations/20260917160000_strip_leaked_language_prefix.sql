-- Content ideas were being shown to clients with "language: en" glued to the
-- front of the copy.
--
-- Cause, fixed upstream in the n8n workflow rather than here: the synthesis
-- agent's system message orders "EVERY post MUST include a 'language' field
-- with the ISO language code", while the structured output schema's post
-- object declared only platform, format, pillar, posting_time, copy, hashtags,
-- visual_direction, ai_visual_prompt and rationale. Told to emit a field the
-- schema had no room for, the model wrote it into the one free-text field it
-- had. The schema now declares `language`, so new runs put it where it belongs.
--
-- This cleans the 20 rows already stored (two clients, generated between
-- 2026-04-16 and 2026-09-10, every one with source='calendar').
--
-- The pattern is deliberately narrow: a leading line that is one of the known
-- schema field names, a colon, and a short value, ending at the line break.
-- Copy that merely opens with a word and a colon is untouched, which matters
-- because real posts start "Fact:", "Tip:", "VA loan myth:" and
-- "3 VA loan facts in 30 seconds:" all the time. Verified against the live
-- rows before running: every one loses only the field line.
UPDATE public.post_iterations
SET post_copy = regexp_replace(
      post_copy,
      '^[ \t]*(language|platform|format|pillar|posting_time)[ \t]*:[ \t]*[^\n]{0,60}(\n|$)',
      '',
      'i'
    )
WHERE post_copy ~* '^[ \t]*(language|platform|format|pillar|posting_time)[ \t]*:';
