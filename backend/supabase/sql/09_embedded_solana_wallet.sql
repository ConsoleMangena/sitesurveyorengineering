-- 09_embedded_solana_wallet.sql — Storage for open-source app-embedded Solana wallets.
-- Run after 03_rls_storage.sql. Idempotent.

begin;

-- Stores PIN-encrypted Solana key material and optional seed phrase for the
-- embedded wallet feature. One wallet per user. The actual encryption/
-- decryption happens client-side; the server only persists the encrypted blob.
create table if not exists public.embedded_solana_wallets (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  wallet_address     text        not null,
  encrypted_key      text        not null,
  iv                 text        not null,
  salt               text        not null,
  encrypted_mnemonic text        null,
  mnemonic_iv        text        null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Sanity check: the row can only be written by the owner.
  constraint embedded_solana_wallets_user_id_check
    check (user_id = auth.uid())
);

comment on table public.embedded_solana_wallets is
  'Encrypted embedded Solana wallet keys and optional seed phrases. Secret keys are encrypted client-side with a user PIN; this table only stores ciphertext.';

alter table public.embedded_solana_wallets enable row level security;

create policy if not exists "embedded_wallets_select_own"
  on public.embedded_solana_wallets
  for select
  to authenticated
  using (user_id = auth.uid());

create policy if not exists "embedded_wallets_insert_own"
  on public.embedded_solana_wallets
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy if not exists "embedded_wallets_update_own"
  on public.embedded_solana_wallets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy if not exists "embedded_wallets_delete_own"
  on public.embedded_solana_wallets
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Optional: store a payment_method reference so the wallet can be selected as a payment method.
-- This column is populated by the client after wallet creation.
comment on column public.payment_methods.detail is
  'For Crypto Wallet payment methods this stores the wallet address.';

commit;
