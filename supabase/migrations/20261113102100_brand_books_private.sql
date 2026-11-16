-- Brand books and strategy documents are a client's own files, and anyone with
-- an object's URL could open them while the bucket was public. Staff read them
-- through the storage policy on storage.objects (is_moburst_staff) and the
-- functions read them by download or a signed link with the service role, so
-- nothing needs a public address. extract-brand-from-file reads every file by
-- download in the same release as this migration.
update storage.buckets set public = false where id = 'brand-books';
