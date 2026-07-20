-- ════════════════════════════════════════════════════════════════
-- SiteSurveyor — Admin Operations Cookbook (Supabase / Postgres)
-- ════════════════════════════════════════════════════════════════
--
-- Reusable, copy-paste SQL templates for vendor/platform-admin tasks that
-- are NOT exposed in the app UI, or that you need during bootstrap of a brand-
-- new Supabase project:
--
--   A. Promote / demote an account to platform admin.
--   B. Create the very first admin (bootstrap, when no admin exists yet).
--   C. Issue / extend / suspend / revoke / re-point a per-device license.
--   D. Manage seats (free a device, inspect bound devices).
--   E. Diagnostics (why is activation failing / sync 403?).
--   F. Fix common data problems (missing public.profiles row, duplicate auth ids).
--
-- ────────────────────────────────────────────────────────────────
-- HOW TO USE
-- ────────────────────────────────────────────────────────────────
--   • Run statements in the Supabase SQL Editor (Dashboard → SQL Editor).
--     That session runs as the SERVICE ROLE, which is REQUIRED here because
--     all license / seat writes and admin privilege changes are service-role-
--     only by design.
--   • Run AFTER 01_schema.sql and 06_licensing.sql. On existing projects the
--     admin enforcement is already handled by RLS on `profiles` (platform
--     admin flag) plus the service-role gates in the Edge Functions.
--   • Every template is parameterised with a clearly marked literal you edit,
--     e.g. 'you@example.com'. Search for >>> EDIT to find them.
--   • These are TEMPLATES. Most are wrapped so they are safe to re-run, but
--     destructive ones (revoke / unbind) are clearly labelled — read first.
--
-- ────────────────────────────────────────────────────────────────
-- KEY FACTS
-- ────────────────────────────────────────────────────────────────
--   • public.profiles.id is UUID and equals auth.users.id.
--   • licenses.account_id is TEXT (the owner's auth uid) or NULL = "pending".
--     It binds to the first activator whose CONFIRMED email = customer_email.
--   • Platform admin status is public.profiles.is_platform_admin.
--   • Server-side license admin is gated by public.is_platform_admin() which
--     reads that flag.
--   • Editions: 'starter' | 'business' | 'enterprise'.
--   • license.status: 'active' | 'cancelled' | 'suspended'.
--   • License keys: SSE-XXXX-XXXX-XXXX-XXXX.
-- ════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════
-- A. PROMOTE / DEMOTE A PLATFORM ADMIN
-- ════════════════════════════════════════════════════════════════

-- ─── A1. Promote an EXISTING account to platform admin ───────────
-- Ensures a public.profiles row exists for the account and sets
-- is_platform_admin = true. Safe to re-run. >>> EDIT the email.
INSERT INTO public.profiles (id, email, is_platform_admin)
SELECT au.id, au.email, true
FROM auth.users au
WHERE lower(au.email) = lower('you@example.com')   -- >>> EDIT
ON CONFLICT (id) DO UPDATE SET is_platform_admin = true;

-- ─── A2. Mirror the role into the JWT metadata (do this too) ─────
-- Lets the desktop client recognise admin immediately on next sign-in (its
-- fast path reads user_metadata.is_platform_admin). The user must sign out
-- and back in after.
UPDATE auth.users
SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_platform_admin":true}'::jsonb
WHERE lower(email) = lower('you@example.com');      -- >>> EDIT

-- ─── A3. Demote an admin back to a normal user ──────────────────
UPDATE public.profiles
SET is_platform_admin = false
WHERE lower(email) = lower('user@example.com');    -- >>> EDIT

UPDATE auth.users
SET raw_user_meta_data =
      COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_platform_admin":false}'::jsonb
WHERE lower(email) = lower('user@example.com');    -- >>> EDIT


-- ════════════════════════════════════════════════════════════════
-- B. BOOTSTRAP THE FIRST ADMIN (new project, no admin exists yet)
-- ════════════════════════════════════════════════════════════════
-- Use this once, right after the user has signed up in the app (so the
-- auth.users row exists) but before any admin exists. Bundled and guarded.
DO $$
DECLARE
  v_email TEXT := lower('founder@example.com');    -- >>> EDIT
  v_uid   UUID;
BEGIN
  SELECT au.id INTO v_uid
  FROM auth.users au
  WHERE lower(au.email) = v_email
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION
      'No auth.users row for %. Have the user sign up in the app first.', v_email;
  END IF;

  INSERT INTO public.profiles (id, email, is_platform_admin)
  VALUES (v_uid, v_email, true)
  ON CONFLICT (id) DO UPDATE SET is_platform_admin = true;

  UPDATE auth.users
  SET raw_user_meta_data =
        COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_platform_admin":true}'::jsonb
  WHERE id = v_uid;

  RAISE NOTICE 'Admin bootstrapped for % (uid %). Sign out/in to refresh JWT.',
    v_email, v_uid;
END $$;


-- ════════════════════════════════════════════════════════════════
-- C. LICENSES
-- ════════════════════════════════════════════════════════════════
-- NOTE: the recommended path is the in-app license-admin Edge Functions
-- (license-admin-create / -update), which also generate a key and audit-log
-- the action. Use the SQL below for bootstrap, bulk work, or when the
-- functions are unavailable.

-- ─── C1. Issue a license to a customer email ────────────────────
-- If an auth user with this email already exists, it is pre-bound (account_id);
-- otherwise the license stays "pending" (account_id NULL) and binds to the
-- first activator whose CONFIRMED email matches customer_email.
-- >>> EDIT the email, edition, seats, term, features.
INSERT INTO public.licenses
  (account_id, customer_email, license_key, edition, features, seats,
   grace_days, status, expires_at, notes, issued_by)
SELECT
  (SELECT au.id::text FROM auth.users au WHERE lower(au.email) = lower('customer@example.com') LIMIT 1),
  lower('customer@example.com'),                                   -- >>> EDIT customer email
  'SSE-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)) || '-'
         || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)) || '-'
         || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)) || '-'
         || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4)),  -- generated key
  'business',                                                      -- >>> EDIT edition
  ARRAY[]::text[],                                                 -- >>> EDIT features
  3,                                                               -- >>> EDIT seats
  14,                                                              -- >>> EDIT grace_days
  'active',
  NOW() + INTERVAL '1 year',                                       -- >>> EDIT term
  'Issued via SQL cookbook',                                       -- >>> EDIT notes (or NULL)
  NULL                                                             -- issued_by (admin uid if known)
RETURNING id, account_id, customer_email, license_key, edition, seats, expires_at;

-- ─── C2. Extend / renew a license term ──────────────────────────
UPDATE public.licenses
SET expires_at = NOW() + INTERVAL '1 year',     -- >>> EDIT new paid-through date
    status     = 'active',
    revoked_at = NULL
WHERE lower(customer_email) = lower('customer@example.com');  -- >>> EDIT

-- ─── C3. Change edition / features / seats ──────────────────────
UPDATE public.licenses
SET edition  = 'enterprise',                              -- >>> EDIT
    features = ARRAY[]::text[],                           -- >>> EDIT
    seats    = 5                                          -- >>> EDIT
WHERE lower(customer_email) = lower('customer@example.com'); -- >>> EDIT

-- ─── C4. Suspend (temporary) ────────────────────────────────────
UPDATE public.licenses
SET status = 'suspended'
WHERE lower(customer_email) = lower('customer@example.com'); -- >>> EDIT

-- ─── C5. Reactivate a suspended license ─────────────────────────
UPDATE public.licenses
SET status = 'active'
WHERE lower(customer_email) = lower('customer@example.com') -- >>> EDIT
  AND status = 'suspended';

-- ─── C6. Revoke / cancel (permanent) ────────────────────────────
-- DESTRUCTIVE in effect: the account loses sync once grace lapses.
UPDATE public.licenses
SET status = 'cancelled', revoked_at = NOW()
WHERE lower(customer_email) = lower('customer@example.com'); -- >>> EDIT

-- ─── C7. Re-point a PENDING license to a different email ─────────
-- Only works while account_id IS NULL (not yet claimed).
UPDATE public.licenses
SET customer_email = lower('new-owner@example.com')         -- >>> EDIT new email
WHERE lower(customer_email) = lower('old-owner@example.com') -- >>> EDIT old email
  AND account_id IS NULL;

-- ─── C8. Re-bind a license directly to a specific account uid ──────
-- Use when you must move an already-claimed license to a known account.
UPDATE public.licenses
SET account_id =   (SELECT au.id::text FROM auth.users au
                  WHERE lower(au.email) = lower('target@example.com') LIMIT 1) -- >>> EDIT
WHERE license_key = 'SSE-XXXX-XXXX-XXXX-XXXX';              -- >>> EDIT


-- ════════════════════════════════════════════════════════════════
-- D. SEATS (devices bound to a license)
-- ════════════════════════════════════════════════════════════════

-- ─── D1. List devices bound to a customer's license ─────────────
SELECT s.id, s.fingerprint, s.seq, s.last_seen_at, s.created_at,
       l.license_key, l.seats
FROM public.license_seats s
JOIN public.licenses l ON l.id = s.license_id
WHERE lower(l.customer_email) = lower('customer@example.com')  -- >>> EDIT
ORDER BY s.last_seen_at DESC NULLS LAST;

-- ─── D2. Free a single seat (let the customer activate a new device) ──
-- DESTRUCTIVE: unbinds that device. Copy the fingerprint from D1.
DELETE FROM public.license_seats
WHERE id IN (
  SELECT s.id FROM public.license_seats s
  JOIN public.licenses l ON l.id = s.license_id
  WHERE lower(l.customer_email) = lower('customer@example.com')  -- >>> EDIT
    AND s.fingerprint = 'PASTE_DEVICE_FINGERPRINT_HEX'           -- >>> EDIT
);

-- ─── D3. Free ALL seats for a license (full reset) ──────────────
-- DESTRUCTIVE: every device must re-activate.
DELETE FROM public.license_seats
WHERE license_id IN (
  SELECT id FROM public.licenses
  WHERE lower(customer_email) = lower('customer@example.com')    -- >>> EDIT
);


-- ════════════════════════════════════════════════════════════════
-- E. DIAGNOSTICS (run these FIRST when something is denied)
-- ════════════════════════════════════════════════════════════════

-- ─── E1. The decisive check: is THIS account admin / licensed? ──
-- If public_role is NULL → missing public.profiles row (see F1).
-- If more than one row → duplicate auth identities (see F2).
SELECT au.id::text                                   AS uid,
       au.email,
       au.last_sign_in_at,
       au.raw_user_meta_data->>'is_platform_admin'    AS meta_role,
       COALESCE(p.is_platform_admin, false)           AS public_role,
       public.has_active_license(au.id::text)         AS licensed
FROM auth.users au
LEFT JOIN public.profiles p ON p.id = au.id
WHERE lower(au.email) = lower('you@example.com');    -- >>> EDIT

-- ─── E2. Inspect a customer's licenses + seat usage ─────────────
SELECT l.id, l.account_id, l.customer_email, l.license_key, l.edition,
       l.status, l.expires_at, l.seats,
       (SELECT count(*) FROM public.license_seats s WHERE s.license_id = l.id) AS seats_used,
       (l.expires_at > NOW())                        AS not_expired
FROM public.licenses l
WHERE lower(l.customer_email) = lower('customer@example.com')  -- >>> EDIT
ORDER BY l.created_at DESC;

-- ─── E3. List every platform admin in the system ────────────────
SELECT id, email, is_platform_admin, created_at
FROM public.profiles
WHERE is_platform_admin = true
ORDER BY created_at;

-- ─── E4. Confirm the licensing helpers exist ───────────────────
SELECT proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('is_platform_admin', 'has_active_license')
ORDER BY proname;


-- ════════════════════════════════════════════════════════════════
-- F. FIXING COMMON DATA PROBLEMS
-- ════════════════════════════════════════════════════════════════

-- ─── F1. Missing public.profiles row ────────────────────────────
INSERT INTO public.profiles (id, email, is_platform_admin)
SELECT au.id, au.email, true                         -- >>> EDIT role if not admin
FROM auth.users au
WHERE lower(au.email) = lower('you@example.com')   -- >>> EDIT
ON CONFLICT (id) DO UPDATE SET is_platform_admin = EXCLUDED.is_platform_admin;

-- ─── F2. Duplicate auth identities for one email ────────────────
-- Inspect first; then move the license to the canonical uid with C8.
SELECT au.id::text AS uid, au.email, au.last_sign_in_at,
       (au.encrypted_password IS NOT NULL) AS has_password,
       (SELECT count(*) FROM public.profiles p WHERE p.id = au.id) AS has_profile,
       (SELECT count(*) FROM public.licenses l WHERE l.account_id = au.id::text) AS owns_licenses
FROM auth.users au
WHERE lower(au.email) = lower('you@example.com')     -- >>> EDIT
ORDER BY au.last_sign_in_at DESC NULLS LAST;


-- ════════════════════════════════════════════════════════════════
-- REMINDER: after ANY role change, the affected user must SIGN OUT
-- and SIGN BACK IN so the desktop client receives a fresh JWT carrying
-- the new role. Server-side enforcement updates immediately.
-- ════════════════════════════════════════════════════════════════
