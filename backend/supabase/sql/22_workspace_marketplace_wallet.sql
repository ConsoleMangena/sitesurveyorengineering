-- Default marketplace receiving wallet per workspace so sellers don't have to
-- enter a Solana address on every listing.
ALTER TABLE public.workspaces
ADD COLUMN IF NOT EXISTS marketplace_wallet_address text;
