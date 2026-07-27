-- Project-level drafting unit/precision defaults so CAD and COGO tools stay consistent.
-- These replace the per-workstation CAD-only settings for direction format,
-- angle entry mode, and coordinate decimal places.

alter table public.projects
  add column if not exists bearing_format text not null default 'azimuth',
  add column if not exists angle_entry text not null default 'packed',
  add column if not exists coord_decimals integer not null default 3;

comment on column public.projects.bearing_format is 'Direction display format: azimuth, quadrant, or gon.';
comment on column public.projects.angle_entry is 'Angle entry mode: packed, dms, decimal, or gon.';
comment on column public.projects.coord_decimals is 'Decimal places for coordinate and distance readouts (0..6).';
