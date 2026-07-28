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
| 4 | `17_billing_payment_guards.sql` | Payment integrity trigger (invoice workspace match + over-payment guard). |
| 5 | `04_seed.sql` | Seeds (feature catalog) and idempotent backfills. |
| 6 | `05_blockchain_anchoring.sql` | On-chain anchoring columns and triggers for `attachments`. |
| 7 | `07_file_manager_features.sql` | File-manager bucket and attachment columns. |
| 8 | `08_remove_solana_auth.sql` | Remove Solana auth tables. |
| 9 | `09_embedded_solana_wallet.sql` | Embedded Solana wallet table. |
| 10 | `10_embedded_wallet_mnemonic.sql` | Encrypted mnemonic support. |
| 11 | `11_account_deletion.sql` | Account-deletion request tables. |
| 12 | `12_attachment_versions.sql` | Attachment versions / soft-delete support. |
| 13 | `13_project_axis_convention.sql` | Per-project axis convention. |
| 14 | `14_project_crs.sql` | Per-project coordinate reference system. |
| 15 | `15_project_drafting_units.sql` | Per-project drafting units. |
| 16 | `20_offline_sync_support.sql` | Soft-delete / tombstone columns and sync indexes for offline-first WatermelonDB replication. |
| 17 | `21_marketplace_listing_wallet.sql` | Adds `seller_wallet_address` to marketplace listings for Solana payments. |
| 18 | `22_workspace_marketplace_wallet.sql` | Adds a default `marketplace_wallet_address` column to workspaces. |

The order matters: tables -> functions -> policies (policies call the
functions) -> seeds -> later features. Each file is its own transaction, so if
one fails nothing from that file is half-applied.

## Option B — one file

`00_all_in_one.sql` is regenerated from the split files above, in filename
order. It should be equivalent to running all of Option A.

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

### `secure-field` — encrypted payment-method fields

`../functions/secure-field/` encrypts/decrypts the Solana (`Crypto Wallet`)
payment method fields at rest using AES-GCM. Card, mobile-money, and bank-
transfer payment methods are intentionally left plaintext.

#### Generate the key

Use the setup script:

```sh
node scripts/setup-secure-field.mjs
```

Or generate a 32-byte base64 key manually:

```sh
# Linux / macOS
openssl rand -base64 32

# Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 } | ForEach-Object { [byte]$_ }))
```

#### Deploy the Edge Function

```sh
cd backend
npx supabase functions deploy secure-field
npx supabase secrets set SECURE_FIELD_ENCRYPTION_KEY=your-base64-key
```

This key is a **Supabase Edge Function secret**, not a GitHub Actions secret.
The current release workflow only builds the frontend/desktop app and does not
deploy Edge Functions. If you want automatic deployment, add these GitHub
secrets and a deployment step to the workflow:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

#### Local development

For local function serving, put the key in `backend/supabase/.env.local`:

```sh
SECURE_FIELD_ENCRYPTION_KEY=your-base64-key
```

If `SECURE_FIELD_ENCRYPTION_KEY` is missing, the function falls back to a
hard-coded local-dev-only key and logs a warning. Production deployments
**must** set a real secret.

#### Existing data

Existing `payment_methods` rows that were created before this change remain
readable because the decrypt path transparently returns any value that does
not start with the `enc:v1:` prefix. To re-encrypt old Crypto Wallet rows,
delete and re-add them through the app, or run a one-off script that calls the
`secure-field` Edge Function.
