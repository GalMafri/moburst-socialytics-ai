Migrations held back from supabase/migrations until a person approves them.

20261029100100_trend_refresh_job.sql switches on the weekly Trends collection
(paid every week for every active client). It moves to supabase/migrations
and is applied after Lital reviews the Trends trial (plan Task 8, Step 8).
