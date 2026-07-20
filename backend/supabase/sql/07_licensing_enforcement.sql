-- ════════════════════════════════════════════════════════════════
-- SiteSurveyor — Licensing ENFORCEMENT at the data boundary (Postgres)
-- ════════════════════════════════════════════════════════════════
--
-- Run this AFTER 06_licensing.sql.
--
-- WHAT THIS DOES
-- --------------
-- The Rust client already gates the desktop UI locally (license_is_valid),
-- and the frontend LicenseGate checks account binding. That is fast UX, but
-- a patched desktop client could bypass it. This file adds the missing
-- DEFENSE-IN-DEPTH layer: RESTRICTIVE RLS policies that enforce an active
-- server-side license for every business-data write.
--
-- DESIGN CHOICES
-- --------------
--   * Only INSERT/UPDATE are gated. SELECT and DELETE remain ungated so a
--     lapsed customer can still:
--       - pull existing cloud data down to a freshly licensed device, and
--       - clean up / delete rows.
--     This matches the offline-grace philosophy: lapsing locks new work, it
--     never holds data hostage.
--   * RESTRICTIVE policies are AND'd with the existing permissive workspace
--     policies, so a write must satisfy both workspace membership AND an
--     active license.
--   * The check is the SAME public.has_active_license() SECURITY DEFINER
--     helper used elsewhere, so behaviour is consistent. Admins are exempt.
--   * Idempotent: every policy is DROP POLICY IF EXISTS before CREATE, and
--     every legacy trigger is dropped.
--
-- NOTE ON UPSERTS
-- ---------------
-- SiteSurveyor sync uses upsert (INSERT ... ON CONFLICT UPDATE). Both INSERT
-- and UPDATE are gated below, so an unlicensed client cannot create or modify
-- cloud rows by any path.
-- ════════════════════════════════════════════════════════════════

-- Guard: make sure the helper exists (it is defined in 06_licensing.sql).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_active_license'
  ) THEN
    RAISE EXCEPTION
      'public.has_active_license(text) is missing. Run 06_licensing.sql before this file.';
  END IF;
END $$;

-- ─── Remove legacy trigger-based enforcement (replaced by this file) ──
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
      'DROP TRIGGER IF EXISTS trg_require_active_license ON public.%I;',
      tbl
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.require_active_license();

-- ─── RESTRICTIVE license policies: INSERT ─────────────────────────
DROP POLICY IF EXISTS "require_license_insert" ON public.projects;
CREATE POLICY "require_license_insert"
  ON public.projects AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.jobs;
CREATE POLICY "require_license_insert"
  ON public.jobs   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.job_events;
CREATE POLICY "require_license_insert"
  ON public.job_events   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.job_assignments;
CREATE POLICY "require_license_insert"
  ON public.job_assignments   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.attachments;
CREATE POLICY "require_license_insert"
  ON public.attachments   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.project_cad_drawings;
CREATE POLICY "require_license_insert"
  ON public.project_cad_drawings   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.quotes;
CREATE POLICY "require_license_insert"
  ON public.quotes   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.quote_items;
CREATE POLICY "require_license_insert"
  ON public.quote_items   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.invoices;
CREATE POLICY "require_license_insert"
  ON public.invoices   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.invoice_items;
CREATE POLICY "require_license_insert"
  ON public.invoice_items   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.payments;
CREATE POLICY "require_license_insert"
  ON public.payments   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.time_entries;
CREATE POLICY "require_license_insert"
  ON public.time_entries   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.expense_entries;
CREATE POLICY "require_license_insert"
  ON public.expense_entries   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.project_activities;
CREATE POLICY "require_license_insert"
  ON public.project_activities   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.marketplace_listings;
CREATE POLICY "require_license_insert"
  ON public.marketplace_listings   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_insert" ON public.marketplace_orders;
CREATE POLICY "require_license_insert"
  ON public.marketplace_orders   AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_active_license(auth.uid()::text));

-- ─── RESTRICTIVE license policies: UPDATE ─────────────────────────
DROP POLICY IF EXISTS "require_license_update" ON public.projects;
CREATE POLICY "require_license_update"
  ON public.projects   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.jobs;
CREATE POLICY "require_license_update"
  ON public.jobs   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.job_events;
CREATE POLICY "require_license_update"
  ON public.job_events   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.job_assignments;
CREATE POLICY "require_license_update"
  ON public.job_assignments   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.attachments;
CREATE POLICY "require_license_update"
  ON public.attachments   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.project_cad_drawings;
CREATE POLICY "require_license_update"
  ON public.project_cad_drawings   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.quotes;
CREATE POLICY "require_license_update"
  ON public.quotes   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.quote_items;
CREATE POLICY "require_license_update"
  ON public.quote_items   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.invoices;
CREATE POLICY "require_license_update"
  ON public.invoices   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.invoice_items;
CREATE POLICY "require_license_update"
  ON public.invoice_items   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.payments;
CREATE POLICY "require_license_update"
  ON public.payments   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.time_entries;
CREATE POLICY "require_license_update"
  ON public.time_entries   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.expense_entries;
CREATE POLICY "require_license_update"
  ON public.expense_entries   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.project_activities;
CREATE POLICY "require_license_update"
  ON public.project_activities   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.marketplace_listings;
CREATE POLICY "require_license_update"
  ON public.marketplace_listings   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

DROP POLICY IF EXISTS "require_license_update" ON public.marketplace_orders;
CREATE POLICY "require_license_update"
  ON public.marketplace_orders   AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_active_license(auth.uid()::text))
  WITH CHECK (public.has_active_license(auth.uid()::text));

-- ═════════════════════════════════════════════════════════════════
-- Enforcement applied. A patched desktop client can no longer push business
-- data to the cloud without an active server-side license.
-- Safe to re-run.
-- ═════════════════════════════════════════════════════════════════
