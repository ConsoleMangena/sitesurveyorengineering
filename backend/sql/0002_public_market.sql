-- 0002_public_market.sql — coordinate columns + anonymous-read views for the
-- public market (/market). Run in the Supabase SQL editor AFTER 0001_schema.sql.
--
-- The views deliberately enumerate columns: sensitive fields such as
-- marketplace_listings.seller_wallet_address and every *_workspace_id must
-- stay unreachable anonymously. Base-table RLS is unchanged; these views are
-- the only anon door (definer semantics bypass RLS for their own column set).

-- ── Coordinate columns ──

alter table public.marketplace_listings
  add column if not exists listing_type text;
alter table public.marketplace_listings
  add column if not exists latitude double precision;
alter table public.marketplace_listings
  add column if not exists longitude double precision;

alter table public.professionals
  add column if not exists latitude double precision;
alter table public.professionals
  add column if not exists longitude double precision;

-- listing_type exists in the live database but predates 0001_schema.sql;
-- ensured above so the view works on fresh and drifted databases alike.

-- ── Public views ──

create or replace view public.public_market_listings as
select
  id,
  name,
  type,
  condition,
  price,
  currency,
  seller,
  location,
  description,
  specs,
  listing_type,
  latitude,
  longitude,
  created_at
from public.marketplace_listings;

create or replace view public.public_market_professionals as
select
  id,
  name,
  title,
  discipline,
  experience,
  location,
  rate,
  rate_per,
  currency,
  availability,
  rating,
  reviews,
  skills,
  bio,
  certifications,
  latitude,
  longitude
from public.professionals;

-- ── Grants ──

grant select on public.public_market_listings to anon, authenticated;
grant select on public.public_market_professionals to anon, authenticated;
