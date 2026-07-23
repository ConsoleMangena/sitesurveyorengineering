-- 12_attachment_versions.sql — File version history.
-- Run AFTER 07_file_manager_features.sql. Idempotent.

begin;

-- ===========================================================================
-- attachment_versions
-- ===========================================================================

create table if not exists public.attachment_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  storage_path text not null,
  content_hash text,
  size_bytes bigint,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.attachment_versions is
  'Archived copies of previous file contents for an attachment.';

-- ===========================================================================
-- indexes
-- ===========================================================================

create index if not exists idx_attachment_versions_attachment_id
  on public.attachment_versions (attachment_id, created_at desc);

create index if not exists idx_attachment_versions_workspace_id
  on public.attachment_versions (workspace_id);

-- ===========================================================================
-- RLS
-- ===========================================================================

alter table public.attachment_versions enable row level security;

drop policy if exists "attachment_versions_select_member" on public.attachment_versions;
create policy "attachment_versions_select_member"
  on public.attachment_versions
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "attachment_versions_manage_member" on public.attachment_versions;
create policy "attachment_versions_manage_member"
  on public.attachment_versions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and public.can_manage_documents(a.workspace_id)
    )
  )
  with check (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and public.can_manage_documents(a.workspace_id)
    )
  );

commit;
