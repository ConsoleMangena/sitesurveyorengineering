-- ════════════════════════════════════════════════════════════════
-- SiteSurveyor — Licensing schema (Supabase / Postgres)
-- ════════════════════════════════════════════════════════════════
--
-- Run this AFTER the core schema files (01–05). Adds the server-side tables
-- that back per-device subscription licensing: `licenses` (the entitlement,
-- one per paid subscription) and `license_seats` (the devices bound to a
-- license).
--
-- The Edge Functions (license-activate / license-refresh) read/write these
-- tables with the service-role key. Clients NEVER write here directly; RLS
-- therefore only grants read access to a user's own licenses for display
-- purposes, and no client write access at all.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════

-- ─── licenses ───────────────────────────────────────────────────
-- One row per purchased subscription. `account_id` maps to the owning
-- auth user (auth.uid()). For org/team plans you can point multiple
-- users at one license via account_id; keep it simple (1 user = 1
-- account) unless/until you add organizations.
CREATE TABLE IF NOT EXISTS licenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     TEXT,                          -- owning user (auth.uid()::text); NULL until first activation for pending licenses
  customer_email TEXT,                          -- who the license is for (used to bind a pending license on first activation)
  license_key    TEXT UNIQUE,                   -- opaque key delivered to the customer (SSE-XXXX-...)
  edition        TEXT NOT NULL DEFAULT 'starter'
                   CHECK (edition IN ('starter','business','enterprise')),
  features       TEXT[] NOT NULL DEFAULT '{}',  -- e.g. {lidar_import,advanced_cad}
  seats          INTEGER NOT NULL DEFAULT 1 CHECK (seats >= 1),
  grace_days     INTEGER DEFAULT 14 CHECK (grace_days >= 0),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','cancelled','suspended')),
  expires_at     TIMESTAMPTZ NOT NULL,          -- paid-through date
  notes          TEXT,                          -- vendor-only freeform notes
  issued_by      TEXT,                          -- admin user id that created it
  revoked_at     TIMESTAMPTZ,                   -- set when cancelled
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safety for projects created with the earlier (smaller) schema.
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS issued_by TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE licenses ALTER COLUMN account_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_licenses_account_id     ON licenses(account_id);
CREATE INDEX IF NOT EXISTS idx_licenses_status         ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_customer_email ON licenses(lower(customer_email));

-- ─── license_seats ──────────────────────────────────────────────
-- One row per device (machine fingerprint) bound to a license.
-- The unique (license_id, fingerprint) constraint makes activation
-- idempotent per device and lets us enforce the seat cap.
CREATE TABLE IF NOT EXISTS license_seats (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id   UUID NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  fingerprint  TEXT NOT NULL,                  -- sha256 hex from the client
  seq          BIGINT NOT NULL DEFAULT 1,      -- monotonic issue counter
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (license_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_license_seats_license_id ON license_seats(license_id);
CREATE INDEX IF NOT EXISTS idx_license_seats_fingerprint ON license_seats(fingerprint);

-- ─── License administration authority ──────────────────────────
-- License management is restricted to platform administrators
-- (`profiles.is_platform_admin = true`). The role is verified server-side in
-- every admin function; RLS read policies use the shared
-- `public.is_platform_admin()` helper defined in the core schema.

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
DROP FUNCTION IF EXISTS public.is_superadmin();

-- ─── license_audit (append-only vendor action log) ──────────────
CREATE TABLE IF NOT EXISTS license_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id  UUID REFERENCES licenses(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,        -- 'create','revoke','suspend','reactivate','extend','set_seats','set_edition','set_features','unbind_seat'
  actor_id    TEXT,                 -- admin user id
  actor_email TEXT,
  detail      JSONB,                -- arbitrary action context
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_license_audit_license_id ON license_audit(license_id);
CREATE INDEX IF NOT EXISTS idx_license_audit_created_at ON license_audit(created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────
-- Clients may READ their own licenses but may NOT write. Admin can READ all.
-- All writes happen via Edge Functions using the service-role key (bypasses RLS).
ALTER TABLE licenses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own licenses" ON licenses;
CREATE POLICY "Users can view their own licenses"
  ON licenses FOR SELECT
  TO authenticated
  USING (auth.uid()::text = account_id);

DROP POLICY IF EXISTS "Admins can view all licenses" ON licenses;
CREATE POLICY "Admins can view all licenses"
  ON licenses FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Users can view their own seats" ON license_seats;
CREATE POLICY "Users can view their own seats"
  ON license_seats FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM licenses l
      WHERE l.id = license_seats.license_id
        AND l.account_id = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Admins can view all seats" ON license_seats;
CREATE POLICY "Admins can view all seats"
  ON license_seats FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can view audit" ON license_audit;
CREATE POLICY "Admins can view audit"
  ON license_audit FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Intentionally NO insert/update/delete policies for authenticated users on
-- any of these tables: the service role (Edge Functions) performs all
-- mutations.

GRANT SELECT ON licenses      TO authenticated;
GRANT SELECT ON license_seats TO authenticated;
GRANT SELECT ON license_audit TO authenticated;

-- ─── updated_at trigger for licenses ────────────────────────────
CREATE OR REPLACE FUNCTION set_license_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_licenses_updated_at ON licenses;
CREATE TRIGGER tr_licenses_updated_at
BEFORE UPDATE ON licenses
FOR EACH ROW EXECUTE FUNCTION set_license_updated_at();

-- ─── Atomic seat binding / refresh ─────────────────────────────
-- Binds a device fingerprint to a license seat idempotently. The license
-- row is locked for the duration of the transaction, so concurrent calls
-- for the same license cannot race past the seat cap.
-- Returns the seat row on success, or NULL when the seat cap is reached.
CREATE OR REPLACE FUNCTION public.bind_license_seat(
  p_license_id UUID,
  p_fingerprint TEXT,
  p_allow_new BOOLEAN DEFAULT true
) RETURNS public.license_seats AS $$
DECLARE
  v_license public.licenses%ROWTYPE;
  v_seat    public.license_seats%ROWTYPE;
  v_count   INTEGER;
BEGIN
  -- Lock the license row so all bind operations for this license serialize.
  SELECT * INTO v_license
  FROM public.licenses
  WHERE id = p_license_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'license not found';
  END IF;

  -- Existing device: bump sequence and refresh last_seen.
  SELECT * INTO v_seat
  FROM public.license_seats
  WHERE license_id = p_license_id AND fingerprint = p_fingerprint;

  IF FOUND THEN
    UPDATE public.license_seats
    SET seq = seq + 1, last_seen_at = NOW()
    WHERE id = v_seat.id
    RETURNING * INTO v_seat;
    RETURN v_seat;
  END IF;

  -- Refresh must not claim a seat that was never bound.
  IF NOT p_allow_new THEN
    RETURN NULL;
  END IF;

  -- New device: allow only while seats remain.
  SELECT COUNT(*) INTO v_count
  FROM public.license_seats
  WHERE license_id = p_license_id;

  IF v_count >= v_license.seats THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.license_seats (license_id, fingerprint, seq, last_seen_at)
  VALUES (p_license_id, p_fingerprint, 1, NOW())
  RETURNING * INTO v_seat;

  RETURN v_seat;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.bind_license_seat(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_license_seat(UUID, TEXT) TO authenticated;

-- ─── Helper: server-side license validity check ─────────────────
-- Used by the `require_active_license` trigger so cloud writes are refused
-- without an active, non-expired license. SECURITY DEFINER so it can read
-- `licenses` regardless of the caller's RLS.
--
-- Admins are EXEMPT from licensing: license management itself is an admin
-- capability, so requiring admins to hold a license would be circular.
CREATE OR REPLACE FUNCTION public.has_active_license(uid TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    COALESCE(
      (SELECT p.is_platform_admin FROM public.profiles p WHERE p.id = uid::uuid),
      false
    )
    OR EXISTS (
      SELECT 1 FROM public.licenses l
      WHERE l.account_id = uid
        AND l.status = 'active'
        AND l.expires_at > NOW()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

REVOKE ALL ON FUNCTION public.has_active_license(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_license(TEXT) TO authenticated;

-- ─── Defense-in-depth: gate cloud writes by per-device license ──
-- The desktop LicenseGate already blocks the UI when unlicensed, but a
-- trigger on core data tables prevents direct Supabase API writes as well.
-- Service-role requests (auth.uid() IS NULL) and platform admins are exempt.
-- Reads (SELECT) are intentionally unaffected so unlicensed users can still
-- view shared/public data and complete onboarding.

CREATE OR REPLACE FUNCTION public.require_active_license()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_active_license(auth.uid()::text) THEN
    RAISE EXCEPTION 'An active subscription is required for this operation.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.require_active_license() FROM PUBLIC;

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'projects',
    'jobs',
    'job_events',
    'job_assignments',
    'attachments',
    'project_cad_drawings',
    'quotes',
    'quote_items',
    'invoices',
    'invoice_items',
    'payments',
    'time_entries',
    'expense_entries',
    'project_activities',
    'marketplace_listings',
    'marketplace_orders'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_require_active_license ON public.%I;
       CREATE TRIGGER trg_require_active_license
       BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.require_active_license();',
      tbl, tbl
    );
  END LOOP;
END $$;
