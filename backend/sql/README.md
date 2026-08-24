# SiteSurveyor SQL

For a fresh Supabase project, run `0001_schema.sql` in the Supabase SQL editor,
then `0002_public_market.sql` (public market views + coordinate columns).
Optionally run `0003_seed_demo_market.sql` to fill /market with worldwide demo
rows (creates demo auth user `demo@sitesurveyor.market` /
`demo-market-2026`). `9999_reset_and_apply_all.sql` is a dev-only one-shot
that wipes the public schema and applies 0001 + 0002.

Then provision a platform admin with:

```sql
UPDATE public.profiles SET is_platform_admin = true WHERE lower(email) = 'you@example.com';
```

Require **"Confirm email"** in Supabase Auth settings.
