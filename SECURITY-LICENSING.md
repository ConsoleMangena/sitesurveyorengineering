# SiteSurveyor Engineering — Licensing Key Handling

The licensing system uses an **Ed25519 keypair**:

- **Private seed** (32-byte hex): signs license tokens. Lives **only** in the
  Supabase secret `LICENSE_PRIVATE_KEY_HEX`. Never commit it, never put it in a
  file, never paste it into chat/AI tools.
- **Public key** (32-byte hex): verifies tokens in the desktop client. Safe to
  ship in the binary, but provided at **build time** via an env var so no real
  key lives in source control.

> The codebase intentionally contains **no** usable public key — you must
> supply your own. If a development key was ever exposed, rotate it before
> release.

## Quick setup

```bash
node scripts/setup-licensing.mjs
```

This script generates the keypair, writes the public key to
`backend/.env.licensing` (git-ignored), prints the private seed once, and can
run `npx supabase secrets set LICENSE_PRIVATE_KEY_HEX=<seed>` for you if the CLI
is linked. After setup, deploy the Edge Functions and run the licensing SQL as
shown by the script.

## Generate a keypair manually (do this privately)

```bash
node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');const pub=publicKey.export({type:'spki',format:'der'});const priv=privateKey.export({type:'pkcs8',format:'der'});console.log('PUBLIC='+pub.subarray(pub.length-32).toString('hex'));console.log('SEED='+priv.subarray(priv.length-32).toString('hex'));"
```

This prints `PUBLIC=<64 hex>` and `SEED=<64 hex>`. They are a matching pair.

## Configure the client (public key, build time)

Set `SITESURVEYOR_LICENSE_PUBLIC_KEY` to the `PUBLIC` value when building the
Rust backend. If unset, the app fails closed (every license is rejected as
invalid).

- Windows (cmd):   `set SITESURVEYOR_LICENSE_PUBLIC_KEY=<PUBLIC> && cargo build`
- PowerShell:      `$env:SITESURVEYOR_LICENSE_PUBLIC_KEY="<PUBLIC>"; cargo build`
- bash:            `SITESURVEYOR_LICENSE_PUBLIC_KEY=<PUBLIC> cargo build`

For Tauri release builds, set the same env var in the shell that runs
`tauri build` (or your CI secrets). `backend/build.rs` triggers a rebuild
whenever the value changes and **panics on release builds** if the key is
missing or invalid.

## Configure the server (private seed, Supabase secret)

```bash
npx supabase secrets set LICENSE_PRIVATE_KEY_HEX=<SEED>
```

## Rotation

If the seed is ever exposed:

1. Generate a new pair (above).
2. Update `SITESURVEYOR_LICENSE_PUBLIC_KEY` and rebuild/redistribute the client.
3. `npx supabase secrets set LICENSE_PRIVATE_KEY_HEX=<new SEED>` and redeploy
   the Edge Functions.

Rotating after release invalidates all previously signed tokens, so every
client must re-activate (online) to receive a token signed by the new key.
Rotate before public release to avoid this.

## License administration access

License management (`license-admin-*` Edge Functions and any future admin UI)
is restricted to accounts with the platform admin role (`profiles`
`is_platform_admin = true`). The role is verified server-side in every admin
function. RLS limits a user to their own row, but Postgres RLS cannot restrict
**which columns** are written, so RLS alone does **not** stop self-promotion.
Use the SQL editor (service role) or the bootstrap templates in
`backend/supabase/sql/99_admin_operations.sql` to provision admins:

```sql
UPDATE profiles SET is_platform_admin = true WHERE lower(email) = 'you@example.com';
```

After any role change, the affected user must sign out and sign back in so
their JWT reflects the new role.

## One-time deployment checklist

1. Run the licensing SQL in the Supabase SQL editor, in order:
   - `backend/supabase/sql/01_schema.sql`
   - `backend/supabase/sql/02_functions_triggers.sql`
   - `backend/supabase/sql/03_rls_storage.sql`
   - `backend/supabase/sql/04_seed.sql`
   - `backend/supabase/sql/06_licensing.sql`
   - `backend/supabase/sql/99_admin_operations.sql` (cookbook/templates)
2. Provision platform admin account(s).
3. Deploy the Edge Functions:
   ```bash
   cd backend
   npx supabase functions deploy license-activate license-refresh license-admin-create license-admin-list license-admin-update
   ```
4. Require "Confirm email" under Supabase Authentication settings so pending
   licenses can only be claimed by verified email owners.
