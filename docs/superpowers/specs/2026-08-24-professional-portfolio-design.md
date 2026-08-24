# Professional Portfolio — Richer Content & Visuals

Date: 2026-08-24
Status: Approved

## Goal

Make the professional portfolio visually impressive on `/market`, the in-app
directory, and the editor preview: real avatar photo, banner image, project
showcase gallery, and a platform-verified badge. Also relax RLS so workspace
members can publish and edit their own portfolio (fixes today's silent failure
where non-admins could not save).

## Non-goals

- No review/rating system (ratings stay as-is).
- No auto-linking internal projects into the showcase (privacy risk).
- No deep-linkable public profile URLs.

## Data model (migration 0005)

1. `professionals` gains `avatar_path text`, `banner_path text`,
   `is_verified boolean NOT NULL DEFAULT false`.
2. New table `portfolio_items`:
   - `id uuid PK`, `professional_id → professionals ON DELETE CASCADE`,
     `workspace_id → workspaces ON DELETE CASCADE`
   - `title text NOT NULL`, `description text`, `year text`,
     `image_path text`, `sort_order integer DEFAULT 0`, `created_at timestamptz`.
3. RLS:
   - `portfolio_items` SELECT: workspace member OR `professionals.is_global` OR
     platform admin. INSERT/UPDATE/DELETE: owning workspace member or admin.
   - `professionals` INSERT/UPDATE/DELETE relaxed from platform-admin-only to
     owning-workspace member or admin (self-publish fix). SELECT unchanged.
4. Storage: public bucket `portfolio-media`; anon read policy; authenticated
   write policy (mirrors existing avatars bucket house style).
5. Views for anonymous `/market`:
   - Recreate `public_market_professionals` adding `avatar_path`, `banner_path`,
     `is_verified`.
   - New `public_market_portfolio_items` exposing showcase items of global
     professionals only.
6. Regenerate `frontend/src/lib/supabase/types.ts` (Views need
   `Relationships: []`).

## Media handling

New `frontend/src/lib/repositories/portfolioMedia.ts`:

- Client-side downscale via canvas before upload (avatar ≤512px, banner ≤1600px,
  JPEG q≈0.85).
- Paths `{workspace_id}/{kind}-{timestamp}.jpg` in bucket `portfolio-media`.
- Public URLs via `storage.getPublicUrl`. Old image removed on replace.

## Editor (`ProfessionalPortfolioCard`)

New "Photos & Showcase" section: circular avatar picker, wide banner picker,
gallery rows (image + title + year + description, remove button, add button).
Media uploads immediately on selection; item rows persist immediately; avatar/
banner paths save with the profile upsert. Completeness meter additionally
counts avatar, banner, and ≥1 showcase item.

## Display surfaces

- `ProfilePortfolioTemplate`: banner image under gradient overlay, real avatar
  with initials fallback, Verified badge beside name, responsive showcase grid
  (2 cols mobile / 3 cols sm+) with click-to-enlarge dialog.
- Directory cards + detail dialog: avatar when present, verified badge,
  showcase strip; admin editor gains Verified toggle.
- `/market`: registry row verified tick; `MarketDetailDialog` shows badge +
  thumbnails fetched lazily from the new anon view when a professional opens.

## Verification

Typecheck, lint (4 pre-existing warnings tolerated), 320+ tests, build,
impeccable detector on touched files; curl both market views anonymously after
`supabase db push`.
