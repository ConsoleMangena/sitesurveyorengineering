# SiteSurveyor Engineering — Supabase SQL

Builds the entire SiteSurveyor cloud schema (tables, functions, triggers, RLS,
storage buckets/policies, plus idempotent seeds and backfills). Everything is
**idempotent and safe to re-run** on a fresh or existing project.

You can set up a project in **either** of two ways. Pick one.

## Option A — split files (recommended, easier to read)

Open the **Supabase SQL editor** and paste/run these **in order**, one at a time:

| Order | File | What it does |
|-------|------|--------------|
| 1 | `01_schema.sql` | Extensions, internal schemas, enum types, all tables and indexes. |
| 2 | `02_functions_triggers.sql` | Functions / RPCs and triggers. |
| 3 | `03_rls_storage.sql` | RLS policies and storage buckets/policies. |
| 4 | `04_seed.sql` | Seeds (feature catalog, promo codes) and idempotent backfills. |

The order matters: tables -> functions -> policies (policies call the
functions) -> seeds. Each file is its own transaction, so if one fails nothing
from that file is half-applied.

## Option B — one file

Prefer a single paste? Run `00_all_in_one.sql` instead. It contains the exact
same SQL as files 01-04 combined, in the same order.

> Use **either** Option A **or** Option B, not both. They do the same thing.

## After running

Provision your platform admin account(s):

```sql
update public.profiles set is_platform_admin = true
where lower(email) = 'you@example.com';
```

In the Supabase dashboard, require **Confirm email** under Authentication.

## What's included

- Core multi-tenant schema (workspaces, members, projects, jobs, assets,
  quotes, invoices, payments, etc.) with RLS on every API-exposed table
- `is_global` flags on `marketplace_listings` and `professionals`
- `solana_auth_nonces` (Sign-In With Wallet flow, service role only)
- On-chain (Solana) payment columns on `payments`
- `Crypto Wallet` payment method type
- `project_cad_drawings` (Surveyor CAD persistence) with the CAD entitlement gate
- The System Features add-on catalog, request/approval workflow, workspace
  entitlements, the `has_feature()` helper, and approve/decline RPCs
- Marketplace hire-listing permission: the `marketplace_hire` entitlement lets a
  workspace owner/admin list their own assets/instruments for hire, enforced by
  RLS on `marketplace_listings` (platform admins retain full control and are the
  only ones who may publish `is_global` listings)

## Edge Functions

The SQL above is all you paste. The Solana Edge Function in
`../functions/solana-pay-verify/` deploys separately with the Supabase CLI when
you need it:

```sh
supabase functions deploy solana-pay-verify
```
