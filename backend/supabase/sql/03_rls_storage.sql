-- 03_rls_storage.sql — RLS policies and storage buckets/policies. Run AFTER 02.

begin;


-- ===========================================================================
-- rls_policies
-- ===========================================================================

-- Contains the FINAL versions of all policies, consolidated from all migrations.


-- ── Enable RLS on all tables ──

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.workspace_licenses enable row level security;
alter table public.license_events enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.organizations enable row level security;
alter table public.contacts enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_contacts enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;
alter table public.job_assignments enable row level security;
alter table public.assets enable row level security;
alter table public.job_assignment_members enable row level security;
alter table public.job_assignment_assets enable row level security;
alter table public.asset_calibrations enable row level security;
alter table public.asset_maintenance_events enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.professionals enable row level security;
alter table public.project_activities enable row level security;
alter table public.time_entries enable row level security;
alter table public.expense_entries enable row level security;
alter table public.promo_code_rules enable row level security;
alter table public.payment_methods enable row level security;
alter table public.project_cad_drawings enable row level security;
alter table public.feature_catalog enable row level security;
alter table public.feature_access_requests enable row level security;
alter table public.workspace_feature_entitlements enable row level security;
alter table public.embedded_solana_wallets enable row level security;

-- ── Profiles ──

drop policy if exists "profiles_select_self_or_shared_workspace" on public.profiles;
create policy "profiles_select_self_or_shared_workspace"
on public.profiles
for select
to authenticated
using (
  id = auth.uid() or public.shares_workspace_with_profile(id)
);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (
  id = auth.uid()
  and (
    is_platform_admin is not distinct from (
      select p.is_platform_admin
      from public.profiles p
      where p.id = auth.uid()
    )
  )
  and (
    auth_signup_account_type is not distinct from (
      select p.auth_signup_account_type
      from public.profiles p
      where p.id = auth.uid()
    )
  )
);

drop policy if exists "profiles_select_platform_admin" on public.profiles;
create policy "profiles_select_platform_admin"
on public.profiles
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "profiles_update_platform_admin" on public.profiles;
create policy "profiles_update_platform_admin"
on public.profiles
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- ── Workspaces ──

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces
for select
to authenticated
using (public.is_workspace_member(id));

drop policy if exists "workspaces_select_platform_admin" on public.workspaces;
create policy "workspaces_select_platform_admin"
on public.workspaces
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "workspaces_update_platform_admin" on public.workspaces;
create policy "workspaces_update_platform_admin"
on public.workspaces
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- ── Workspace settings ──

drop policy if exists "workspace_settings_select_member" on public.workspace_settings;
create policy "workspace_settings_select_member"
on public.workspace_settings
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_settings_update_manager" on public.workspace_settings;
create policy "workspace_settings_update_manager"
on public.workspace_settings
for update
to authenticated
using (public.can_manage_workspace(workspace_id))
with check (public.can_manage_workspace(workspace_id));

-- ── Workspace licenses ──

drop policy if exists "workspace_licenses_select_member" on public.workspace_licenses;
create policy "workspace_licenses_select_member"
on public.workspace_licenses
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_licenses_update_manager" on public.workspace_licenses;
create policy "workspace_licenses_update_manager"
on public.workspace_licenses
for update
to authenticated
using (public.can_manage_workspace(workspace_id))
with check (public.can_manage_workspace(workspace_id));

drop policy if exists "workspace_licenses_insert_manager" on public.workspace_licenses;
create policy "workspace_licenses_insert_manager"
on public.workspace_licenses
for insert
to authenticated
with check (public.can_manage_workspace(workspace_id));

drop policy if exists "workspace_licenses_select_platform_admin" on public.workspace_licenses;
create policy "workspace_licenses_select_platform_admin"
on public.workspace_licenses
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "workspace_licenses_insert_platform_admin" on public.workspace_licenses;
create policy "workspace_licenses_insert_platform_admin"
on public.workspace_licenses
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "workspace_licenses_update_platform_admin" on public.workspace_licenses;
create policy "workspace_licenses_update_platform_admin"
on public.workspace_licenses
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "workspace_licenses_delete_platform_admin" on public.workspace_licenses;
create policy "workspace_licenses_delete_platform_admin"
on public.workspace_licenses
for delete
to authenticated
using (public.is_platform_admin());

-- ── License events ──

drop policy if exists "license_events_select_member" on public.license_events;
create policy "license_events_select_member"
on public.license_events
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "license_events_select_platform_admin" on public.license_events;
create policy "license_events_select_platform_admin"
on public.license_events
for select
to authenticated
using (public.is_platform_admin());

-- ── Workspace members (business workspace only for management) ──

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member"
on public.workspace_members
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_select_platform_admin" on public.workspace_members;
create policy "workspace_members_select_platform_admin"
on public.workspace_members
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "workspace_members_manage_admin" on public.workspace_members;
create policy "workspace_members_manage_admin"
on public.workspace_members
for all
to authenticated
using (public.can_manage_business_workspace(workspace_id))
with check (public.can_manage_business_workspace(workspace_id));

-- ── Workspace invitations (business workspace only) ──

drop policy if exists "workspace_invitations_select_manager" on public.workspace_invitations;
create policy "workspace_invitations_select_manager"
on public.workspace_invitations
for select
to authenticated
using (public.can_manage_business_workspace(workspace_id));

drop policy if exists "workspace_invitations_manage_manager" on public.workspace_invitations;
create policy "workspace_invitations_manage_manager"
on public.workspace_invitations
for all
to authenticated
using (public.can_manage_business_workspace(workspace_id))
with check (public.can_manage_business_workspace(workspace_id));

-- ── Organizations ──

drop policy if exists "organizations_select_member" on public.organizations;
create policy "organizations_select_member"
on public.organizations
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "organizations_manage_member" on public.organizations;
create policy "organizations_manage_member"
on public.organizations
for insert
to authenticated
with check (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id));

drop policy if exists "organizations_update_member" on public.organizations;
create policy "organizations_update_member"
on public.organizations
for update
to authenticated
using (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id))
with check (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id));

drop policy if exists "organizations_delete_manager" on public.organizations;
create policy "organizations_delete_manager"
on public.organizations
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Contacts ──

drop policy if exists "contacts_select_member" on public.contacts;
create policy "contacts_select_member"
on public.contacts
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "contacts_manage_member" on public.contacts;
create policy "contacts_manage_member"
on public.contacts
for insert
to authenticated
with check (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id));

drop policy if exists "contacts_update_member" on public.contacts;
create policy "contacts_update_member"
on public.contacts
for update
to authenticated
using (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id))
with check (public.can_manage_sales(workspace_id) or public.can_manage_workspace(workspace_id));

drop policy if exists "contacts_delete_manager" on public.contacts;
create policy "contacts_delete_manager"
on public.contacts
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Projects ──

drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member"
on public.projects
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "projects_manage_ops" on public.projects;
create policy "projects_manage_ops"
on public.projects
for insert
to authenticated
with check (public.can_manage_operations(workspace_id) or public.can_manage_sales(workspace_id));

drop policy if exists "projects_update_ops" on public.projects;
create policy "projects_update_ops"
on public.projects
for update
to authenticated
using (public.can_manage_operations(workspace_id) or public.can_manage_sales(workspace_id))
with check (public.can_manage_operations(workspace_id) or public.can_manage_sales(workspace_id));

drop policy if exists "projects_delete_manager" on public.projects;
create policy "projects_delete_manager"
on public.projects
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Project members (business workspace only) ──

drop policy if exists "project_members_select_member" on public.project_members;
create policy "project_members_select_member"
on public.project_members
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "project_members_manage_ops" on public.project_members;
create policy "project_members_manage_ops"
on public.project_members
for all
to authenticated
using (public.can_manage_business_operations(workspace_id))
with check (public.can_manage_business_operations(workspace_id));

-- ── Project contacts ──

drop policy if exists "project_contacts_select_member" on public.project_contacts;
create policy "project_contacts_select_member"
on public.project_contacts
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "project_contacts_manage_ops" on public.project_contacts;
create policy "project_contacts_manage_ops"
on public.project_contacts
for all
to authenticated
using (public.can_manage_operations(workspace_id) or public.can_manage_sales(workspace_id))
with check (public.can_manage_operations(workspace_id) or public.can_manage_sales(workspace_id));

-- ── Jobs (business workspace only, writes platform admin only) ──

drop policy if exists "jobs_select_member" on public.jobs;
create policy "jobs_select_member"
on public.jobs
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "jobs_insert_platform_admin" on public.jobs;
create policy "jobs_insert_platform_admin"
on public.jobs
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "jobs_update_platform_admin" on public.jobs;
create policy "jobs_update_platform_admin"
on public.jobs
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "jobs_delete_platform_admin" on public.jobs;
create policy "jobs_delete_platform_admin"
on public.jobs
for delete
to authenticated
using (public.is_platform_admin());

-- ── Job events (business workspace only) ──

drop policy if exists "job_events_select_member" on public.job_events;
create policy "job_events_select_member"
on public.job_events
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "job_events_manage_ops" on public.job_events;
create policy "job_events_manage_ops"
on public.job_events
for all
to authenticated
using (public.can_manage_business_operations(workspace_id))
with check (public.can_manage_business_operations(workspace_id));

-- ── Job assignments (business workspace only) ──

drop policy if exists "job_assignments_select_member" on public.job_assignments;
create policy "job_assignments_select_member"
on public.job_assignments
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "job_assignments_manage_ops" on public.job_assignments;
create policy "job_assignments_manage_ops"
on public.job_assignments
for all
to authenticated
using (public.can_manage_business_operations(workspace_id))
with check (public.can_manage_business_operations(workspace_id));

-- ── Job assignment members (business workspace only) ──

drop policy if exists "job_assignment_members_select_member" on public.job_assignment_members;
create policy "job_assignment_members_select_member"
on public.job_assignment_members
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "job_assignment_members_manage_ops" on public.job_assignment_members;
create policy "job_assignment_members_manage_ops"
on public.job_assignment_members
for all
to authenticated
using (public.can_manage_business_operations(workspace_id))
with check (public.can_manage_business_operations(workspace_id));

-- ── Job assignment assets (business workspace only) ──

drop policy if exists "job_assignment_assets_select_member" on public.job_assignment_assets;
create policy "job_assignment_assets_select_member"
on public.job_assignment_assets
for select
to authenticated
using (
  public.is_business_workspace(workspace_id)
  and public.is_workspace_member(workspace_id)
);

drop policy if exists "job_assignment_assets_manage_ops" on public.job_assignment_assets;
create policy "job_assignment_assets_manage_ops"
on public.job_assignment_assets
for all
to authenticated
using (public.can_manage_business_operations(workspace_id))
with check (public.can_manage_business_operations(workspace_id));

-- ── Assets ──

drop policy if exists "assets_select_member" on public.assets;
create policy "assets_select_member"
on public.assets
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "assets_manage_member" on public.assets;
create policy "assets_manage_member"
on public.assets
for insert
to authenticated
with check (public.can_manage_assets(workspace_id));

drop policy if exists "assets_update_member" on public.assets;
create policy "assets_update_member"
on public.assets
for update
to authenticated
using (public.can_manage_assets(workspace_id))
with check (public.can_manage_assets(workspace_id));

drop policy if exists "assets_delete_manager" on public.assets;
create policy "assets_delete_manager"
on public.assets
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Asset calibrations ──

drop policy if exists "asset_calibrations_select_member" on public.asset_calibrations;
create policy "asset_calibrations_select_member"
on public.asset_calibrations
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "asset_calibrations_manage_member" on public.asset_calibrations;
create policy "asset_calibrations_manage_member"
on public.asset_calibrations
for all
to authenticated
using (public.can_manage_assets(workspace_id))
with check (public.can_manage_assets(workspace_id));

-- ── Asset maintenance events ──

drop policy if exists "asset_maintenance_select_member" on public.asset_maintenance_events;
create policy "asset_maintenance_select_member"
on public.asset_maintenance_events
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "asset_maintenance_manage_member" on public.asset_maintenance_events;
create policy "asset_maintenance_manage_member"
on public.asset_maintenance_events
for all
to authenticated
using (public.can_manage_assets(workspace_id))
with check (public.can_manage_assets(workspace_id));

-- ── Quotes ──

drop policy if exists "quotes_select_member" on public.quotes;
create policy "quotes_select_member"
on public.quotes
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "quotes_manage_member" on public.quotes;
create policy "quotes_manage_member"
on public.quotes
for insert
to authenticated
with check (public.can_manage_sales(workspace_id) or public.can_manage_finance(workspace_id));

drop policy if exists "quotes_update_member" on public.quotes;
create policy "quotes_update_member"
on public.quotes
for update
to authenticated
using (public.can_manage_sales(workspace_id) or public.can_manage_finance(workspace_id))
with check (public.can_manage_sales(workspace_id) or public.can_manage_finance(workspace_id));

drop policy if exists "quotes_delete_manager" on public.quotes;
create policy "quotes_delete_manager"
on public.quotes
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Quote items ──

drop policy if exists "quote_items_select_member" on public.quote_items;
create policy "quote_items_select_member"
on public.quote_items
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "quote_items_manage_member" on public.quote_items;
create policy "quote_items_manage_member"
on public.quote_items
for all
to authenticated
using (public.can_manage_sales(workspace_id) or public.can_manage_finance(workspace_id))
with check (public.can_manage_sales(workspace_id) or public.can_manage_finance(workspace_id));

-- ── Invoices ──

drop policy if exists "invoices_select_member" on public.invoices;
create policy "invoices_select_member"
on public.invoices
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "invoices_manage_finance" on public.invoices;
create policy "invoices_manage_finance"
on public.invoices
for insert
to authenticated
with check (public.can_manage_finance(workspace_id));

drop policy if exists "invoices_update_finance" on public.invoices;
create policy "invoices_update_finance"
on public.invoices
for update
to authenticated
using (public.can_manage_finance(workspace_id))
with check (public.can_manage_finance(workspace_id));

drop policy if exists "invoices_delete_manager" on public.invoices;
create policy "invoices_delete_manager"
on public.invoices
for delete
to authenticated
using (public.can_manage_workspace(workspace_id));

-- ── Invoice items ──

drop policy if exists "invoice_items_select_member" on public.invoice_items;
create policy "invoice_items_select_member"
on public.invoice_items
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "invoice_items_manage_finance" on public.invoice_items;
create policy "invoice_items_manage_finance"
on public.invoice_items
for all
to authenticated
using (public.can_manage_finance(workspace_id))
with check (public.can_manage_finance(workspace_id));

-- ── Payments ──

drop policy if exists "payments_select_member" on public.payments;
create policy "payments_select_member"
on public.payments
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "payments_manage_finance" on public.payments;
create policy "payments_manage_finance"
on public.payments
for all
to authenticated
using (public.can_manage_finance(workspace_id))
with check (public.can_manage_finance(workspace_id));

-- ── Attachments ──

drop policy if exists "attachments_select_member_or_public" on public.attachments;
create policy "attachments_select_member_or_public"
on public.attachments
for select
to authenticated
using (
  visibility = 'public'
  or public.is_workspace_member(workspace_id)
);

drop policy if exists "attachments_manage_member" on public.attachments;
create policy "attachments_manage_member"
on public.attachments
for insert
to authenticated
with check (public.can_manage_documents(workspace_id));

drop policy if exists "attachments_update_member" on public.attachments;
create policy "attachments_update_member"
on public.attachments
for update
to authenticated
using (public.can_manage_documents(workspace_id))
with check (public.can_manage_documents(workspace_id));

drop policy if exists "attachments_delete_member" on public.attachments;
create policy "attachments_delete_member"
on public.attachments
for delete
to authenticated
using (public.can_manage_documents(workspace_id));

-- ── Notifications ──

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Allow workspace members to create notifications for users in the same workspace.
drop policy if exists "notifications_insert_workspace_member" on public.notifications;
create policy "notifications_insert_workspace_member"
on public.notifications
for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and exists (
    select 1
    from public.workspace_members recipient
    where recipient.workspace_id = notifications.workspace_id
      and recipient.user_id = notifications.user_id
      and recipient.status in ('active', 'invited')
  )
);

-- ── Marketplace listings ──
-- Reads: any workspace member (plus everyone for global listings). Writes are
-- free for every workspace: a workspace owner/admin may list its own
-- assets/instruments for hire without any marketplace entitlement.
-- Non-platform-admins may never publish a global (is_global = true) listing.

drop policy if exists "marketplace_listings_select_member" on public.marketplace_listings;
create policy "marketplace_listings_select_member"
on public.marketplace_listings
for select
to authenticated
using (public.is_workspace_member(workspace_id) or is_global);

-- Legacy platform-admin-only policies are superseded by the permission-aware
-- policies below; drop them so re-runs converge to a single policy per action.
drop policy if exists "marketplace_listings_insert_platform_admin" on public.marketplace_listings;
drop policy if exists "marketplace_listings_update_platform_admin" on public.marketplace_listings;
drop policy if exists "marketplace_listings_delete_platform_admin" on public.marketplace_listings;

-- Listing instruments/assets for hire is free: any workspace manager may
-- publish, edit and remove their own (non-global) listings. No marketplace
-- entitlement is required. Only platform admins may publish global listings.

drop policy if exists "marketplace_listings_insert_permitted" on public.marketplace_listings;
create policy "marketplace_listings_insert_permitted"
on public.marketplace_listings
for insert
to authenticated
with check (
  public.is_platform_admin()
  or (
    is_global = false
    and public.can_manage_workspace(workspace_id)
  )
);

drop policy if exists "marketplace_listings_update_permitted" on public.marketplace_listings;
create policy "marketplace_listings_update_permitted"
on public.marketplace_listings
for update
to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_workspace(workspace_id)
)
with check (
  public.is_platform_admin()
  or (
    is_global = false
    and public.can_manage_workspace(workspace_id)
  )
);

drop policy if exists "marketplace_listings_delete_permitted" on public.marketplace_listings;
create policy "marketplace_listings_delete_permitted"
on public.marketplace_listings
for delete
to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_workspace(workspace_id)
);

-- ── Marketplace orders ──

drop policy if exists "marketplace_orders_select_participant" on public.marketplace_orders;
create policy "marketplace_orders_select_participant"
on public.marketplace_orders
for select
to authenticated
using (
  public.is_workspace_member(buyer_workspace_id)
  or public.is_workspace_member(listing_workspace_id)
);

-- ── Professionals directory (writes platform admin only) ──

drop policy if exists "professionals_select_member" on public.professionals;
create policy "professionals_select_member"
on public.professionals
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "professionals_insert_platform_admin" on public.professionals;
create policy "professionals_insert_platform_admin"
on public.professionals
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "professionals_update_platform_admin" on public.professionals;
create policy "professionals_update_platform_admin"
on public.professionals
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "professionals_delete_platform_admin" on public.professionals;
create policy "professionals_delete_platform_admin"
on public.professionals
for delete
to authenticated
using (public.is_platform_admin());

-- ── Project activities ──

drop policy if exists "project_activities_select_member" on public.project_activities;
create policy "project_activities_select_member"
on public.project_activities
for select
to authenticated
using (
  exists (
    select 1 from public.project_members
    where project_id = project_activities.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_activities.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_activities_insert_member" on public.project_activities;
create policy "project_activities_insert_member"
on public.project_activities
for insert
to authenticated
with check (
  exists (
    select 1 from public.project_members
    where project_id = project_activities.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_activities.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_activities_update_member" on public.project_activities;
create policy "project_activities_update_member"
on public.project_activities
for update
to authenticated
using (
  exists (
    select 1 from public.project_members
    where project_id = project_activities.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_activities.project_id
    and created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.project_members
    where project_id = project_activities.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_activities.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_activities_delete_member" on public.project_activities;
create policy "project_activities_delete_member"
on public.project_activities
for delete
to authenticated
using (
  exists (
    select 1 from public.project_members
    where project_id = project_activities.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_activities.project_id
    and created_by = auth.uid()
  )
);

-- ── Time entries ──

drop policy if exists "time_entries_select_member" on public.time_entries;
create policy "time_entries_select_member"
on public.time_entries
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "time_entries_insert_own" on public.time_entries;
create policy "time_entries_insert_own"
on public.time_entries
for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "time_entries_update_own" on public.time_entries;
create policy "time_entries_update_own"
on public.time_entries
for update
to authenticated
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
)
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "time_entries_delete_own" on public.time_entries;
create policy "time_entries_delete_own"
on public.time_entries
for delete
to authenticated
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

-- ── Expense entries ──

drop policy if exists "expense_entries_select_member" on public.expense_entries;
create policy "expense_entries_select_member"
on public.expense_entries
for select
to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists "expense_entries_insert_own" on public.expense_entries;
create policy "expense_entries_insert_own"
on public.expense_entries
for insert
to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "expense_entries_update_own" on public.expense_entries;
create policy "expense_entries_update_own"
on public.expense_entries
for update
to authenticated
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
)
with check (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "expense_entries_delete_own" on public.expense_entries;
create policy "expense_entries_delete_own"
on public.expense_entries
for delete
to authenticated
using (
  public.is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

-- ── Promo code rules ──

drop policy if exists "promo_code_rules_select_authenticated" on public.promo_code_rules;
create policy "promo_code_rules_select_authenticated"
on public.promo_code_rules
for select
to authenticated
using (active);

-- ── Payment methods ──

drop policy if exists "payment_methods_select" on public.payment_methods;
create policy "payment_methods_select"
on public.payment_methods
for select
to authenticated
using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

drop policy if exists "payment_methods_insert" on public.payment_methods;
create policy "payment_methods_insert"
on public.payment_methods
for insert
to authenticated
with check (
  public.has_workspace_role(workspace_id, array['owner'::public.workspace_member_role, 'admin'::public.workspace_member_role])
  or public.is_platform_admin()
);

drop policy if exists "payment_methods_update" on public.payment_methods;
create policy "payment_methods_update"
on public.payment_methods
for update
to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner'::public.workspace_member_role, 'admin'::public.workspace_member_role])
  or public.is_platform_admin()
);

drop policy if exists "payment_methods_delete" on public.payment_methods;
create policy "payment_methods_delete"
on public.payment_methods
for delete
to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner'::public.workspace_member_role, 'admin'::public.workspace_member_role])
  or public.is_platform_admin()
);

-- ── Embedded Solana wallets ──
-- Users can only read/write their own encrypted wallet key. All crypto
-- operations happen client-side; the server stores ciphertext only.

drop policy if exists "embedded_wallets_select_own" on public.embedded_solana_wallets;
create policy "embedded_wallets_select_own"
  on public.embedded_solana_wallets
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "embedded_wallets_insert_own" on public.embedded_solana_wallets;
create policy "embedded_wallets_insert_own"
  on public.embedded_solana_wallets
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "embedded_wallets_update_own" on public.embedded_solana_wallets;
create policy "embedded_wallets_update_own"
  on public.embedded_solana_wallets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "embedded_wallets_delete_own" on public.embedded_solana_wallets;
create policy "embedded_wallets_delete_own"
  on public.embedded_solana_wallets
  for delete
  to authenticated
  using (user_id = auth.uid());

-- ── Project CAD drawings ──
-- Members read their project's drawing; writes require the active 'cad_engine'
-- feature entitlement (server-side gate that the client cannot bypass).

drop policy if exists "project_cad_drawings_select_member" on public.project_cad_drawings;
create policy "project_cad_drawings_select_member"
on public.project_cad_drawings
for select
to authenticated
using (
  exists (
    select 1 from public.project_members
    where project_id = project_cad_drawings.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_cad_drawings.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_cad_drawings_insert_member" on public.project_cad_drawings;
create policy "project_cad_drawings_insert_member"
on public.project_cad_drawings
for insert
to authenticated
with check (
  (
    public.has_feature(workspace_id, 'cad_engine')
    and exists (
      select 1 from public.project_members
      where project_id = project_cad_drawings.project_id
      and user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.projects
    where id = project_cad_drawings.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_cad_drawings_update_member" on public.project_cad_drawings;
create policy "project_cad_drawings_update_member"
on public.project_cad_drawings
for update
to authenticated
using (
  (
    exists (
      select 1 from public.project_members
      where project_id = project_cad_drawings.project_id
      and user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.projects
    where id = project_cad_drawings.project_id
    and created_by = auth.uid()
  )
)
with check (
  (
    public.has_feature(workspace_id, 'cad_engine')
    and exists (
      select 1 from public.project_members
      where project_id = project_cad_drawings.project_id
      and user_id = auth.uid()
    )
  )
  or exists (
    select 1 from public.projects
    where id = project_cad_drawings.project_id
    and created_by = auth.uid()
  )
);

drop policy if exists "project_cad_drawings_delete_member" on public.project_cad_drawings;
create policy "project_cad_drawings_delete_member"
on public.project_cad_drawings
for delete
to authenticated
using (
  exists (
    select 1 from public.project_members
    where project_id = project_cad_drawings.project_id
    and user_id = auth.uid()
  )
  or exists (
    select 1 from public.projects
    where id = project_cad_drawings.project_id
    and created_by = auth.uid()
  )
);

-- ── Feature catalog (read all; write platform admin only) ──

drop policy if exists "feature_catalog_select_all" on public.feature_catalog;
create policy "feature_catalog_select_all"
on public.feature_catalog
for select
to authenticated
using (true);

drop policy if exists "feature_catalog_insert_platform_admin" on public.feature_catalog;
create policy "feature_catalog_insert_platform_admin"
on public.feature_catalog
for insert
to authenticated
with check (public.is_platform_admin());

drop policy if exists "feature_catalog_update_platform_admin" on public.feature_catalog;
create policy "feature_catalog_update_platform_admin"
on public.feature_catalog
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "feature_catalog_delete_platform_admin" on public.feature_catalog;
create policy "feature_catalog_delete_platform_admin"
on public.feature_catalog
for delete
to authenticated
using (public.is_platform_admin());

-- ── Feature access requests ──

drop policy if exists "feature_requests_select" on public.feature_access_requests;
create policy "feature_requests_select"
on public.feature_access_requests
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_workspace_member(workspace_id)
);

drop policy if exists "feature_requests_insert_admin" on public.feature_access_requests;
create policy "feature_requests_insert_admin"
on public.feature_access_requests
for insert
to authenticated
with check (
  requested_by = auth.uid()
  and public.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_member_role[])
);

drop policy if exists "feature_requests_update_platform_admin" on public.feature_access_requests;
create policy "feature_requests_update_platform_admin"
on public.feature_access_requests
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

-- ── Workspace feature entitlements (members read; platform admin manages) ──

drop policy if exists "feature_entitlements_select" on public.workspace_feature_entitlements;
create policy "feature_entitlements_select"
on public.workspace_feature_entitlements
for select
to authenticated
using (
  public.is_platform_admin()
  or public.is_workspace_member(workspace_id)
);

drop policy if exists "feature_entitlements_write_platform_admin" on public.workspace_feature_entitlements;
create policy "feature_entitlements_write_platform_admin"
on public.workspace_feature_entitlements
for all
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());


-- ===========================================================================
-- storage
-- ===========================================================================



insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', false),
  ('workspace-private', 'workspace-private', false),
  ('workspace-public', 'workspace-public', true),
  ('generated-docs', 'generated-docs', false)
on conflict (id) do nothing;

drop policy if exists "avatars_select_own" on storage.objects;
create policy "avatars_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and public.path_first_segment_uuid(name) = auth.uid()
);

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and public.path_first_segment_uuid(name) = auth.uid()
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and public.path_first_segment_uuid(name) = auth.uid()
)
with check (
  bucket_id = 'avatars'
  and public.path_first_segment_uuid(name) = auth.uid()
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and public.path_first_segment_uuid(name) = auth.uid()
);

drop policy if exists "workspace_private_select_member" on storage.objects;
create policy "workspace_private_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workspace-private'
  and public.is_workspace_member(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_private_insert_member" on storage.objects;
create policy "workspace_private_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workspace-private'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_private_update_member" on storage.objects;
create policy "workspace_private_update_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'workspace-private'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
)
with check (
  bucket_id = 'workspace-private'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_private_delete_member" on storage.objects;
create policy "workspace_private_delete_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'workspace-private'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_public_select_member_or_public" on storage.objects;
create policy "workspace_public_select_member_or_public"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workspace-public'
  and (
    public.is_workspace_member(public.path_first_segment_uuid(name))
    or true
  )
);

drop policy if exists "workspace_public_insert_member" on storage.objects;
create policy "workspace_public_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workspace-public'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_public_update_member" on storage.objects;
create policy "workspace_public_update_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'workspace-public'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
)
with check (
  bucket_id = 'workspace-public'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "workspace_public_delete_member" on storage.objects;
create policy "workspace_public_delete_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'workspace-public'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "generated_docs_select_member" on storage.objects;
create policy "generated_docs_select_member"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'generated-docs'
  and public.is_workspace_member(public.path_first_segment_uuid(name))
);

drop policy if exists "generated_docs_insert_member" on storage.objects;
create policy "generated_docs_insert_member"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'generated-docs'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "generated_docs_update_member" on storage.objects;
create policy "generated_docs_update_member"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'generated-docs'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
)
with check (
  bucket_id = 'generated-docs'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);

drop policy if exists "generated_docs_delete_member" on storage.objects;
create policy "generated_docs_delete_member"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'generated-docs'
  and public.can_manage_documents(public.path_first_segment_uuid(name))
);


commit;
