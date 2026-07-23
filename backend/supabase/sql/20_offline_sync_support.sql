-- 20_offline_sync_support.sql
-- Adds soft-delete / tombstone columns and realtime publication support for
-- tables that take part in the local-first WatermelonDB <-> Supabase sync.

begin;

-- ===========================================================================
-- projects
-- ===========================================================================

alter table public.projects
  add column if not exists _deleted boolean not null default false;

-- Existing rows are considered alive.
update public.projects
set _deleted = false
where _deleted is null;

create index if not exists idx_projects_workspace_updated
  on public.projects (workspace_id, updated_at, id);

-- Idempotently add to realtime publication for live sync.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;

-- ===========================================================================
-- organizations
-- ===========================================================================

alter table public.organizations
  add column if not exists _deleted boolean not null default false;

update public.organizations
set _deleted = false
where _deleted is null;

create index if not exists idx_organizations_workspace_updated
  on public.organizations (workspace_id, updated_at, id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'organizations'
  ) then
    alter publication supabase_realtime add table public.organizations;
  end if;
end $$;

-- ===========================================================================
-- Helper to add a table to the realtime publication only once.
-- ===========================================================================

create or replace function private.add_table_to_realtime(p_table text)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = p_table
  ) then
    execute format('alter publication supabase_realtime add table public.%I', p_table);
  end if;
end;
$$;

-- ===========================================================================
-- contacts
-- ===========================================================================

alter table public.contacts
  add column if not exists _deleted boolean not null default false;

update public.contacts set _deleted = false where _deleted is null;

create index if not exists idx_contacts_workspace_updated
  on public.contacts (workspace_id, updated_at, id);

select private.add_table_to_realtime('contacts');

-- ===========================================================================
-- assets
-- ===========================================================================

alter table public.assets
  add column if not exists _deleted boolean not null default false;

update public.assets set _deleted = false where _deleted is null;

create index if not exists idx_assets_workspace_updated
  on public.assets (workspace_id, updated_at, id);

select private.add_table_to_realtime('assets');

-- ===========================================================================
-- asset_calibrations
-- ===========================================================================

alter table public.asset_calibrations
  add column if not exists _deleted boolean not null default false;

update public.asset_calibrations set _deleted = false where _deleted is null;

create index if not exists idx_asset_calibrations_workspace_updated
  on public.asset_calibrations (workspace_id, updated_at, id);

select private.add_table_to_realtime('asset_calibrations');

-- ===========================================================================
-- asset_maintenance_events
-- ===========================================================================

alter table public.asset_maintenance_events
  add column if not exists _deleted boolean not null default false;

update public.asset_maintenance_events set _deleted = false where _deleted is null;

create index if not exists idx_asset_maintenance_events_workspace_updated
  on public.asset_maintenance_events (workspace_id, updated_at, id);

select private.add_table_to_realtime('asset_maintenance_events');

-- ===========================================================================
-- time_entries
-- ===========================================================================

alter table public.time_entries
  add column if not exists _deleted boolean not null default false;

update public.time_entries set _deleted = false where _deleted is null;

create index if not exists idx_time_entries_workspace_updated
  on public.time_entries (workspace_id, updated_at, id);

select private.add_table_to_realtime('time_entries');

-- ===========================================================================
-- expense_entries
-- ===========================================================================

alter table public.expense_entries
  add column if not exists _deleted boolean not null default false;

update public.expense_entries set _deleted = false where _deleted is null;

create index if not exists idx_expense_entries_workspace_updated
  on public.expense_entries (workspace_id, updated_at, id);

select private.add_table_to_realtime('expense_entries');

-- ===========================================================================
-- jobs
-- ===========================================================================

alter table public.jobs
  add column if not exists _deleted boolean not null default false;

update public.jobs set _deleted = false where _deleted is null;

create index if not exists idx_jobs_workspace_updated
  on public.jobs (workspace_id, updated_at, id);

select private.add_table_to_realtime('jobs');

-- ===========================================================================
-- job_events
-- ===========================================================================

alter table public.job_events
  add column if not exists _deleted boolean not null default false;

update public.job_events set _deleted = false where _deleted is null;

create index if not exists idx_job_events_workspace_updated
  on public.job_events (workspace_id, updated_at, id);

select private.add_table_to_realtime('job_events');

-- ===========================================================================
-- job_assignments
-- ===========================================================================

alter table public.job_assignments
  add column if not exists _deleted boolean not null default false;

update public.job_assignments set _deleted = false where _deleted is null;

create index if not exists idx_job_assignments_workspace_updated
  on public.job_assignments (workspace_id, updated_at, id);

select private.add_table_to_realtime('job_assignments');

-- ===========================================================================
-- job_assignment_members
-- ===========================================================================

alter table public.job_assignment_members
  add column if not exists _deleted boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.job_assignment_members
set _deleted = false, updated_at = coalesce(created_at, now())
where _deleted is null;

drop trigger if exists set_updated_at_job_assignment_members on public.job_assignment_members;
create trigger set_updated_at_job_assignment_members
  before update on public.job_assignment_members
  for each row execute function public.set_updated_at();

create index if not exists idx_job_assignment_members_workspace_updated
  on public.job_assignment_members (workspace_id, updated_at, id);

select private.add_table_to_realtime('job_assignment_members');

-- ===========================================================================
-- job_assignment_assets
-- ===========================================================================

alter table public.job_assignment_assets
  add column if not exists _deleted boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.job_assignment_assets
set _deleted = false, updated_at = coalesce(created_at, now())
where _deleted is null;

drop trigger if exists set_updated_at_job_assignment_assets on public.job_assignment_assets;
create trigger set_updated_at_job_assignment_assets
  before update on public.job_assignment_assets
  for each row execute function public.set_updated_at();

create index if not exists idx_job_assignment_assets_workspace_updated
  on public.job_assignment_assets (workspace_id, updated_at, id);

select private.add_table_to_realtime('job_assignment_assets');

commit;
