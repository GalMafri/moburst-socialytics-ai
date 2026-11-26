-- What an uploaded strategy document says and shows about the brand's look,
-- read once per file the first time a design is planned after the upload
-- (design-request/strategyDocLook.ts; Lital, 26 Nov 2026: designs never
-- followed the visuals inside the strategy document). Holds the file's path,
-- when it was read and the look as short lines ("" when the document says
-- nothing about the look). A new file is read again. Only the service role
-- writes it. Safe to apply twice.

alter table public.clients add column if not exists strategy_doc_look jsonb;
comment on column public.clients.strategy_doc_look is 'The strategy document''s look for the design planner: {path, read_at, text}, read once per uploaded file by design-request (design-request/strategyDocLook.ts).';
