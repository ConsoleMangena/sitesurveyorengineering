-- 07_file_manager_features.sql — Trash bin, folders, tags, and member activity log.
-- Run AFTER 03_rls_storage.sql. Idempotent.

begin;

-- ===========================================================================
-- attachments extensions
-- ===========================================================================

alter table public.attachments
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- ===========================================================================
-- folders
-- ===========================================================================

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null,
  path text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, parent_id, name)
);

comment on table public.folders is
  'Hierarchical file folders scoped to a workspace. parent_id is null for root-level folders.';

-- folder_id must be added after the folders table exists.
alter table public.attachments
  add column if not exists folder_id uuid references public.folders (id) on delete set null;

-- Optional PDA of the dedicated File Record Anchor program for this attachment.
alter table public.attachments
  add column if not exists chain_program_address text;

-- ===========================================================================
-- tags
-- ===========================================================================

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  color text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

comment on table public.tags is
  'Workspace-scoped labels that can be attached to files.';

-- ===========================================================================
-- attachment_tags
-- ===========================================================================

create table if not exists public.attachment_tags (
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (attachment_id, tag_id)
);

comment on table public.attachment_tags is
  'Many-to-many join between attachments and tags.';

-- ===========================================================================
-- indexes
-- ===========================================================================

create index if not exists idx_attachments_deleted_at on public.attachments (workspace_id, deleted_at);
create index if not exists idx_attachments_folder_id on public.attachments (folder_id);
create index if not exists idx_attachments_updated_at on public.attachments (workspace_id, updated_at desc);
create index if not exists idx_folders_workspace_id on public.folders (workspace_id);
create index if not exists idx_folders_parent_id on public.folders (parent_id);
create index if not exists idx_tags_workspace_id on public.tags (workspace_id);
create index if not exists idx_attachment_tags_tag_id on public.attachment_tags (tag_id);

-- ===========================================================================
-- updated_at helper
-- ===========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists attachments_updated_at on public.attachments;
create trigger attachments_updated_at
  before update on public.attachments
  for each row
  execute function public.set_updated_at();

drop trigger if exists folders_updated_at on public.folders;
create trigger folders_updated_at
  before update on public.folders
  for each row
  execute function public.set_updated_at();

-- ===========================================================================
-- audit activity log helpers for workspace members
-- ===========================================================================

create or replace function public.log_activity(
  p_workspace_id uuid,
  p_entity_table text,
  p_entity_id uuid,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Only workspace members can log activity.';
  end if;

  insert into audit.activity_log (workspace_id, actor_user_id, entity_table, entity_id, action, details)
  values (p_workspace_id, auth.uid(), p_entity_table, p_entity_id, p_action, p_details);
end;
$$;

comment on function public.log_activity(uuid, text, uuid, text, jsonb) is
  'SECURITY DEFINER RPC so authenticated workspace members can write audit.activity_log rows.';

create or replace function public.list_workspace_activity_log(
  p_workspace_id uuid,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id bigint,
  workspace_id uuid,
  actor_user_id uuid,
  entity_table text,
  entity_id uuid,
  action text,
  details jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Only workspace members can read this activity log.';
  end if;

  return query
    select
      a.id,
      a.workspace_id,
      a.actor_user_id,
      a.entity_table,
      a.entity_id,
      a.action,
      a.details,
      a.created_at
    from audit.activity_log a
    where a.workspace_id = p_workspace_id
    order by a.created_at desc
    limit p_limit
    offset p_offset;
end;
$$;

comment on function public.list_workspace_activity_log(uuid, int, int) is
  'SECURITY DEFINER RPC so authenticated workspace members can read their own audit.activity_log rows.';

-- ===========================================================================
-- RLS (run after 03_rls_storage.sql so attachments RLS is already enabled)
-- ===========================================================================

alter table public.folders enable row level security;
alter table public.tags enable row level security;
alter table public.attachment_tags enable row level security;

-- Folders

drop policy if exists "folders_select_member" on public.folders;
create policy "folders_select_member"
  on public.folders
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "folders_manage_member" on public.folders;
create policy "folders_manage_member"
  on public.folders
  for all
  to authenticated
  using (public.can_manage_documents(workspace_id))
  with check (public.can_manage_documents(workspace_id));

-- Tags

drop policy if exists "tags_select_member" on public.tags;
create policy "tags_select_member"
  on public.tags
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "tags_manage_member" on public.tags;
create policy "tags_manage_member"
  on public.tags
  for all
  to authenticated
  using (public.can_manage_documents(workspace_id))
  with check (public.can_manage_documents(workspace_id));

-- Attachment tags

drop policy if exists "attachment_tags_select_member" on public.attachment_tags;
create policy "attachment_tags_select_member"
  on public.attachment_tags
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_tags.attachment_id
        and public.is_workspace_member(a.workspace_id)
    )
  );

drop policy if exists "attachment_tags_manage_member" on public.attachment_tags;
create policy "attachment_tags_manage_member"
  on public.attachment_tags
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_tags.attachment_id
        and public.can_manage_documents(a.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_tags.attachment_id
        and public.can_manage_documents(a.workspace_id)
    )
  );

-- Attachments: allow updates for soft-delete/restore and folder moves by document managers.
-- The application is responsible for filtering deleted rows with deleted_at IS NULL.

drop policy if exists "attachments_update_member" on public.attachments;
create policy "attachments_update_member"
  on public.attachments
  for update
  to authenticated
  using (public.can_manage_documents(workspace_id))
  with check (public.can_manage_documents(workspace_id));

commit;
