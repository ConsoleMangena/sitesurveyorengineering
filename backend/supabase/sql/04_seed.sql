-- 04_seed.sql — seeds and idempotent backfills. Run LAST.

begin;


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

commit;
