-- Add owner Solana wallet address to marketplace listings so buyers can pay directly on-chain.
ALTER TABLE public.marketplace_listings
ADD COLUMN IF NOT EXISTS seller_wallet_address text;
