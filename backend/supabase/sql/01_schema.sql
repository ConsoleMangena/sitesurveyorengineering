-- 01_schema.sql — extensions, schemas, enums, tables, indexes. Run FIRST. Idempotent.

begin;


-- ===========================================================================
-- extensions_and_schemas
-- ===========================================================================



create extension if not exists pgcrypto;

create schema if not exists private;
create schema if not exists audit;

revoke all on schema private from public, anon, authenticated;
revoke all on schema audit from public, anon, authenticated;


-- ===========================================================================
-- enums
-- ===========================================================================



DO $$ BEGIN 
  create type public.workspace_type as enum ('personal', 'business');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN 
  create type public.workspace_member_role as enum (
  'owner',
  'admin',
  'ops_manager',
  'finance',
  'sales',
  'technician',
  'viewer'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN 
  create type public.workspace_member_status as enum ('active', 'invited', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.organization_type as enum (
  'client',
  'vendor',
  'government',
  'partner',
  'lead',
  'subcontractor'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.project_status as enum (
  'draft',
  'active',
  'completed',
  'on_hold',
  'archived'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.job_status as enum (
  'planned',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.assignment_status as enum (
  'draft',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.quote_status as enum (
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.invoice_status as enum (
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.asset_kind as enum (
  'instrument',
  'vehicle',
  'equipment',
  'other'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.asset_status as enum (
  'available',
  'deployed',
  'maintenance',
  'retired'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.calibration_status as enum (
  'scheduled',
  'passed',
  'failed',
  'expired'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.attachment_visibility as enum (
  'private',
  'workspace',
  'public'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  create type public.attachment_storage_tier as enum (
  'off_chain',
  'on_chain'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  create type public.attachment_chain_status as enum (
  'none',
  'pending',
  'anchored',
  'failed'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN 
  create type public.notification_status as enum (
  'unread',
  'read',
  'archived'
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  create type public.license_tier as enum ('free', 'pro', 'enterprise');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
  create type public.license_status as enum (
    'trialing',
    'active',
    'past_due',
    'suspended',
    'cancelled'
  );
  asset_id uuid references public.assets(id) on delete set null,
);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;


-- ===========================================================================
-- tables_indexes
-- ===========================================================================



create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  full_name text,
  professional_title text,
  promo_code text,
  phone text,
  bio text,
  avatar_path text,
  default_workspace_id uuid,
  is_platform_admin boolean not null default false,
  auth_signup_account_type text,
  constraint profiles_auth_signup_account_type_chk check (
    auth_signup_account_type is null
    or auth_signup_account_type in ('personal', 'business', 'platform_admin')
  ),
  onboarding_complete boolean not null default false,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.deletion_requested_at is 'When the user requested account deletion. Starts a grace period before permanent removal.';
comment on column public.profiles.deleted_at is 'Soft-delete timestamp. Account becomes inaccessible after this time.';

-- Ensure soft-delete columns exist for deployments that already created the table.
alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  type public.workspace_type not null,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  billing_email text,
  currency_code text not null default 'USD',
  timezone text not null default 'Africa/Harare',
  country_code text not null default 'ZW',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

alter table public.profiles
  drop constraint if exists profiles_default_workspace_id_fkey;
alter table public.profiles
  add constraint profiles_default_workspace_id_fkey
  foreign key (default_workspace_id)
  references public.workspaces (id)
  on delete set null;

comment on column public.profiles.is_platform_admin is
  'Trusted operators only; set in SQL by platform administrators. Enables cross-tenant admin API via RLS policies.';
comment on column public.profiles.auth_signup_account_type is
  'Signup metadata: personal | business | platform_admin. Written only by handle_new_auth_user().';

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  default_currency text not null default 'USD',
  timezone text not null default 'Africa/Harare',
  country_code text not null default 'ZW',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_licenses (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  tier public.license_tier not null default 'free',
  status public.license_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  trial_ends_at timestamptz,
  is_manual boolean not null default true,
  seat_limit integer default 1,
  project_cap integer default 12,
  asset_cap integer default 60,
  storage_cap_bytes bigint default 536870912,
  notes text,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.workspace_licenses.seat_limit is 'Max active members + pending invites; NULL = unlimited.';
comment on column public.workspace_licenses.project_cap is 'Max projects; NULL = unlimited.';
comment on column public.workspace_licenses.asset_cap is 'Max assets; NULL = unlimited.';
comment on column public.workspace_licenses.storage_cap_bytes is 'Max attachment bytes; NULL = unlimited.';

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_member_role not null default 'viewer',
  status public.workspace_member_status not null default 'active',
  title text,
  work_email text,
  work_phone text,
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  role public.workspace_member_role not null default 'viewer',
  invited_by uuid references auth.users (id) on delete set null,
  invitation_token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  organization_type public.organization_type not null default 'client',
  email text,
  phone text,
  address text,
  city text,
  country_code text not null default 'ZW',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  full_name text not null,
  title text,
  contact_type text,
  email text,
  phone text,
  last_contact_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  code text,
  name text not null,
  description text,
  phase text,
  datum text,
  progress numeric(5,2) not null default 0 check (progress >= 0 and progress <= 100),
  points integer not null default 0,
  status public.project_status not null default 'draft',
  starts_on date,
  ends_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, code)
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.project_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  relation text,
  created_at timestamptz not null default now(),
  unique (project_id, contact_id)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  description text,
  job_type text,
  location text,
  status public.job_status not null default 'planned',
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  job_id uuid references public.jobs (id) on delete cascade,
  title text not null,
  event_type text not null default 'other',
  event_date date not null,
  start_time time,
  end_time time,
  location text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  job_id uuid references public.jobs (id) on delete cascade,
  assignment_date date not null,
  status public.assignment_status not null default 'draft',
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  asset_code text,
  name text not null,
  kind public.asset_kind not null default 'instrument',
  category text,
  make text,
  model text,
  serial_number text,
  status public.asset_status not null default 'available',
  purchase_date date,
  purchase_cost numeric(12,2),
  current_value numeric(12,2),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, asset_code)
);

create table if not exists public.job_assignment_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  assignment_id uuid not null references public.job_assignments (id) on delete cascade,
  workspace_member_id uuid not null references public.workspace_members (id) on delete cascade,
  assignment_role text,
  created_at timestamptz not null default now(),
  unique (assignment_id, workspace_member_id)
);

create table if not exists public.job_assignment_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  assignment_id uuid not null references public.job_assignments (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (assignment_id, asset_id)
);

create table if not exists public.asset_calibrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  calibration_date date not null,
  next_calibration_date date,
  calibration_status public.calibration_status not null default 'scheduled',
  certificate_number text,
  certificate_path text,
  provider_name text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_maintenance_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  serviced_on date not null,
  description text not null,
  cost numeric(12,2) not null default 0,
  provider_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  quote_number text not null,
  issue_date date not null default current_date,
  expires_on date,
  status public.quote_status not null default 'draft',
  currency_code text not null default 'USD',
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  notes text,
  accepted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, quote_number)
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  line_number integer not null default 1,
  description text not null,
  qty numeric(12,2) not null default 1,
  unit text,
  rate numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  invoice_number text not null,
  issue_date date not null default current_date,
  due_date date,
  status public.invoice_status not null default 'draft',
  currency_code text not null default 'USD',
  subtotal numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  paid_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, invoice_number)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  line_number integer not null default 1,
  description text not null,
  qty numeric(12,2) not null default 1,
  unit text,
  rate numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric(12,2) not null,
  payment_method text,
  reference text,
  notes text,
  -- On-chain (Solana) settlement fields; NULL for manually-recorded payments.
  tx_signature text,    -- Solana transaction signature (base58); unique transfer.
  chain text,           -- settlement network, e.g. 'solana'.
  wallet_address text,  -- payer wallet (base58) for audit/reference.
  token_mint text,      -- SPL token mint settled in (e.g. the USDC mint).
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- On-chain columns, added explicitly so the script also upgrades a payments
-- table that pre-dates these fields (CREATE TABLE IF NOT EXISTS skips columns
-- when the table already exists).
alter table public.payments add column if not exists tx_signature text;
alter table public.payments add column if not exists chain text;
alter table public.payments add column if not exists wallet_address text;
alter table public.payments add column if not exists token_mint text;

-- One on-chain transfer maps to at most one payment row. Manual payments
-- (tx_signature is null) are unaffected by this partial unique index.
create unique index if not exists payments_tx_signature_key
  on public.payments (tx_signature)
  where tx_signature is not null;

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entity_table text not null,
  entity_id uuid not null,
  bucket_name text not null,
  storage_path text not null,
  visibility public.attachment_visibility not null default 'private',
  mime_type text,
  size_bytes bigint,
  storage_tier public.attachment_storage_tier not null default 'off_chain',
  chain_status public.attachment_chain_status not null default 'none',
  content_hash text,
  chain_tx_signature text,
  chain_network text,
  anchored_at timestamptz,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket_name, storage_path)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text,
  status public.notification_status not null default 'unread',
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists private.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid,
  actor_user_id uuid,
  entity_table text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.license_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  changed_by uuid references auth.users (id) on delete set null,
  previous_tier public.license_tier,
  new_tier public.license_tier,
  previous_status public.license_status,
  new_status public.license_status,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_workspace_members_user_id on public.workspace_members (user_id);
create index if not exists idx_workspace_members_workspace_id on public.workspace_members (workspace_id);
create index if not exists idx_workspace_invitations_workspace_id on public.workspace_invitations (workspace_id);
create index if not exists idx_workspace_invitations_email on public.workspace_invitations (lower(email));
create index if not exists idx_organizations_workspace_id on public.organizations (workspace_id);
create index if not exists idx_contacts_workspace_id on public.contacts (workspace_id);
create index if not exists idx_projects_workspace_id on public.projects (workspace_id);
create index if not exists idx_projects_workspace_status on public.projects (workspace_id, status);
create index if not exists idx_jobs_workspace_id on public.jobs (workspace_id);
create index if not exists idx_jobs_workspace_status on public.jobs (workspace_id, status);
create index if not exists idx_job_events_workspace_date on public.job_events (workspace_id, event_date);
create index if not exists idx_job_assignments_workspace_date on public.job_assignments (workspace_id, assignment_date);
create index if not exists idx_assets_workspace_kind_status on public.assets (workspace_id, kind, status);
create index if not exists idx_asset_calibrations_asset_id on public.asset_calibrations (asset_id);
create index if not exists idx_quotes_workspace_status on public.quotes (workspace_id, status);
create index if not exists idx_invoices_workspace_status on public.invoices (workspace_id, status);
create index if not exists idx_invoices_due_date on public.invoices (due_date);
create index if not exists idx_payments_invoice_id on public.payments (invoice_id);
create index if not exists idx_notifications_user_status on public.notifications (user_id, status);
create index if not exists idx_attachments_entity on public.attachments (workspace_id, entity_table, entity_id);
create index if not exists idx_attachments_workspace_chain_status on public.attachments (workspace_id, chain_status);
create unique index if not exists attachments_chain_tx_signature_key on public.attachments (chain_tx_signature) where chain_tx_signature is not null;
create index if not exists idx_audit_activity_workspace_created_at on audit.activity_log (workspace_id, created_at desc);
create index if not exists idx_workspace_licenses_tier_status on public.workspace_licenses (tier, status);
create index if not exists idx_license_events_workspace_created_at on public.license_events (workspace_id, created_at desc);

-- ── Marketplace listings ──

create table if not exists public.marketplace_listings (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references public.workspaces on delete cascade on update cascade,
  name text not null,
  type text not null,
  condition text not null,
  price numeric not null,
  currency text not null,
  seller text not null,
  location text not null,
  description text,
  specs text[],
  is_global boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Ensure the column exists on a pre-existing marketplace_listings table.
alter table public.marketplace_listings add column if not exists is_global boolean not null default false;
alter table public.marketplace_listings add column if not exists asset_id uuid references public.assets(id) on delete set null;

create index if not exists idx_marketplace_listings_workspace_id on public.marketplace_listings (workspace_id);

-- ── Marketplace orders ──

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  listing_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  listing_id uuid not null references public.marketplace_listings (id) on delete restrict,
  amount numeric(12, 2) not null,
  currency text not null,
  platform_fee_amount numeric(12, 2) not null default 0,
  provider text not null default 'manual',
  external_payment_ref text unique,
  payment_status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_marketplace_orders_buyer on public.marketplace_orders (buyer_workspace_id);
create index if not exists idx_marketplace_orders_listing on public.marketplace_orders (listing_id);

comment on table public.marketplace_orders is 'Optional order log (e.g. manual reconciliation). No payment processor is integrated.';

-- ── Marketplace requests (inquiries) ──

create table if not exists public.marketplace_requests (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid not null references public.marketplace_listings (id) on delete cascade,
  requester_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  requester_user_id      uuid not null references auth.users (id) on delete cascade,
  status                 text not null default 'pending',
  message                text,
  desired_start_date     date,
  desired_end_date       date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_marketplace_requests_listing on public.marketplace_requests (listing_id);
create index if not exists idx_marketplace_requests_requester on public.marketplace_requests (requester_workspace_id);

comment on table public.marketplace_requests is 'Lightweight inquiry/request for a marketplace listing. Status: pending, accepted, declined, cancelled.';

-- ── Professionals directory ──

create table if not exists public.professionals (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references public.workspaces on delete cascade on update cascade,
  name text not null,
  title text not null,
  discipline text not null,
  experience text not null,
  location text not null,
  rate numeric not null,
  rate_per text not null,
  currency text not null,
  availability text not null,
  rating numeric default 0,
  reviews integer default 0,
  skills text[],
  bio text,
  certifications text[],
  is_global boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Ensure the column exists on a pre-existing professionals table.
alter table public.professionals add column if not exists is_global boolean not null default false;

create index if not exists idx_professionals_workspace_id on public.professionals (workspace_id);

-- ── Project activities ──

create table if not exists public.project_activities (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null references public.projects (id) on delete cascade on update cascade,
  user_id uuid references auth.users (id) on delete set null,
  content text not null,
  activity_type text not null default 'note',
  created_at timestamptz default now() not null
);

create index if not exists idx_project_activities_project_id on public.project_activities (project_id);

-- ── Time tracking ──

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  entry_date date not null,
  task text not null,
  hours numeric(6,2) not null check (hours > 0),
  billable boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_time_entries_workspace_user_date
  on public.time_entries (workspace_id, user_id, entry_date desc);

-- ── Expense tracking ──

create table if not exists public.expense_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  entry_date date not null,
  category text not null,
  amount numeric(12,2) not null check (amount >= 0),
  vendor text,
  reimbursable boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expense_entries_workspace_user_date
  on public.expense_entries (workspace_id, user_id, entry_date desc);

-- ── Promo code rules ──

create table if not exists public.promo_code_rules (
  code text primary key,
  trial_days integer,
  signup_tier public.license_tier,
  signup_license_status public.license_status default 'trialing',
  seat_bonus integer not null default 0,
  project_cap_boost integer not null default 0,
  asset_cap_boost integer not null default 0,
  active boolean not null default true
);

comment on table public.promo_code_rules is 'Maps signup promo codes to license trials and cap boosts.';

-- ── Payment methods ──

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (type in ('Card', 'Mobile Money', 'Bank Transfer', 'Crypto Wallet')),
  label text not null,
  detail text not null,
  holder text,
  expiry text,
  is_default boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Refresh the type check on a pre-existing payment_methods table so the
-- 'Crypto Wallet' option is always allowed.
alter table public.payment_methods drop constraint if exists payment_methods_type_check;
alter table public.payment_methods
  add constraint payment_methods_type_check
  check (type in ('Card', 'Mobile Money', 'Bank Transfer', 'Crypto Wallet'));

create index if not exists idx_payment_methods_workspace on public.payment_methods (workspace_id);

-- ── Surveyor CAD drawings (one drawing model per project) ──

create table if not exists public.project_cad_drawings (
  project_id uuid primary key
    references public.projects (id) on delete cascade on update cascade,
  workspace_id uuid not null
    references public.workspaces (id) on delete cascade,
  model jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_cad_drawings_workspace_id
  on public.project_cad_drawings (workspace_id);

-- ── System Features (subscribable add-ons) ──

DO $$ BEGIN
  create type public.feature_request_status as enum ('pending', 'approved', 'declined');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  create type public.feature_entitlement_status as enum ('active', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  create type public.feature_billing_period as enum ('one_time', 'monthly', 'annual');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Global catalog of subscribable features (platform-admin managed).
create table if not exists public.feature_catalog (
  key text primary key,
  name text not null,
  description text,
  category text not null default 'General',
  price numeric not null default 0,
  currency text not null default 'USD',
  billing_period public.feature_billing_period not null default 'monthly',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Request / approval workflow for feature access.
create table if not exists public.feature_access_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  feature_key text not null references public.feature_catalog (key) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  status public.feature_request_status not null default 'pending',
  note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feature_access_requests_workspace
  on public.feature_access_requests (workspace_id);
create index if not exists idx_feature_access_requests_status
  on public.feature_access_requests (status);

-- At most one pending request per (workspace, feature).
create unique index if not exists uq_feature_access_requests_pending
  on public.feature_access_requests (workspace_id, feature_key)
  where status = 'pending';

-- The granted access.
create table if not exists public.workspace_feature_entitlements (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  feature_key text not null references public.feature_catalog (key) on delete cascade,
  status public.feature_entitlement_status not null default 'active',
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature_key)
);

-- ── Seed workspace_licenses for existing workspaces ──

insert into public.workspace_licenses (workspace_id)
select w.id
from public.workspaces w
on conflict (workspace_id) do nothing;

-- ── Embedded Solana wallets (open-source app wallet) ──
-- The secret key and optional seed phrase are encrypted client-side with a
-- user PIN. The server only stores the ciphertext, IVs, and salt.

create table if not exists public.embedded_solana_wallets (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  wallet_address    text        not null,
  encrypted_key     text        not null,
  iv                text        not null,
  salt              text        not null,
  encrypted_mnemonic text      null,
  mnemonic_iv        text      null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint embedded_solana_wallets_user_id_check
    check (user_id = auth.uid())
);

create index if not exists idx_embedded_solana_wallets_address
  on public.embedded_solana_wallets (wallet_address);


commit;
