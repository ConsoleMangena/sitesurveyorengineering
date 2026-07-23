-- 10_embedded_wallet_mnemonic.sql — Add encrypted seed-phrase columns to embedded Solana wallets.
-- Run after 09_embedded_solana_wallet.sql. Idempotent.

begin;

alter table public.embedded_solana_wallets
  add column if not exists encrypted_mnemonic text null,
  add column if not exists mnemonic_iv        text null;

comment on column public.embedded_solana_wallets.encrypted_mnemonic is
  'BIP-39 seed phrase encrypted client-side with the same PIN used for encrypted_key.';

comment on column public.embedded_solana_wallets.mnemonic_iv is
  'Initialization vector for the encrypted_mnemonic AES-GCM ciphertext.';

commit;
