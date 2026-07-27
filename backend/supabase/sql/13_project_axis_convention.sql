-- Add project-level axis convention so CAD and COGO tools share the same Y/X or X/Y readout.
-- 'yx' = Zimbabwe / RSA Gauss Conform convention (SiteSurveyor default, Y=Easting first).
-- 'xy' = mathematical / UTM / international convention (X=Easting first).
alter table public.projects
  add column if not exists axis_convention text not null default 'yx';

comment on column public.projects.axis_convention is
  'Display convention for coordinate readouts: yx (Gauss, Y=Easting first) or xy (UTM, X=Easting first).';
