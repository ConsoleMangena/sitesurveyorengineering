-- ============================================================================
-- Blockchain file anchoring (hybrid on-chain / off-chain storage)
-- ============================================================================
--
-- Engineering survey files (CAD models, control coordinates, title-deed data,
-- field captures) are sensitive and legally significant. SiteSurveyor lets a
-- surveyor choose, PER FILE, whether to:
--
--   * keep the file purely OFF-CHAIN in Supabase Storage (fast, affordable), or
--   * ANCHOR it to the Solana blockchain for tamper-evident, verifiable
--     integrity. We never push raw file bytes on-chain (cost/privacy); instead
--     we anchor the file's SHA-256 content hash in a transaction memo. The hash
--     proves the off-chain object has not been altered since it was anchored.
--
-- This migration is idempotent and safe to re-run.
-- ----------------------------------------------------------------------------

-- Storage tier chosen for an attachment.
DO $$ BEGIN
  create type public.attachment_storage_tier as enum (
    'off_chain', -- Supabase Storage only.
    'on_chain'   -- Off-chain object + Solana hash anchor.
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Lifecycle of the on-chain anchor for an attachment.
DO $$ BEGIN
  create type public.attachment_chain_status as enum (
    'none',     -- Not anchored (off-chain only).
    'pending',  -- Anchor requested; awaiting on-chain confirmation.
    'anchored', -- Hash confirmed on-chain.
    'failed'    -- Anchor attempt failed; user may retry.
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- New columns on the existing attachments table.
alter table public.attachments
  add column if not exists storage_tier public.attachment_storage_tier not null default 'off_chain',
  add column if not exists chain_status public.attachment_chain_status not null default 'none',
  -- Lowercase hex SHA-256 of the file bytes (64 chars). Used to verify the
  -- off-chain object against the on-chain anchor.
  add column if not exists content_hash text,
  -- Solana transaction signature carrying the hash memo, once anchored.
  add column if not exists chain_tx_signature text,
  -- Solana cluster the anchor lives on (e.g. 'devnet', 'mainnet-beta').
  add column if not exists chain_network text,
  add column if not exists anchored_at timestamptz;

-- A given on-chain anchor transaction maps to exactly one attachment.
create unique index if not exists attachments_chain_tx_signature_key
  on public.attachments (chain_tx_signature)
  where chain_tx_signature is not null;

-- Fast lookups of a workspace's on-chain files for the Files page KPIs.
create index if not exists idx_attachments_workspace_chain_status
  on public.attachments (workspace_id, chain_status);
