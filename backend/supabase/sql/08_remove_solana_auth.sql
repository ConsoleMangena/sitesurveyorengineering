-- 08_remove_solana_auth.sql — Remove Solana Sign-In With Wallet artifacts.
-- Run AFTER 03_rls_storage.sql. Idempotent.

begin;

-- Drop the auto-cleanup trigger first so we can safely drop the function/table.
drop trigger if exists trg_cleanup_solana_nonces on public.solana_auth_nonces;

-- Drop the cleanup helper function.
drop function if exists public.cleanup_expired_solana_nonces();

-- Drop the nonce table used by the deprecated SIWS edge function.
drop table if exists public.solana_auth_nonces;

commit;
