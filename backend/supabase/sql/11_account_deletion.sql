-- Account soft-deletion support
-- Adds a deletion-request timestamp and a scheduled purge timestamp to profiles.
-- Existing tables are not recreated; columns are added only if missing.

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deletion_requested_at is 'When the user requested account deletion. Starts a grace period before permanent removal.';
comment on column public.profiles.deleted_at is 'Soft-delete timestamp. Account becomes inaccessible after this time.';
