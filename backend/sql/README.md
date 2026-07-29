# SiteSurveyor SQL

For a fresh Supabase project, run `0001_schema.sql` in the Supabase SQL editor.

Then provision a platform admin with:

```sql
UPDATE public.profiles SET is_platform_admin = true WHERE lower(email) = 'you@example.com';
```

Require **"Confirm email"** in Supabase Auth settings.
