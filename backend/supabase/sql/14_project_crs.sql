-- Project-level coordinate reference system metadata.
-- Most survey CAD work uses a local site grid with an arbitrary origin;
-- this lets the app distinguish local vs projected coordinates.

alter table public.projects
  add column if not exists crs_type text not null default 'local',
  add column if not exists crs_epsg text,
  add column if not exists local_origin_e numeric(12,3) not null default 0,
  add column if not exists local_origin_n numeric(12,3) not null default 0;

comment on column public.projects.crs_type is 'Coordinate system type: local, projected, or other.';
comment on column public.projects.crs_epsg is 'Optional EPSG code when crs_type is projected.';
comment on column public.projects.local_origin_e is 'Easting value treated as 0 in the local site grid.';
comment on column public.projects.local_origin_n is 'Northing value treated as 0 in the local site grid.';
