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
| 5 | `05_blockchain_anchoring.sql` | On-chain anchoring columns and triggers for `attachments`. |
| 6 | `06_licensing.sql` | Per-device licensing tables (`licenses`, `license_seats`) and helpers. |
| 7 | `07_licensing_enforcement.sql` | RESTRICTIVE RLS policies that gate business-data INSERT/UPDATE by active license. |
| 8 | `12_attachment_versions.sql` | Attachment versions / soft-delete support. |
| 9 | `20_offline_sync_support.sql` | Soft-delete / tombstone columns and sync indexes for offline-first WatermelonDB replication. |

The order matters: tables -> functions -> policies (policies call the
functions) -> seeds -> licensing -> licensing enforcement. Each file is its own
transaction, so if one fails nothing from that file is half-applied.

## Option B — one file (currently incomplete)

`00_all_in_one.sql` is a legacy single-file convenience script. It currently
contains only files `01-04` and does **not** include the licensing tables,
licensing enforcement, attachment versions, or several later schema additions.

> For new projects, use **Option A (split files)** and run them in order.
> Only use `00_all_in_one.sql` if you know it matches the numbered files in
> your branch.

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
