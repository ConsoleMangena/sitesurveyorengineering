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

-- Professional portfolio + notification-preference columns (idempotent).
alter table public.profiles
  add column if not exists registration_no text,
  add column if not exists company_name text,
  add column if not exists city text,
  add column if not exists country_code text,
  add column if not exists website text,
  add column if not exists linkedin text,
  add column if not exists specializations text,
  add column if not exists email_notifications boolean not null default true;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  type public.workspace_type not null,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
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

-- 02_functions_triggers.sql — functions/RPCs and triggers. Run AFTER 01_schema.sql.

begin;


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
  if workspace_slug_value is null or workspace_slug_value = '' then
    workspace_slug_value := 'workspace';
  end if;

  -- De-dupe the slug so re-signups (or reused workspace names) never crash.
  while exists (select 1 from public.workspaces where slug = workspace_slug_value) loop
    workspace_slug_value := workspace_slug_value || '-' || substr(md5(random()::text), 1, 6);
  end loop;

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

-- ── Project CAD model metrics (counts without shipping the JSONB) ──
--
-- The dashboard KPI cards need only four counts. Counting server-side avoids
-- transferring the (potentially multi-MB) CAD model JSONB on every refresh.
-- SECURITY INVOKER so the project_cad_drawings RLS select policy still
-- applies per caller.

create or replace function public.project_cad_metrics(p_project_id uuid)
returns table (points integer, linework integer, surfaces integer, qa_flags integer)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(jsonb_array_length(model -> 'points'), 0)::integer,
    coalesce(jsonb_array_length(model -> 'linework'), 0)::integer,
    coalesce(jsonb_array_length(model -> 'surfaces'), 0)::integer,
    (
      select count(*)::integer
      from jsonb_array_elements(coalesce(model -> 'points', '[]'::jsonb)) p
      where upper(coalesce(p ->> 'code', '')) like '%QA%'
         or upper(coalesce(p ->> 'code', '')) like '%CHECK%'
         or upper(coalesce(p ->> 'code', '')) like '%FLAG%'
         or upper(coalesce(p ->> 'code', '')) like '%REVIEW%'
    )
  from public.project_cad_drawings
  where project_id = project_cad_metrics.p_project_id;
$$;

-- ===========================================================================
-- triggers
-- ===========================================================================



drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();


-- ── set_updated_at triggers for all tables ──

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles',
    'workspaces',
    'workspace_settings',
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




-- ── CAD drawings updated_at ──

drop trigger if exists trg_touch_project_cad_drawings on public.project_cad_drawings;
create trigger trg_touch_project_cad_drawings
before update on public.project_cad_drawings
for each row execute function public.touch_project_cad_drawings();

-- ── Project creator membership ──
-- Defence in depth: if a project is created without a project_members row for
-- its creator, add one automatically. Many policies also fall back to
-- projects.created_by, but normalizing the membership row keeps joins reliable.

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

-- Backfill: ensure existing projects without a membership row for their creator
-- get one, so the creator-fallback policies are not the only safety net.
insert into public.project_members (workspace_id, project_id, user_id, role)
select p.workspace_id, p.id, p.created_by, 'manager'
from public.projects p
where p.created_by is not null
  and not exists (
    select 1 from public.project_members pm
    where pm.project_id = p.id and pm.user_id = p.created_by
  )
on conflict (project_id, user_id) do nothing;


commit;

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
alter table public.payment_methods enable row level security;
alter table public.project_cad_drawings enable row level security;
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
using (public.is_workspace_member(workspace_id) or public.is_platform_admin());

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
  public.is_platform_admin()
  or (
    public.is_business_workspace(workspace_id)
    and public.is_workspace_member(workspace_id)
  )
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
using (public.is_workspace_member(workspace_id) or is_global or public.is_platform_admin());

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
using (public.is_workspace_member(workspace_id) or is_global or public.is_platform_admin());

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
-- Members read and write their project's drawings. CAD is available to every
-- workspace, so there is no entitlement gate.

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

drop policy if exists "project_cad_drawings_update_member" on public.project_cad_drawings;
create policy "project_cad_drawings_update_member"
on public.project_cad_drawings
for update
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
)
with check (
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

-- 04_seed.sql — seeds and idempotent backfills. Run LAST.

begin;


-- ===========================================================================
-- seed_and_backfill
-- ===========================================================================
--
-- Idempotent seeds and backfills. On a fresh project the backfills are no-ops
-- (no existing auth users); they also make this file safe to re-run.


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

commit;

-- ============================================================================
-- Blockchain file anchoring (hybrid on-chain / off-chain storage)
-- ============================================================================
--
-- Engineering survey files (CAD models, control coordinates, title-deed data,
-- field captures) are sensitive and legally significant. SiteSurveyor lets a
-- surveyor choose, PER FILE, whether to:
--
--   * keep the file purely OFF-CHAIN in Supabase Storage (fast, affordable), or
--   * ANCHOR it to the Solana blockchain for tamper-evident, verifiable
--     integrity. We never push raw file bytes on-chain (cost/privacy); instead
--     we anchor the file's SHA-256 content hash in a transaction memo. The hash
--     proves the off-chain object has not been altered since it was anchored.
--
-- This migration is idempotent and safe to re-run.
-- ----------------------------------------------------------------------------

-- Storage tier chosen for an attachment.
DO $$ BEGIN
  create type public.attachment_storage_tier as enum (
    'off_chain', -- Supabase Storage only.
    'on_chain'   -- Off-chain object + Solana hash anchor.
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Lifecycle of the on-chain anchor for an attachment.
DO $$ BEGIN
  create type public.attachment_chain_status as enum (
    'none',     -- Not anchored (off-chain only).
    'pending',  -- Anchor requested; awaiting on-chain confirmation.
    'anchored', -- Hash confirmed on-chain.
    'failed'    -- Anchor attempt failed; user may retry.
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- New columns on the existing attachments table.
alter table public.attachments
  add column if not exists storage_tier public.attachment_storage_tier not null default 'off_chain',
  add column if not exists chain_status public.attachment_chain_status not null default 'none',
  -- Lowercase hex SHA-256 of the file bytes (64 chars). Used to verify the
  -- off-chain object against the on-chain anchor.
  add column if not exists content_hash text,
  -- Solana transaction signature carrying the hash memo, once anchored.
  add column if not exists chain_tx_signature text,
  -- Solana cluster the anchor lives on (e.g. 'devnet', 'mainnet-beta').
  add column if not exists chain_network text,
  add column if not exists anchored_at timestamptz;

-- A given on-chain anchor transaction maps to exactly one attachment.
create unique index if not exists attachments_chain_tx_signature_key
  on public.attachments (chain_tx_signature)
  where chain_tx_signature is not null;

-- Fast lookups of a workspace's on-chain files for the Files page KPIs.
create index if not exists idx_attachments_workspace_chain_status
  on public.attachments (workspace_id, chain_status);

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

-- 08_remove_solana_auth.sql — Remove Solana Sign-In With Wallet artifacts.
-- Run AFTER 03_rls_storage.sql. Idempotent.

begin;

-- Drop the cleanup helper function.
drop function if exists public.cleanup_expired_solana_nonces();

-- Drop the nonce table (and any dependent triggers) used by the deprecated SIWS edge function.
drop table if exists public.solana_auth_nonces cascade;

commit;

-- 09_embedded_solana_wallet.sql — Storage for open-source app-embedded Solana wallets.
-- Run after 03_rls_storage.sql. Idempotent.

begin;

-- Stores PIN-encrypted Solana key material and optional seed phrase for the
-- embedded wallet feature. One wallet per user. The actual encryption/
-- decryption happens client-side; the server only persists the encrypted blob.
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
  -- Sanity check: the row can only be written by the owner.
  constraint embedded_solana_wallets_user_id_check
    check (user_id = auth.uid())
);

comment on table public.embedded_solana_wallets is
  'Encrypted embedded Solana wallet keys and optional seed phrases. Secret keys are encrypted client-side with a user PIN; this table only stores ciphertext.';

alter table public.embedded_solana_wallets enable row level security;

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

-- Optional: store a payment_method reference so the wallet can be selected as a payment method.
-- This column is populated by the client after wallet creation.
comment on column public.payment_methods.detail is
  'For Crypto Wallet payment methods this stores the wallet address.';

commit;

-- 10_embedded_wallet_mnemonic.sql — Add encrypted seed-phrase columns to embedded Solana wallets.
-- Run after 09_embedded_solana_wallet.sql. Idempotent.

begin;

alter table public.embedded_solana_wallets
  add column if not exists encrypted_mnemonic text null,
  add column if not exists mnemonic_iv        text null;

comment on column public.embedded_solana_wallets.encrypted_mnemonic is
  'BIP-39 seed phrase encrypted client-side with the same PIN used for encrypted_key.';

comment on column public.embedded_solana_wallets.mnemonic_iv is
  'Initialization vector for the encrypted_mnemonic AES-GCM ciphertext.';

commit;

-- Account soft-deletion support
-- Adds a deletion-request timestamp and a scheduled purge timestamp to profiles.
-- Existing tables are not recreated; columns are added only if missing.

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deletion_requested_at is 'When the user requested account deletion. Starts a grace period before permanent removal.';
comment on column public.profiles.deleted_at is 'Soft-delete timestamp. Account becomes inaccessible after this time.';

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

-- Add project-level axis convention so CAD and COGO tools share the same Y/X or X/Y readout.
-- 'yx' = Zimbabwe / RSA Gauss Conform convention (SiteSurveyor default, Y=Easting first).
-- 'xy' = mathematical / UTM / international convention (X=Easting first).
alter table public.projects
  add column if not exists axis_convention text not null default 'yx';

comment on column public.projects.axis_convention is
  'Display convention for coordinate readouts: yx (Gauss, Y=Easting first) or xy (UTM, X=Easting first).';

-- Project-level coordinate reference system metadata.
-- Most survey CAD work uses a local site grid with an arbitrary origin;
-- this lets the app distinguish local vs projected coordinates.

alter table public.projects
  add column if not exists crs_type text not null default 'local',
  add column if not exists crs_epsg text,
  add column if not exists local_origin_e numeric(12,3) not null default 0,
  add column if not exists local_origin_n numeric(12,3) not null default 0;

comment on column public.projects.crs_type is 'Coordinate system type: local, projected, or other.';
comment on column public.projects.crs_epsg is 'Optional EPSG code when crs_type is projected.';
comment on column public.projects.local_origin_e is 'Easting value treated as 0 in the local site grid.';
comment on column public.projects.local_origin_n is 'Northing value treated as 0 in the local site grid.';

-- Project-level drafting unit/precision defaults so CAD and COGO tools stay consistent.
-- These replace the per-workstation CAD-only settings for direction format,
-- angle entry mode, and coordinate decimal places.

alter table public.projects
  add column if not exists bearing_format text not null default 'azimuth',
  add column if not exists angle_entry text not null default 'packed',
  add column if not exists coord_decimals integer not null default 3;

comment on column public.projects.bearing_format is 'Direction display format: azimuth, quadrant, or gon.';
comment on column public.projects.angle_entry is 'Angle entry mode: packed, dms, decimal, or gon.';
comment on column public.projects.coord_decimals is 'Decimal places for coordinate and distance readouts (0..6).';

-- 17_billing_payment_guards.sql — Payment integrity guards.
-- Run AFTER 03_rls_storage.sql. Idempotent.
--
-- Adds a BEFORE INSERT/UPDATE trigger on public.payments that:
--   1. ensures the parent invoice belongs to the same workspace as the payment,
--   2. prevents payments that would exceed the invoice total.

begin;

create or replace function public.validate_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_workspace_id uuid;
  invoice_total numeric(12,2);
  paid_total numeric(12,2);
begin
  -- Load the invoice referenced by the payment.
  select workspace_id, total
  into inv_workspace_id, invoice_total
  from public.invoices
  where id = new.invoice_id;

  if not found then
    raise exception 'Invoice % not found.', new.invoice_id;
  end if;

  -- 1. Workspace isolation: the invoice must belong to the payment workspace.
  if inv_workspace_id is distinct from new.workspace_id then
    raise exception 'Payment invoice does not belong to the payment workspace.';
  end if;

  -- 2. Over-payment guard: cumulative payments cannot exceed the invoice total.
  select coalesce(sum(amount), 0)
  into paid_total
  from public.payments
  where invoice_id = new.invoice_id
    and id is distinct from new.id;

  if paid_total + new.amount > invoice_total then
    raise exception
      'Payment amount % exceeds the remaining invoice balance (%).',
      new.amount,
      invoice_total - paid_total;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_payment on public.payments;
create trigger trg_validate_payment
  before insert or update on public.payments
  for each row
  execute function public.validate_payment();

commit;

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

-- Solana wallet addresses for marketplace listings and workspaces.
alter table public.marketplace_listings
  add column if not exists seller_wallet_address text;

alter table public.workspaces
  add column if not exists marketplace_wallet_address text;

commit;


-- 13_chat.sql — workspace real-time team chat. Run after everything.

begin;

-- ── Workspace chat messages ──
-- One natural room per workspace (general team channel). RLS scopes each room
-- to active workspace members; Realtime (postgres_changes) pushes new rows to
-- subscribed clients of the same workspace.

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  content text not null
    check (length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_workspace_created
  on public.chat_messages (workspace_id, created_at desc, id desc);

alter table public.chat_messages enable row level security;

-- Members of the workspace read the room.
drop policy if exists "chat_messages_select_member" on public.chat_messages;
create policy "chat_messages_select_member"
on public.chat_messages
for select
to authenticated
using (public.is_workspace_member(workspace_id));

-- Members post under their own identity only.
drop policy if exists "chat_messages_insert_self" on public.chat_messages;
create policy "chat_messages_insert_self"
on public.chat_messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_workspace_member(workspace_id)
);

-- Users may delete their own messages; workspace managers may moderate.
drop policy if exists "chat_messages_delete_moderator" on public.chat_messages;
create policy "chat_messages_delete_moderator"
on public.chat_messages
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.can_manage_workspace(workspace_id)
);

-- Realtime publication for subscribeWorkspaceChat (postgres_changes INSERT).
select private.add_table_to_realtime('chat_messages');

commit;


-- 14_ai_chat.sql — SiteSurveyor AI agent chat history. Run after everything.

begin;

-- ── AI conversations & messages ──
-- Per-account storage for the SiteSurveyor AI agent (OpenClaw gateway).
-- `session_key` is the gateway session that backs the transcript; messages
-- mirror what flows through the gateway so history survives gateway restarts
-- and follows the account across devices. RLS scopes every row to its owner.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  session_key text not null unique,
  summary text not null default '',
  summary_through timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Rolling memory columns for databases created before the migration.
alter table public.ai_conversations add column if not exists summary text not null default '';
alter table public.ai_conversations add column if not exists summary_through timestamptz;

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_conversations_user_updated
  on public.ai_conversations (user_id, updated_at desc);
create index if not exists idx_ai_messages_conversation_created
  on public.ai_messages (conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "ai_conversations_select_own" on public.ai_conversations;
create policy "ai_conversations_select_own"
on public.ai_conversations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "ai_conversations_insert_own" on public.ai_conversations;
create policy "ai_conversations_insert_own"
on public.ai_conversations
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "ai_conversations_update_own" on public.ai_conversations;
create policy "ai_conversations_update_own"
on public.ai_conversations
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "ai_conversations_delete_own" on public.ai_conversations;
create policy "ai_conversations_delete_own"
on public.ai_conversations
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "ai_messages_select_own" on public.ai_messages;
create policy "ai_messages_select_own"
on public.ai_messages
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "ai_messages_insert_own" on public.ai_messages;
create policy "ai_messages_insert_own"
on public.ai_messages
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "ai_messages_delete_own" on public.ai_messages;
create policy "ai_messages_delete_own"
on public.ai_messages
for delete
to authenticated
using (auth.uid() = user_id);

commit;
