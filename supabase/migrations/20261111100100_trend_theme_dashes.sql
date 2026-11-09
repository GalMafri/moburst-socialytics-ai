-- Trends: the weekly themes stored before the theme writer's dash rule.
-- Plan: docs/superpowers/plans/2026-10-29-trends-redesign.md (Task 16 review).
--
-- Since 9 Nov 2026 the theme writer stores no em or en dash in a theme's
-- title, what is happening, why it matters or the angle
-- (_shared/trends/themes.ts, by withoutDashes in _shared/trends/text.ts).
-- Themes written before still carry some (2 of 102 rows on 11 Nov). This
-- cleans them once, by the same rule, in the same order:
--   1. a dash between two numbers becomes "to" (3 to 5);
--   2. a dash that opens the text goes;
--   3. a dash that ends the text goes;
--   4. a dash before a capital letter is a sentence break (". ");
--   5. any other dash is a comma (", ");
--   6. punctuation doubled by that (".." or ",,") is written once;
--   7. runs of spaces or tabs become one space, and the text is trimmed.
-- Only rows with a dash in one of the four fields change. Nothing cleans at
-- read time: new themes are clean when written. Safe to apply twice: a
-- cleaned row has no dash left, so a second run changes nothing.
--
-- The dashes are written as chr(8211) (en dash) and chr(8212) (em dash).

create or replace function pg_temp.trend_text_without_dashes(t text)
returns text
language plpgsql immutable as $$
declare
  d constant text := '[' || chr(8211) || chr(8212) || ']';
  s text := t;
begin
  if s is null then return null; end if;
  s := regexp_replace(s, '(\d)\s*' || d || '\s*(?=\d)', '\1 to ', 'g');
  s := regexp_replace(s, '^\s*' || d || '+\s*', '');
  s := regexp_replace(s, '\s*' || d || '+\s*$', '');
  s := regexp_replace(s, '\s*' || d || '+\s*(?=[A-Z])', '. ', 'g');
  s := regexp_replace(s, '\s*' || d || '+\s*', ', ', 'g');
  s := regexp_replace(s, '([.,!?;:])[.,]\s', '\1 ', 'g');
  s := regexp_replace(s, '[ \t]{2,}', ' ', 'g');
  return regexp_replace(s, '^\s+|\s+$', '', 'g');
end $$;

update public.trend_themes
   set title = pg_temp.trend_text_without_dashes(title),
       happening = pg_temp.trend_text_without_dashes(happening),
       why_it_matters = pg_temp.trend_text_without_dashes(why_it_matters),
       angle = pg_temp.trend_text_without_dashes(angle)
 where concat_ws(' ', title, happening, why_it_matters, angle) ~ ('[' || chr(8211) || chr(8212) || ']');
