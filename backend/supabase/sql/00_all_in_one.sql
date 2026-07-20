-- 01_setup.sql — SiteSurveyor Engineering cloud schema (single all-in-one file).
--
-- The complete cloud schema in one manageable file: extensions, enums, tables,
-- indexes, functions, triggers, RLS, storage buckets/policies, plus idempotent
-- seeds and backfills at the end. Paste into the Supabase SQL editor and run.
--
-- Fully idempotent and safe to re-run on ANY project (fresh or existing):
--   * tables/indexes use CREATE ... IF NOT EXISTS
--   * enums are guarded with DO $$ ... EXCEPTION WHEN duplicate_object
--   * functions use CREATE OR REPLACE
--   * triggers and policies DROP ... IF EXISTS before CREATE
--   * seeds/backfills use ON CONFLICT DO NOTHING or NOT EXISTS guards
-- Re-running will not error on "already exists" and will not duplicate data.
--
-- Includes everything previously split across 99_post_deploy.sql and the
-- migrations/ folder (is_global flags, on-chain payments, crypto payment method,
-- Surveyor CAD drawings, and the System Features catalog).

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
create index if not exists idx_audit_activity_workspace_created_at on audit.activity_log (workspace_id, created_at desc);
create index if not exists idx_workspace_licenses_tier_status on public.workspace_licenses (tier, status);
create index if not exists idx_license_events_workspace_created_at on public.license_events (workspace_id, created_at desc);

-- ── Marketplace listings ──

create table if not exists public.marketplace_listings (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references public.workspaces on delete cascade on update cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  listing_type text not null default 'sale',
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

-- Ensure columns exist on a pre-existing marketplace_listings table.
alter table public.marketplace_listings add column if not exists is_global boolean not null default false;
alter table public.marketplace_listings add column if not exists asset_id uuid references public.assets(id) on delete cascade;
alter table public.marketplace_listings add column if not exists listing_type text not null default 'sale';

create index if not exists idx_marketplace_listings_workspace_id on public.marketplace_listings (workspace_id);
create index if not exists idx_marketplace_listings_asset_id on public.marketplace_listings (asset_id);

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
  user_id            uuid primary key references auth.users (id) on delete cascade,
  wallet_address     text        not null,
  encrypted_key      text        not null,
  iv                 text        not null,
  salt               text        not null,
  encrypted_mnemonic text        null,
  mnemonic_iv        text        null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint embedded_solana_wallets_user_id_check
    check (user_id = auth.uid())
);

create index if not exists idx_embedded_solana_wallets_address
  on public.embedded_solana_wallets (wallet_address);


-- ===========================================================================
-- functions
-- ===========================================================================



create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.log_workspace_license_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.tier is distinct from new.tier or old.status is distinct from new.status or old.notes is distinct from new.notes then
      insert into public.license_events (
        workspace_id,
        changed_by,
        previous_tier,
        new_tier,
        previous_status,
        new_status,
        notes
      )
      values (
        new.workspace_id,
        auth.uid(),
        old.tier,
        new.tier,
        old.status,
        new.status,
        new.notes
      );
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.license_events (
      workspace_id,
      changed_by,
      previous_tier,
      new_tier,
      previous_status,
      new_status,
      notes
    )
    values (
      new.workspace_id,
      auth.uid(),
      null,
      new.tier,
      null,
      new.status,
      new.notes
    );
    return new;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.path_first_segment_uuid(path text)
returns uuid
language plpgsql
immutable
as $$
declare
  first_segment text;
begin
  first_segment := split_part(path, '/', 1);

  if first_segment ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return first_segment::uuid;
  end if;

  return null;
end;
$$;

create or replace function public.slugify(value text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')),
    ''
  );
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function public.has_workspace_role(
  target_workspace_id uuid,
  allowed_roles public.workspace_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = any (allowed_roles)
  );
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array['owner'::public.workspace_member_role, 'admin'::public.workspace_member_role]
  );
$$;

create or replace function public.get_workspace_license_tier(target_workspace_id uuid)
returns public.license_tier
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select wl.tier
      from public.workspace_licenses wl
      where wl.workspace_id = target_workspace_id
      limit 1
    ),
    'free'::public.license_tier
  );
$$;

create or replace function public.is_workspace_license_active(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_licenses wl
    where wl.workspace_id = target_workspace_id
      and wl.status in ('trialing', 'active')
      and (wl.ends_at is null or wl.ends_at > now())
  );
$$;

create or replace function public.workspace_has_tier(
  target_workspace_id uuid,
  minimum_tier public.license_tier
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      case public.get_workspace_license_tier(target_workspace_id)
        when 'free' then 1
        when 'pro' then 2
        when 'enterprise' then 3
      end as actual_rank,
      case minimum_tier
        when 'free' then 1
        when 'pro' then 2
        when 'enterprise' then 3
      end as required_rank
  )
  select actual_rank >= required_rank from ranked;
$$;

create or replace function public.can_manage_operations(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array[
      'owner'::public.workspace_member_role,
      'admin'::public.workspace_member_role,
      'ops_manager'::public.workspace_member_role
    ]
  );
$$;

create or replace function public.can_manage_finance(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array[
      'owner'::public.workspace_member_role,
      'admin'::public.workspace_member_role,
      'finance'::public.workspace_member_role
    ]
  );
$$;

create or replace function public.can_manage_sales(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array[
      'owner'::public.workspace_member_role,
      'admin'::public.workspace_member_role,
      'sales'::public.workspace_member_role
    ]
  );
$$;

create or replace function public.can_manage_assets(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array[
      'owner'::public.workspace_member_role,
      'admin'::public.workspace_member_role,
      'ops_manager'::public.workspace_member_role,
      'technician'::public.workspace_member_role
    ]
  );
$$;

create or replace function public.can_manage_documents(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_workspace_role(
    target_workspace_id,
    array[
      'owner'::public.workspace_member_role,
      'admin'::public.workspace_member_role,
      'ops_manager'::public.workspace_member_role,
      'finance'::public.workspace_member_role,
      'sales'::public.workspace_member_role
    ]
  );
$$;

create or replace function public.shares_workspace_with_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = target_profile_id
      and theirs.status = 'active'
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  full_name_value text;
  workspace_name_value text;
  workspace_type_value public.workspace_type;
  workspace_slug_value text;
  created_workspace_id uuid;
  signup_account_type_value text;
begin
  full_name_value := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  signup_account_type_value := case lower(trim(coalesce(new.raw_user_meta_data ->> 'account_type', '')))
    when 'personal' then 'personal'
    when 'business' then 'business'
    when 'platform_admin' then 'platform_admin'
    else null
  end;

  workspace_type_value := case
    when coalesce(new.raw_user_meta_data ->> 'account_type', 'personal') = 'business'
      then 'business'::public.workspace_type
    else 'personal'::public.workspace_type
  end;

  workspace_name_value := coalesce(
    nullif(new.raw_user_meta_data ->> 'workspace_name', ''),
    nullif(new.raw_user_meta_data ->> 'company', ''),
    case
      when workspace_type_value = 'business' then full_name_value || ' Workspace'
      else full_name_value || ' Personal Workspace'
    end
  );

  workspace_slug_value := public.slugify(workspace_name_value);

  insert into public.workspaces (
    name,
    slug,
    type,
    owner_user_id
  )
  values (
    workspace_name_value,
    workspace_slug_value,
    workspace_type_value,
    new.id
  )
  returning id into created_workspace_id;

  insert into public.workspace_settings (workspace_id)
  values (created_workspace_id);

  insert into public.workspace_licenses (workspace_id)
  values (created_workspace_id)
  on conflict (workspace_id) do nothing;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    created_workspace_id,
    new.id,
    'owner',
    'active',
    now()
  );

  insert into public.profiles (
    id,
    email,
    full_name,
    promo_code,
    default_workspace_id,
    auth_signup_account_type
  )
  values (
    new.id,
    new.email,
    full_name_value,
    nullif(new.raw_user_meta_data ->> 'promo_code', ''),
    created_workspace_id,
    signup_account_type_value
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        promo_code = coalesce(excluded.promo_code, public.profiles.promo_code),
        default_workspace_id = coalesce(public.profiles.default_workspace_id, excluded.default_workspace_id),
        auth_signup_account_type = coalesce(
          public.profiles.auth_signup_account_type,
          excluded.auth_signup_account_type
        ),
        updated_at = now();

  return new;
end;
$$;

create or replace function public.create_business_workspace(
  workspace_name text,
  workspace_slug text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
  v_slug text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if coalesce(trim(workspace_name), '') = '' then
    raise exception 'Workspace name is required.';
  end if;

  v_slug := public.slugify(coalesce(nullif(workspace_slug, ''), workspace_name));

  insert into public.workspaces (
    name,
    slug,
    type,
    owner_user_id
  )
  values (
    trim(workspace_name),
    v_slug,
    'business',
    v_user_id
  )
  returning id into v_workspace_id;

  insert into public.workspace_settings (workspace_id)
  values (v_workspace_id);

  insert into public.workspace_licenses (workspace_id)
  values (v_workspace_id)
  on conflict (workspace_id) do nothing;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    v_workspace_id,
    v_user_id,
    'owner',
    'active',
    now()
  );

  update public.profiles
  set default_workspace_id = coalesce(default_workspace_id, v_workspace_id),
      updated_at = now()
  where id = v_user_id;

  return v_workspace_id;
end;
$$;

create or replace function public.accept_workspace_invitation(
  target_invitation_token uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_user_email text;
  v_invitation public.workspace_invitations%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select email
  into v_user_email
  from auth.users
  where id = v_user_id;

  select *
  into v_invitation
  from public.workspace_invitations
  where invitation_token = target_invitation_token
    and accepted_at is null
    and expires_at > now();

  if v_invitation.id is null then
    raise exception 'Invitation is invalid or expired.';
  end if;

  if not public.is_business_workspace(v_invitation.workspace_id) then
    raise exception 'Workspace invitations are only available for business workspaces.';
  end if;

  if lower(coalesce(v_user_email, '')) <> lower(v_invitation.email) then
    raise exception 'Invitation email does not match the signed-in user.';
  end if;

  insert into public.workspace_members (
    workspace_id,
    user_id,
    role,
    status,
    invited_at,
    joined_at
  )
  values (
    v_invitation.workspace_id,
    v_user_id,
    v_invitation.role,
    'active',
    v_invitation.created_at,
    now()
  )
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        invited_at = coalesce(public.workspace_members.invited_at, excluded.invited_at),
        joined_at = coalesce(public.workspace_members.joined_at, excluded.joined_at),
        updated_at = now();

  update public.workspace_invitations
  set accepted_at = now()
  where id = v_invitation.id;

  return v_invitation.workspace_id;
end;
$$;

create or replace function public.set_default_workspace(
  target_workspace_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if not public.is_workspace_member(target_workspace_id) then
    raise exception 'You are not a member of this workspace.';
  end if;

  update public.profiles
  set default_workspace_id = target_workspace_id,
      updated_at = now()
  where id = v_user_id;

  return true;
end;
$$;

-- Bypasses RLS on profiles lookup; otherwise profiles_select_platform_admin + is_platform_admin() recurse infinitely.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

comment on function public.is_platform_admin() is
  'True when profiles.is_platform_admin for auth.uid(). SECURITY DEFINER avoids RLS recursion.';

-- ── Business workspace helpers (from post_deploy) ──

create or replace function public.is_business_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and w.type = 'business'
      and w.archived_at is null
  );
$$;

create or replace function public.can_manage_business_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_business_workspace(target_workspace_id)
    and public.can_manage_workspace(target_workspace_id);
$$;

create or replace function public.can_manage_business_operations(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_business_workspace(target_workspace_id)
    and public.can_manage_operations(target_workspace_id);
$$;

create or replace function public.enforce_business_workspace_for_team_and_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := coalesce(new.workspace_id, old.workspace_id);

  if v_workspace_id is null then
    raise exception 'A workspace_id is required.';
  end if;

  if not public.is_business_workspace(v_workspace_id) then
    raise exception 'This action is only available for business workspaces.';
  end if;

  return coalesce(new, old);
end;
$$;

-- ── License status guard (platform admin only, with billing sync bypass) ──

create or replace function public.enforce_workspace_license_status_platform_admin()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if coalesce(current_setting('app.billing_license_sync', true), '') = '1' then
      return new;
    end if;
    if not public.is_platform_admin() then
      raise exception 'License status may only be changed by platform administrators';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_workspace_license_status_platform_admin() is
  'Rejects workspace_licenses.status updates unless profiles.is_platform_admin is true for auth.uid().';

-- ── Tier → cap alignment ──

create or replace function public.workspace_license_align_caps_with_tier()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tier is distinct from old.tier
     and coalesce(current_setting('app.billing_license_sync', true), '') <> '1'
  then
    case new.tier
      when 'free' then
        new.seat_limit := 1;
        new.project_cap := 12;
        new.asset_cap := 60;
        new.storage_cap_bytes := 536870912;
      when 'pro' then
        new.seat_limit := 25;
        new.project_cap := null;
        new.asset_cap := null;
        new.storage_cap_bytes := 5368709120;
      when 'enterprise' then
        new.seat_limit := null;
        new.project_cap := null;
        new.asset_cap := null;
        new.storage_cap_bytes := null;
    end case;
  end if;
  return new;
end;
$$;

-- ── Usage helpers ──

create or replace function public.workspace_occupied_seats(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select count(*)::integer from public.workspace_members m where m.workspace_id = p_workspace_id and m.status = 'active'), 0)
    + coalesce((select count(*)::integer from public.workspace_invitations i where i.workspace_id = p_workspace_id and i.expires_at > now()), 0);
$$;

create or replace function public.workspace_active_project_count(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.projects p
  where p.workspace_id = p_workspace_id
    and p.archived_at is null
    and p.status <> 'archived'::public.project_status;
$$;

-- ── Promo code application ──

create or replace function public.apply_promo_code_to_workspace(p_workspace_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.promo_code_rules%rowtype;
  v_code text := lower(trim(coalesce(p_code, '')));
begin
  if v_code = '' then
    return;
  end if;

  select * into r
  from public.promo_code_rules
  where lower(code) = v_code and active;

  if not found then
    return;
  end if;

  perform set_config('app.billing_license_sync', '1', true);

  if r.signup_tier = 'pro' then
    update public.workspace_licenses wl
    set
      tier = 'pro',
      status = coalesce(r.signup_license_status, wl.status),
      trial_ends_at = case
        when r.trial_days is not null then now() + (r.trial_days::text || ' days')::interval
        else wl.trial_ends_at
      end,
      seat_limit = 25 + coalesce(r.seat_bonus, 0),
      project_cap = null,
      asset_cap = null,
      storage_cap_bytes = 5368709120,
      notes = trim(both ' ' from concat(coalesce(wl.notes, ''), ' promo:', r.code)),
      is_manual = false,
      updated_at = now()
    where wl.workspace_id = p_workspace_id;
    return;
  end if;

  if r.signup_tier = 'enterprise' then
    update public.workspace_licenses wl
    set
      tier = 'enterprise',
      status = coalesce(r.signup_license_status, wl.status),
      trial_ends_at = case
        when r.trial_days is not null then now() + (r.trial_days::text || ' days')::interval
        else wl.trial_ends_at
      end,
      seat_limit = null,
      project_cap = null,
      asset_cap = null,
      storage_cap_bytes = null,
      notes = trim(both ' ' from concat(coalesce(wl.notes, ''), ' promo:', r.code)),
      is_manual = false,
      updated_at = now()
    where wl.workspace_id = p_workspace_id;
    return;
  end if;

  update public.workspace_licenses wl
  set
    trial_ends_at = case
      when r.trial_days is not null then now() + (r.trial_days::text || ' days')::interval
      else wl.trial_ends_at
    end,
    seat_limit = case
      when wl.seat_limit is null then null
      else wl.seat_limit + r.seat_bonus
    end,
    project_cap = case
      when wl.project_cap is null then null
      else wl.project_cap + r.project_cap_boost
    end,
    asset_cap = case
      when wl.asset_cap is null then null
      else wl.asset_cap + r.asset_cap_boost
    end,
    notes = trim(both ' ' from concat(coalesce(wl.notes, ''), ' promo:', r.code)),
    is_manual = false,
    updated_at = now()
  where wl.workspace_id = p_workspace_id;
end;
$$;

revoke all on function public.apply_promo_code_to_workspace(uuid, text) from public;
grant execute on function public.apply_promo_code_to_workspace(uuid, text) to service_role;

create or replace function public.trigger_profiles_apply_promo_entitlements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promo_code is not null
     and trim(new.promo_code) <> ''
     and new.default_workspace_id is not null
  then
    perform public.apply_promo_code_to_workspace(new.default_workspace_id, new.promo_code);
  end if;
  return new;
end;
$$;

-- ── Seat / cap enforcement ──

create or replace function public.enforce_workspace_seat_limit_on_member()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  lim integer;
  occ integer;
begin
  select wl.seat_limit into lim
  from public.workspace_licenses wl
  where wl.workspace_id = new.workspace_id;

  if lim is null then
    return new;
  end if;

  occ := public.workspace_occupied_seats(new.workspace_id);
  if occ >= lim then
    raise exception 'Workspace seat limit reached (%). Upgrade your plan or revoke pending invites.', lim;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_seat_limit_on_invitation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  lim integer;
  occ integer;
begin
  select wl.seat_limit into lim
  from public.workspace_licenses wl
  where wl.workspace_id = new.workspace_id;

  if lim is null then
    return new;
  end if;

  occ := public.workspace_occupied_seats(new.workspace_id);
  if occ >= lim then
    raise exception 'Workspace seat limit reached (%). Upgrade your plan or remove pending invites.', lim;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_project_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  cap integer;
  cnt integer;
begin
  select wl.project_cap into cap
  from public.workspace_licenses wl
  where wl.workspace_id = new.workspace_id;

  if cap is null then
    return new;
  end if;

  cnt := public.workspace_active_project_count(new.workspace_id);
  if cnt >= cap then
    raise exception 'Project limit reached (%). Upgrade your plan.', cap;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_asset_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  cap integer;
  cnt integer;
begin
  select wl.asset_cap into cap
  from public.workspace_licenses wl
  where wl.workspace_id = new.workspace_id;

  if cap is null then
    return new;
  end if;

  select count(*)::integer into cnt
  from public.assets a
  where a.workspace_id = new.workspace_id;

  if cnt >= cap then
    raise exception 'Asset (instrument) limit reached (%). Upgrade your plan.', cap;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workspace_storage_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  cap bigint;
  used bigint;
  add_bytes bigint;
begin
  select wl.storage_cap_bytes into cap
  from public.workspace_licenses wl
  where wl.workspace_id = new.workspace_id;

  if cap is null then
    return new;
  end if;

  select coalesce(sum(a.size_bytes), 0)::bigint into used
  from public.attachments a
  where a.workspace_id = new.workspace_id;

  add_bytes := coalesce(new.size_bytes, 0)::bigint;
  if used + add_bytes > cap then
    raise exception 'Storage limit reached. Free space or upgrade your plan.';
  end if;
  return new;
end;
$$;

-- ── Usage snapshot RPC ──

create or replace function public.get_workspace_usage(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wl public.workspace_licenses%rowtype;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not allowed';
  end if;

  select * into wl from public.workspace_licenses where workspace_id = p_workspace_id;

  return jsonb_build_object(
    'tier', wl.tier,
    'status', wl.status,
    'seat_limit', wl.seat_limit,
    'seats_used', public.workspace_occupied_seats(p_workspace_id),
    'project_cap', wl.project_cap,
    'projects_used', public.workspace_active_project_count(p_workspace_id),
    'asset_cap', wl.asset_cap,
    'assets_used', (select count(*)::integer from public.assets a where a.workspace_id = p_workspace_id),
    'storage_cap_bytes', wl.storage_cap_bytes,
    'storage_used_bytes', (select coalesce(sum(a.size_bytes), 0)::bigint from public.attachments a where a.workspace_id = p_workspace_id)
  );
end;
$$;

grant execute on function public.get_workspace_usage(uuid) to authenticated;

-- ── Payment method default setter ──

create or replace function public.set_default_payment_method(
  p_workspace_id uuid,
  p_method_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.has_workspace_role(p_workspace_id, array['owner'::public.workspace_member_role, 'admin'::public.workspace_member_role])
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions to set default payment method.';
  end if;

  update public.payment_methods
  set is_default = false, updated_at = now()
  where workspace_id = p_workspace_id
    and is_default = true;

  update public.payment_methods
  set is_default = true, updated_at = now()
  where id = p_method_id
    and workspace_id = p_workspace_id;
end;
$$;

-- ── Admin expanded capabilities RPCs ──

create or replace function public.admin_list_audit_log(
  p_limit  int     default 50,
  p_offset int     default 0,
  p_workspace_id uuid default null,
  p_action text   default null
)
returns table (
  id          bigint,
  workspace_id uuid,
  actor_user_id uuid,
  entity_table text,
  entity_id    uuid,
  action       text,
  details      jsonb,
  created_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may read the audit log.';
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
    where (p_workspace_id is null or a.workspace_id = p_workspace_id)
      and (p_action is null or a.action = p_action)
    order by a.created_at desc
    limit p_limit
    offset p_offset;
end;
$$;

comment on function public.admin_list_audit_log(int, int, uuid, text) is
  'SECURITY DEFINER RPC so platform admins can read audit.activity_log without direct schema access.';

create or replace function public.admin_workspace_summary(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may access workspace summaries.';
  end if;

  select jsonb_build_object(
    'projects',  (select count(*) from public.projects    where workspace_id = p_workspace_id),
    'assets',    (select count(*) from public.assets      where workspace_id = p_workspace_id),
    'invoices',  (select count(*) from public.invoices    where workspace_id = p_workspace_id),
    'quotes',    (select count(*) from public.quotes      where workspace_id = p_workspace_id),
    'contacts',  (select count(*) from public.contacts    where workspace_id = p_workspace_id),
    'jobs',      (select count(*) from public.jobs        where workspace_id = p_workspace_id),
    'members',   (select count(*) from public.workspace_members where workspace_id = p_workspace_id)
  ) into result;

  return result;
end;
$$;

comment on function public.admin_workspace_summary(uuid) is
  'Returns entity counts for a workspace. Platform admin only.';

-- ── CAD drawings updated_at touch ──

create or replace function public.touch_project_cad_drawings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── System feature touch helpers ──

create or replace function public.touch_feature_catalog()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_feature_access_requests()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.touch_workspace_feature_entitlements()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Feature entitlement helper ──

create or replace function public.has_feature(
  p_workspace_id uuid,
  p_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_feature_entitlements e
    where e.workspace_id = p_workspace_id
      and e.feature_key = p_feature_key
      and e.status = 'active'
  );
$$;

comment on function public.has_feature(uuid, text) is
  'True when the workspace holds an active entitlement for the given feature key.';

-- ── Feature request approve / decline RPCs (platform admin only) ──

create or replace function public.admin_approve_feature_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.feature_access_requests%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may approve feature requests.';
  end if;

  select * into r from public.feature_access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Feature request not found.';
  end if;

  update public.feature_access_requests
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_request_id;

  insert into public.workspace_feature_entitlements (workspace_id, feature_key, status, granted_by)
  values (r.workspace_id, r.feature_key, 'active', auth.uid())
  on conflict (workspace_id, feature_key)
    do update set status = 'active', granted_by = auth.uid();
end;
$$;

create or replace function public.admin_decline_feature_request(
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators may decline feature requests.';
  end if;

  update public.feature_access_requests
    set status = 'declined',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        note = coalesce(p_note, note)
    where id = p_request_id;

  if not found then
    raise exception 'Feature request not found.';
  end if;
end;
$$;


-- ===========================================================================
-- triggers
-- ===========================================================================



drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

drop trigger if exists log_workspace_license_event_trigger on public.workspace_licenses;
create trigger log_workspace_license_event_trigger
after insert or update on public.workspace_licenses
for each row execute function public.log_workspace_license_event();

-- ── set_updated_at triggers for all tables ──

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'workspaces',
    'workspace_settings',
    'workspace_licenses',
    'workspace_members',
    'organizations',
    'contacts',
    'projects',
    'jobs',
    'job_events',
    'job_assignments',
    'assets',
    'asset_calibrations',
    'asset_maintenance_events',
    'quotes',
    'quote_items',
    'invoices',
    'invoice_items',
    'payments',
    'time_entries',
    'expense_entries'
  ]
  loop
    execute format('drop trigger if exists set_updated_at_%1$s on public.%1$s', target_table);
    execute format(
      'create trigger set_updated_at_%1$s before update on public.%1$s for each row execute function public.set_updated_at()',
      target_table
    );
  end loop;
end;
$$;

-- ── Business workspace enforcement ──

drop trigger if exists enforce_business_workspace_on_workspace_invitations on public.workspace_invitations;
create trigger enforce_business_workspace_on_workspace_invitations
before insert or update on public.workspace_invitations
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

drop trigger if exists enforce_business_workspace_on_jobs on public.jobs;
create trigger enforce_business_workspace_on_jobs
before insert or update on public.jobs
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

drop trigger if exists enforce_business_workspace_on_job_events on public.job_events;
create trigger enforce_business_workspace_on_job_events
before insert or update on public.job_events
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

drop trigger if exists enforce_business_workspace_on_job_assignments on public.job_assignments;
create trigger enforce_business_workspace_on_job_assignments
before insert or update on public.job_assignments
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

drop trigger if exists enforce_business_workspace_on_job_assignment_members on public.job_assignment_members;
create trigger enforce_business_workspace_on_job_assignment_members
before insert or update on public.job_assignment_members
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

drop trigger if exists enforce_business_workspace_on_job_assignment_assets on public.job_assignment_assets;
create trigger enforce_business_workspace_on_job_assignment_assets
before insert or update on public.job_assignment_assets
for each row execute function public.enforce_business_workspace_for_team_and_dispatch();

-- ── License status guard ──

drop trigger if exists workspace_license_status_guard on public.workspace_licenses;
create trigger workspace_license_status_guard
before update on public.workspace_licenses
for each row
execute function public.enforce_workspace_license_status_platform_admin();

-- ── Tier → cap alignment ──

drop trigger if exists workspace_license_tier_caps on public.workspace_licenses;
create trigger workspace_license_tier_caps
before update on public.workspace_licenses
for each row
execute function public.workspace_license_align_caps_with_tier();

-- ── Promo code application on profile insert ──

drop trigger if exists profiles_apply_promo_entitlements on public.profiles;
create trigger profiles_apply_promo_entitlements
after insert on public.profiles
for each row
execute function public.trigger_profiles_apply_promo_entitlements();

-- ── Seat / usage cap enforcement ──

drop trigger if exists workspace_members_seat_limit on public.workspace_members;
create trigger workspace_members_seat_limit
before insert on public.workspace_members
for each row
execute function public.enforce_workspace_seat_limit_on_member();

drop trigger if exists workspace_invitations_seat_limit on public.workspace_invitations;
create trigger workspace_invitations_seat_limit
before insert on public.workspace_invitations
for each row
execute function public.enforce_workspace_seat_limit_on_invitation();

drop trigger if exists projects_workspace_cap on public.projects;
create trigger projects_workspace_cap
before insert on public.projects
for each row
execute function public.enforce_workspace_project_cap();

drop trigger if exists assets_workspace_cap on public.assets;
create trigger assets_workspace_cap
before insert on public.assets
for each row
execute function public.enforce_workspace_asset_cap();

drop trigger if exists attachments_storage_cap on public.attachments;
create trigger attachments_storage_cap
before insert on public.attachments
for each row
execute function public.enforce_workspace_storage_cap();

-- ── CAD drawings updated_at ──

drop trigger if exists trg_touch_project_cad_drawings on public.project_cad_drawings;
create trigger trg_touch_project_cad_drawings
before update on public.project_cad_drawings
for each row execute function public.touch_project_cad_drawings();

-- ── System feature updated_at touches ──

drop trigger if exists trg_touch_feature_catalog on public.feature_catalog;
create trigger trg_touch_feature_catalog
before update on public.feature_catalog
for each row execute function public.touch_feature_catalog();

drop trigger if exists trg_touch_feature_access_requests on public.feature_access_requests;
create trigger trg_touch_feature_access_requests
before update on public.feature_access_requests
for each row execute function public.touch_feature_access_requests();

drop trigger if exists trg_touch_workspace_feature_entitlements on public.workspace_feature_entitlements;
create trigger trg_touch_workspace_feature_entitlements
before update on public.workspace_feature_entitlements
for each row execute function public.touch_workspace_feature_entitlements();

-- ── Project creator membership ──

create or replace function public.ensure_project_creator_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.project_members (workspace_id, project_id, user_id, role)
    values (new.workspace_id, new.id, new.created_by, 'manager')
    on conflict (project_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_project_creator_member on public.projects;
create trigger trg_ensure_project_creator_member
after insert on public.projects
for each row execute function public.ensure_project_creator_member();


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
alter table public.marketplace_requests enable row level security;
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

-- ── Marketplace requests (inquiries) ──

-- Requester can see their own; listing workspace members can see requests on their listings.
drop policy if exists "marketplace_requests_select" on public.marketplace_requests;
create policy "marketplace_requests_select"
on public.marketplace_requests
for select
to authenticated
using (
  requester_user_id = auth.uid()
  or exists (
    select 1 from public.marketplace_listings ml
    where ml.id = listing_id
      and public.is_workspace_member(ml.workspace_id)
  )
);

-- Any authenticated user can create a request.
drop policy if exists "marketplace_requests_insert" on public.marketplace_requests;
create policy "marketplace_requests_insert"
on public.marketplace_requests
for insert
to authenticated
with check (
  requester_user_id = auth.uid()
);

-- Requester can cancel; listing owner can accept/decline.
drop policy if exists "marketplace_requests_update" on public.marketplace_requests;
create policy "marketplace_requests_update"
on public.marketplace_requests
for update
to authenticated
using (
  requester_user_id = auth.uid()
  or exists (
    select 1 from public.marketplace_listings ml
    where ml.id = listing_id
      and public.can_manage_workspace(ml.workspace_id)
  )
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


-- ===========================================================================
-- seed_and_backfill
-- ===========================================================================
--
-- Idempotent seeds and backfills. On a fresh project the backfills are no-ops
-- (no existing auth users); they also make this file safe to re-run.


-- ── Seed: feature catalog (CAD Engine is the first feature) ──

insert into public.feature_catalog (key, name, description, category, price, currency, billing_period)
values (
  'cad_engine',
  'SurveyorAI CAD',
  'AI-powered CAD engine for engineering surveying: a full-screen drafting workspace with points, linework, surfaces (TIN), layers, COGO and DXF export, plus AI-assisted drafting. Unlocks all CAD-backed project tools.',
  'Drafting & Computation',
  20,
  'USD',
  'monthly'
)
on conflict (key) do nothing;

-- Listing assets/instruments for hire in the Marketplace is free for every
-- workspace, so no 'marketplace_hire' feature/permission is seeded. Any
-- workspace admin can publish, edit and remove their own hire listings.

-- ── Seed: promo code rules ──

insert into public.promo_code_rules (code, trial_days, signup_tier, signup_license_status, seat_bonus, project_cap_boost, asset_cap_boost, active)
values
  ('EARLYBIRD', 21, 'pro', 'trialing', 5, 10, 25, true),
  ('FIELDCREW', 14, 'pro', 'trialing', 2, 5, 15, true)
on conflict (code) do nothing;

-- ── Backfill: create profiles for auth users missing one ──

with users_missing_profile as (
  select
    u.id,
    u.email,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(u.email, ''), '@', 1)
    ) as full_name,
    nullif(u.raw_user_meta_data ->> 'promo_code', '') as promo_code,
    case lower(trim(coalesce(u.raw_user_meta_data ->> 'account_type', '')))
      when 'personal' then 'personal'
      when 'business' then 'business'
      when 'platform_admin' then 'platform_admin'
      else null
    end as auth_signup_account_type
  from auth.users u
  left join public.profiles p
    on p.id = u.id
  where p.id is null
)
insert into public.profiles (
  id,
  email,
  full_name,
  promo_code,
  auth_signup_account_type
)
select
  id,
  email,
  full_name,
  promo_code,
  auth_signup_account_type
from users_missing_profile;

-- ── Backfill: create workspaces for users without memberships ──

with users_without_workspace_membership as (
  select
    u.id,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(u.email, ''), '@', 1)
    ) as full_name,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'workspace_name', ''),
      nullif(u.raw_user_meta_data ->> 'company', ''),
      case
        when coalesce(u.raw_user_meta_data ->> 'account_type', 'personal') = 'business'
          then coalesce(
            nullif(u.raw_user_meta_data ->> 'full_name', ''),
            nullif(u.raw_user_meta_data ->> 'name', ''),
            split_part(coalesce(u.email, ''), '@', 1)
          ) || ' Workspace'
        else coalesce(
          nullif(u.raw_user_meta_data ->> 'full_name', ''),
          nullif(u.raw_user_meta_data ->> 'name', ''),
          split_part(coalesce(u.email, ''), '@', 1)
        ) || ' Personal Workspace'
      end
    ) as workspace_name,
    case
      when coalesce(u.raw_user_meta_data ->> 'account_type', 'personal') = 'business'
        then 'business'::public.workspace_type
      else 'personal'::public.workspace_type
    end as workspace_type
  from auth.users u
  left join public.workspace_members wm
    on wm.user_id = u.id
  where wm.user_id is null
),
inserted_workspaces as (
  insert into public.workspaces (
    name,
    slug,
    type,
    owner_user_id
  )
  select
    uwm.workspace_name,
    left(
      coalesce(public.slugify(uwm.workspace_name), 'workspace') || '-' || replace(uwm.id::text, '-', ''),
      255
    ),
    uwm.workspace_type,
    uwm.id
  from users_without_workspace_membership uwm
  returning id, owner_user_id
),
ins_workspace_settings as (
  insert into public.workspace_settings (workspace_id)
  select iw.id
  from inserted_workspaces iw
  on conflict (workspace_id) do nothing
  returning workspace_id
),
ins_workspace_licenses as (
  insert into public.workspace_licenses (workspace_id)
  select iw.id
  from inserted_workspaces iw
  on conflict (workspace_id) do nothing
  returning workspace_id
)
select 1;

-- ── Backfill: assign workspace membership to orphan users ──

with users_without_workspace_membership as (
  select
    u.id
  from auth.users u
  left join public.workspace_members wm
    on wm.user_id = u.id
  where wm.user_id is null
),
target_workspaces as (
  select
    w.id as workspace_id,
    w.owner_user_id as user_id
  from public.workspaces w
  join users_without_workspace_membership uwm
    on uwm.id = w.owner_user_id
)
insert into public.workspace_members (
  workspace_id,
  user_id,
  role,
  status,
  joined_at
)
select
  tw.workspace_id,
  tw.user_id,
  'owner'::public.workspace_member_role,
  'active'::public.workspace_member_status,
  now()
from target_workspaces tw
on conflict (workspace_id, user_id) do update
set
  role = excluded.role,
  status = excluded.status,
  joined_at = coalesce(public.workspace_members.joined_at, excluded.joined_at),
  updated_at = now();

-- ── Backfill: set default_workspace_id for profiles missing one ──

with first_workspace_per_user as (
  select distinct on (wm.user_id)
    wm.user_id,
    wm.workspace_id
  from public.workspace_members wm
  where wm.status = 'active'
  order by wm.user_id, wm.joined_at nulls last, wm.created_at, wm.id
)
update public.profiles p
set
  default_workspace_id = fw.workspace_id,
  updated_at = now()
from first_workspace_per_user fw
where p.id = fw.user_id
  and p.default_workspace_id is null;

-- ── Backfill: snap entitlement caps to tier defaults ──

update public.workspace_licenses wl
set
  seat_limit = coalesce(wl.seat_limit, case when wl.tier = 'free' then 1 when wl.tier = 'pro' then 25 else null end),
  project_cap = coalesce(wl.project_cap, case when wl.tier = 'free' then 12 when wl.tier = 'pro' then 80 else null end),
  asset_cap = coalesce(wl.asset_cap, case when wl.tier = 'free' then 60 when wl.tier = 'pro' then 400 else null end),
  storage_cap_bytes = coalesce(wl.storage_cap_bytes, case when wl.tier = 'free' then 536870912 when wl.tier = 'pro' then 5368709120 else null end);

-- ===========================================================================
-- file_manager_features
-- ===========================================================================

-- attachments extensions

alter table public.attachments
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

-- folders

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

-- tags

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

-- attachment_tags

create table if not exists public.attachment_tags (
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (attachment_id, tag_id)
);

comment on table public.attachment_tags is
  'Many-to-many join between attachments and tags.';

-- indexes

create index if not exists idx_attachments_deleted_at on public.attachments (workspace_id, deleted_at);
create index if not exists idx_attachments_folder_id on public.attachments (folder_id);
create index if not exists idx_attachments_updated_at on public.attachments (workspace_id, updated_at desc);
create index if not exists idx_folders_workspace_id on public.folders (workspace_id);
create index if not exists idx_folders_parent_id on public.folders (parent_id);
create index if not exists idx_tags_workspace_id on public.tags (workspace_id);
create index if not exists idx_attachment_tags_tag_id on public.attachment_tags (tag_id);

-- updated_at helper

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

-- audit activity log helpers for workspace members

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

-- RLS (run after 03_rls_storage.sql so attachments RLS is already enabled)

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

drop policy if exists "attachments_update_member" on public.attachments;
create policy "attachments_update_member"
  on public.attachments
  for update
  to authenticated
  using (public.can_manage_documents(workspace_id))
  with check (public.can_manage_documents(workspace_id));


commit;
