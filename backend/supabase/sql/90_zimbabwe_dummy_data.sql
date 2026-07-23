-- 90_zimbabwe_dummy_data.sql
-- Global demo / seed dataset for SiteSurveyor. This script seeds data into
-- an existing workspace (the oldest one) so it appears in the app straight
-- away: Zimbabwean clients, projects, jobs, assets, marketplace listings,
-- professionals, quotes, invoices, etc.
--
-- IMPORTANT: create an account / sign in first so a workspace exists, then
-- run this in the Supabase SQL Editor after the schema, functions/triggers,
-- RLS and seed scripts have been applied.
-- It is safe to re-run: it aborts early if the workspace already has data.

begin;

do $$
declare
  -- Existing workspace and its owner (populated below).
  v_owner_id     uuid;
  v_workspace_id uuid;

  v_org_motid    uuid;
  v_org_harare   uuid;
  v_org_zimplats uuid;
  v_org_econet   uuid;
  v_org_nestle   uuid;
  v_org_chitungwiza uuid;
  v_org_zinara   uuid;
  v_org_hwange   uuid;
  v_org_murrob   uuid;
  v_org_uz       uuid;
  v_org_borrowdale uuid;

  v_contact_motid    uuid;
  v_contact_harare   uuid;
  v_contact_zimplats uuid;
  v_contact_econet  uuid;
  v_contact_nestle  uuid;
  v_contact_chitungwiza uuid;
  v_contact_zinara  uuid;
  v_contact_hwange  uuid;
  v_contact_murrob  uuid;
  v_contact_uz      uuid;
  v_contact_borrowdale uuid;

  v_proj_hmr uuid;
  v_proj_kkw uuid;
  v_proj_kdm uuid;
  v_proj_hwt uuid;
  v_proj_bor uuid;
  v_proj_eco uuid;
  v_proj_uz  uuid;
  v_proj_chi uuid;
  v_proj_zim uuid;
  v_proj_bpl uuid;
  v_proj_nor uuid;

  v_asset_ts1   uuid;
  v_asset_gnss1 uuid;
  v_asset_drn1  uuid;
  v_asset_lvl1  uuid;
  v_asset_vh1   uuid;
  v_asset_lt1   uuid;
  v_asset_ts2   uuid;
  v_asset_ts3   uuid;

  v_job1  uuid;
  v_job2  uuid;
  v_job3  uuid;
  v_job4  uuid;
  v_job5  uuid;
  v_job6  uuid;
  v_job7  uuid;
  v_job8  uuid;
  v_job9  uuid;
  v_job10 uuid;

  v_quote1 uuid;
  v_quote2 uuid;
  v_quote3 uuid;
  v_quote4 uuid;

  v_inv1 uuid;
  v_inv2 uuid;
  v_inv3 uuid;

  v_listing1 uuid;
  v_listing2 uuid;
  v_listing3 uuid;
  v_listing4 uuid;
  v_listing5 uuid;
begin
  -- ── 1) Loop over real workspaces and seed each one ─────────────────────
  --
  -- Run this AFTER signing up / creating an account so workspaces exist.
  -- The seed skips the old demo workspace (owner = the fixed seed user below)
  -- and fills every remaining workspace that does not already have data.
  --
  -- To limit it to one workspace, run first:
  --   SET seed.workspace_id = 'your-workspace-uuid';

  declare
    v_seed_old_user_id uuid := '11111111-1111-1111-1111-111111111111';
    v_target_id text := current_setting('seed.workspace_id', true);
    rec record;
  begin
    for rec in
      select w.id as ws_id, w.owner_user_id as owner_id, w.slug
      from public.workspaces w
      where w.owner_user_id <> v_seed_old_user_id
        and (v_target_id is null or v_target_id = '' or w.id = v_target_id::uuid)
      order by w.created_at desc
    loop
      v_workspace_id := rec.ws_id;
      v_owner_id := rec.owner_id;

      if exists (select 1 from public.organizations where workspace_id = v_workspace_id) then
        continue;
      end if;

      update public.workspaces
      set currency_code = 'USD', timezone = 'Africa/Harare', country_code = 'ZW'
      where id = v_workspace_id;

      update public.workspace_settings
      set
        default_currency = 'USD',
        timezone = 'Africa/Harare',
        country_code = 'ZW',
        settings = jsonb_build_object('demo', true, 'country', 'Zimbabwe')
      where workspace_id = v_workspace_id;

      -- ── 2) Organisations ────────────────────────────────────────────────

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Ministry of Transport and Infrastructural Development', 'government', 'surveys@transport.gov.zw', '+263 24 279 5000', 'Kaguvi Building, 4th Floor, Central Avenue', 'Harare', 'ZW', 'National road and bridge projects', v_owner_id)
  returning id into v_org_motid;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Harare City Council', 'government', 'townengineer@hararecity.co.zw', '+263 24 259 3000', 'Town House, Julius Nyerere Way', 'Harare', 'ZW', 'Urban planning and surveying', v_owner_id)
  returning id into v_org_harare;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Zimplats Holdings', 'client', 'projects@zimplats.co.zw', '+263 862 8000', 'Ngezi Mine Complex', 'Selous', 'ZW', 'Platinum mine boundary and topo surveys', v_owner_id)
  returning id into v_org_zimplats;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Econet Wireless Zimbabwe', 'client', 'rollout@econet.co.zw', '+263 772 123 001', '2 Old Mutual Building, Samora Machel Avenue', 'Harare', 'ZW', 'Telecom site surveys', v_owner_id)
  returning id into v_org_econet;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Nestlé Zimbabwe', 'client', 'factory.manager@nestle.co.zw', '+263 242 860 000', 'Factory Road, Ardbennie', 'Harare', 'ZW', 'Industrial as-built surveys', v_owner_id)
  returning id into v_org_nestle;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Chitungwiza Municipality', 'government', 'townclerk@chitungwiza.gov.zw', '+263 270 2000', 'Makoni Shopping Centre, Seke Road', 'Chitungwiza', 'ZW', 'Water and roads infrastructure', v_owner_id)
  returning id into v_org_chitungwiza;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Zimbabwe National Roads Administration', 'government', 'projects@zinara.co.zw', '+263 242 308 801', '489 Runiville, Samora Machel Avenue East', 'Harare', 'ZW', 'Road fund road surveys', v_owner_id)
  returning id into v_org_zinara;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Hwange Colliery Company', 'client', 'survey@hwangecolliery.co.zw', '+263 81 283 01', 'No. 1 Industrial Road', 'Hwange', 'ZW', 'Coal expansion topographic surveys', v_owner_id)
  returning id into v_org_hwange;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Murray & Roberts Zimbabwe', 'subcontractor', 'ldube@murrob.co.zw', '+263 9 886 300', '15th Avenue, Belmont', 'Bulawayo', 'ZW', 'Civil works partner', v_owner_id)
  returning id into v_org_murrob;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'University of Zimbabwe', 'client', 'estates@uz.ac.zw', '+263 242 303 211', 'University of Zimbabwe Campus', 'Harare', 'ZW', 'Campus redevelopment survey', v_owner_id)
  returning id into v_org_uz;

  insert into public.organizations (workspace_id, name, organization_type, email, phone, address, city, country_code, notes, created_by)
  values (v_workspace_id, 'Borrowdale Estates (Pvt) Ltd', 'client', 'estates@borrowdale.co.zw', '+263 712 654 321', '123 Borrowdale Road, Borrowdale', 'Harare', 'ZW', 'Residential subdivision client', v_owner_id)
  returning id into v_org_borrowdale;

  -- ── 3) Contacts ─────────────────────────────────────────────────────────

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_motid, 'Shingai Mawere', 'Director of Roads', 'client', 'shingai.mawere@transport.gov.zw', '+263 24 279 5001', 'Primary liaison for road surveys', v_owner_id)
  returning id into v_contact_motid;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_harare, 'Tapiwa Manyika', 'Town Engineer', 'client', 'tapiwa.manyika@hararecity.co.zw', '+263 24 259 3001', 'Responsible for town planning approvals', v_owner_id)
  returning id into v_contact_harare;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_zimplats, 'Brian Nkomo', 'Projects Manager', 'client', 'brian.nkomo@zimplats.co.zw', '+263 862 8001', 'Mine survey coordinator', v_owner_id)
  returning id into v_contact_zimplats;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_econet, 'Rufaro Gumbo', 'Network Rollout Lead', 'client', 'rufaro.gumbo@econet.co.zw', '+263 772 123 001', 'Base station survey requests', v_owner_id)
  returning id into v_contact_econet;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_nestle, 'Peter Ndlovu', 'Factory Manager', 'client', 'peter.ndlovu@nestle.co.zw', '+263 242 860 001', 'Factory expansion surveys', v_owner_id)
  returning id into v_contact_nestle;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_chitungwiza, 'Prisca Mlilo', 'Town Planner', 'client', 'prisca.mlilo@chitungwiza.gov.zw', '+263 270 2001', 'Water reticulation authority contact', v_owner_id)
  returning id into v_contact_chitungwiza;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_zinara, 'Munyaradzi Chiwara', 'Programmes Manager', 'client', 'mchiwara@zinara.co.zw', '+263 242 308 802', 'Road fund projects', v_owner_id)
  returning id into v_contact_zinara;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_hwange, 'Vusumuzi Ncube', 'Survey Coordinator', 'client', 'vusumuzi.ncube@hwangecolliery.co.zw', '+263 81 283 02', 'Topographic survey lead', v_owner_id)
  returning id into v_contact_hwange;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_murrob, 'Lincon Dube', 'Managing Director', 'partner', 'lincon.dube@murrob.co.zw', '+263 9 886 301', 'Civil subcontractor', v_owner_id)
  returning id into v_contact_murrob;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_uz, 'Emilda Mutasa', 'Estates Director', 'client', 'emutasa@uz.ac.zw', '+263 242 303 212', 'Campus redevelopment', v_owner_id)
  returning id into v_contact_uz;

  insert into public.contacts (workspace_id, organization_id, full_name, title, contact_type, email, phone, notes, created_by)
  values (v_workspace_id, v_org_borrowdale, 'Tatenda Manjengwa', 'Development Director', 'client', 'tmanjengwa@borrowdale.co.zw', '+263 712 654 322', 'Subdivision project owner', v_owner_id)
  returning id into v_contact_borrowdale;

  -- ── 4) Projects ─────────────────────────────────────────────────────────

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_motid, 'HMR-2025', 'Harare–Masvingo Highway Rehabilitation Survey', 'Centre-line, topographic and drainage surveys for the Harare–Masvingo highway rehabilitation.', 'Detailed Design', 'WGS84 / UTM 36S', 'active', 45.00, '2025-01-15', '2025-12-15', v_owner_id)
  returning id into v_proj_hmr;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_zinara, 'KKW-2025', 'Kwekwe–Kadoma Road Alignment', 'Preliminary alignment and cadastral impact survey for new Kwekwe–Kadoma link road.', 'Preliminary', 'WGS84 / UTM 36S', 'active', 20.00, '2025-03-01', '2026-02-28', v_owner_id)
  returning id into v_proj_kkw;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_motid, 'KDM-2024', 'Kariba Dam Deformation Monitoring', 'Repetitive monitoring of dam wall deformation using precise levelling and GNSS.', 'Monitoring', 'WGS84 / UTM 36S', 'active', 80.00, '2024-02-01', '2025-08-31', v_owner_id)
  returning id into v_proj_kdm;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_hwange, 'HWT-2025', 'Hwange Colliery Topographic Update', 'Large-scale topographic survey for colliery expansion planning.', 'Topographic', 'WGS84 / UTM 36S', 'active', 60.00, '2025-04-10', '2025-09-30', v_owner_id)
  returning id into v_proj_hwt;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_borrowdale, 'BOR-2025', 'Borrowdale Residential Subdivision', 'Cadastral boundary survey and subdivision layout for 120 residential stands.', 'Survey', 'Arc 1950 / UTM 36S', 'active', 35.00, '2025-02-01', '2025-07-31', v_owner_id)
  returning id into v_proj_bor;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_econet, 'ECO-2025', 'Econet Base Station Survey – Harare North', 'Topographic and access surveys for 12 new macro cell towers.', 'Site Survey', 'WGS84 / UTM 36S', 'active', 55.00, '2025-01-20', '2025-06-30', v_owner_id)
  returning id into v_proj_eco;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_uz, 'UZ-2025', 'University of Zimbabwe Campus Redevelopment Survey', 'Control network, mapping and setting-out for new faculty buildings.', 'Mapping', 'WGS84 / UTM 36S', 'active', 40.00, '2025-01-06', '2025-12-20', v_owner_id)
  returning id into v_proj_uz;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_chitungwiza, 'CHI-2025', 'Chitungwiza Water Reticulation As-Built Survey', 'As-built survey of 18 km water mains and valve chambers.', 'As-Built', 'WGS84 / UTM 36S', 'active', 70.00, '2025-03-15', '2025-08-15', v_owner_id)
  returning id into v_proj_chi;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_zimplats, 'ZIM-2025', 'Zimplats Ngezi Mine Boundary Survey', 'Re-establishment of mine lease boundary beacons and title plan update.', 'Boundary', 'WGS84 / UTM 36S', 'active', 25.00, '2025-05-01', '2025-10-31', v_owner_id)
  returning id into v_proj_zim;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_zinara, 'BPL-2024', 'Bulawayo–Plumtree Road As-Built', 'As-built survey and pavement layer checks for completed road.', 'Final As-Built', 'WGS84 / UTM 35S', 'completed', 100.00, '2024-01-10', '2024-12-20', v_owner_id)
  returning id into v_proj_bpl;

  insert into public.projects (workspace_id, organization_id, code, name, description, phase, datum, status, progress, starts_on, ends_on, created_by)
  values (v_workspace_id, v_org_nestle, 'NES-2025', 'Nestlé Ardbennie Factory Layout Survey', 'Setting-out and as-built survey for new production line foundation.', 'Construction', 'WGS84 / UTM 36S', 'active', 15.00, '2025-06-01', '2025-09-30', v_owner_id)
  returning id into v_proj_nor;

  insert into public.project_contacts (workspace_id, project_id, contact_id, relation)
  values
    (v_workspace_id, v_proj_hmr, v_contact_motid,   'client representative'),
    (v_workspace_id, v_proj_kkw, v_contact_zinara,  'client representative'),
    (v_workspace_id, v_proj_bor, v_contact_borrowdale, 'client representative'),
    (v_workspace_id, v_proj_eco, v_contact_econet,    'client representative'),
    (v_workspace_id, v_proj_uz,  v_contact_uz,        'client representative'),
    (v_workspace_id, v_proj_chi, v_contact_chitungwiza, 'client representative'),
    (v_workspace_id, v_proj_zim, v_contact_zimplats,  'client representative'),
    (v_workspace_id, v_proj_hwt, v_contact_hwange,    'client representative')
  on conflict do nothing;

  -- ── 5) Assets & calibration/maintenance ───────────────────────────────

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'TS-001', 'Leica TS16 R500 Total Station', 'instrument', 'Total Station', 'Leica', 'TS16 R500', 'SN-TS16-2022-A001', 'available', '2022-03-15', 48500.00, 42000.00, '{"accuracy":"2\" + 2ppm"}'::jsonb, v_owner_id)
  returning id into v_asset_ts1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'GNSS-001', 'Trimble R8s GNSS Receiver', 'instrument', 'GNSS', 'Trimble', 'R8s', 'SN-R8S-2021-0045', 'available', '2021-06-10', 32000.00, 28000.00, '{"channels":440,"rtk":true}'::jsonb, v_owner_id)
  returning id into v_asset_gnss1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'DRN-001', 'DJI Phantom 4 RTK Drone', 'equipment', 'UAV', 'DJI', 'Phantom 4 RTK', 'SN-P4RTK-2023-0110', 'available', '2023-02-20', 8500.00, 7200.00, '{"camera":"1\" CMOS","rtk":true}'::jsonb, v_owner_id)
  returning id into v_asset_drn1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'LV-001', 'Sokkia B40A Auto Level', 'instrument', 'Level', 'Sokkia', 'B40A', 'SN-B40A-2020-0092', 'maintenance', '2020-08-12', 2200.00, 1400.00, '{"accuracy":"1.5mm/km"}'::jsonb, v_owner_id)
  returning id into v_asset_lvl1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'VH-001', 'Toyota Hilux Survey Vehicle', 'vehicle', '4x4 Vehicle', 'Toyota', 'Hilux 2.8 GD-6', 'REG-GEOSURVEY-HW', 'deployed', '2022-11-01', 62000.00, 52000.00, '{"odo_km":48700}'::jsonb, v_owner_id)
  returning id into v_asset_vh1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'LT-001', 'Lenovo ThinkPad P1 Field Laptop', 'equipment', 'Laptop', 'Lenovo', 'ThinkPad P1 Gen 6', 'SN-TPP1-2024-0333', 'available', '2024-01-15', 3200.00, 3000.00, '{"os":"Windows 11 Pro","ssd":"1TB"}'::jsonb, v_owner_id)
  returning id into v_asset_lt1;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'TS-002', 'Topcon GM-50 Total Station', 'instrument', 'Total Station', 'Topcon', 'GM-50', 'SN-GM50-2018-0077', 'retired', '2018-04-10', 18000.00, 0.00, '{"retired_reason":"damaged in field accident"}'::jsonb, v_owner_id)
  returning id into v_asset_ts2;

  insert into public.assets (workspace_id, asset_code, name, kind, category, make, model, serial_number, status, purchase_date, purchase_cost, current_value, metadata, created_by)
  values (v_workspace_id, 'TS-003', 'Trimble SX10 Scanning Total Station', 'instrument', 'Scanning Total Station', 'Trimble', 'SX10', 'SN-SX10-2023-0008', 'available', '2023-09-01', 95000.00, 89000.00, '{"scanning":true,"accuracy":"1\" + 2ppm"}'::jsonb, v_owner_id)
  returning id into v_asset_ts3;

  insert into public.asset_calibrations (workspace_id, asset_id, calibration_date, next_calibration_date, calibration_status, certificate_number, certificate_path, provider_name, notes, created_by)
  values
    (v_workspace_id, v_asset_ts1, '2025-01-10', '2026-01-10', 'passed', 'CERT-TS16-2025-001', 'calibrations/cert-ts16-2025-001.pdf', 'Survey Instruments Africa', 'Annual EDM calibration.', v_owner_id),
    (v_workspace_id, v_asset_gnss1, '2025-01-12', '2025-07-12', 'passed', 'CERT-R8S-2025-001', 'calibrations/cert-r8s-2025-001.pdf', 'Trimble Zimbabwe', 'Semi-annual GNSS calibration.', v_owner_id),
    (v_workspace_id, v_asset_lvl1, '2024-06-01', '2025-06-01', 'expired', 'CERT-B40A-2024-001', 'calibrations/cert-b40a-2024-001.pdf', 'Survey Instruments Africa', 'Due for service.', v_owner_id);

  insert into public.asset_maintenance_events (workspace_id, asset_id, serviced_on, description, cost, provider_name, created_by)
  values
    (v_workspace_id, v_asset_vh1, '2025-02-15', 'Scheduled 50,000 km service incl. diff oil.', 480.00, 'Toyota Zimbabwe', v_owner_id),
    (v_workspace_id, v_asset_lvl1, '2025-04-02', 'Replaced compensator; pending re-calibration.', 320.00, 'Survey Instruments Africa', v_owner_id);

  -- ── 6) Jobs & job events ────────────────────────────────────────────────

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_hmr, 'Route Centreline Survey – HMR Section A', 'Establish centreline from Harare to Beatrice.', 'Route Survey', 'Harare–Beatrice Road', 'in_progress', '2025-01-20 07:00:00+02', '2025-03-10 17:00:00+02', v_owner_id)
  returning id into v_job1;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_hmr, 'Drainage Catchment Topographic Survey', 'Topographic survey of drainage crossings and catchment areas.', 'Topographic Survey', 'Harare–Masvingo Highway', 'completed', '2025-02-05 07:00:00+02', '2025-03-05 17:00:00+02', v_owner_id)
  returning id into v_job2;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_bor, 'Subdivision Boundary Survey', 'Cadastral survey and beacon replacement.', 'Boundary Survey', 'Borrowdale Estate, Harare', 'in_progress', '2025-02-10 07:00:00+02', '2025-04-30 17:00:00+02', v_owner_id)
  returning id into v_job3;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_uz, 'Campus Control Network Establishment', 'Establish primary and secondary control for setting-out.', 'Control Survey', 'University of Zimbabwe, Harare', 'in_progress', '2025-01-13 07:00:00+02', '2025-02-28 17:00:00+02', v_owner_id)
  returning id into v_job4;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_hwt, 'Open Cast Pit Detail Survey', 'Detailed pit rim and stockpile volume survey.', 'Topographic Survey', 'Hwange Colliery, Hwange', 'in_progress', '2025-04-15 07:00:00+02', '2025-07-15 17:00:00+02', v_owner_id)
  returning id into v_job5;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_eco, 'Macro Site Topographic Surveys', 'Topographic survey for 12 macro tower sites.', 'Site Survey', 'Harare North', 'in_progress', '2025-01-25 07:00:00+02', '2025-05-30 17:00:00+02', v_owner_id)
  returning id into v_job6;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_zim, 'Mine Lease Beaconing', 'Re-establish boundary beacons and prepare diagram.', 'Boundary Survey', 'Ngezi Mine, Selous', 'scheduled', '2025-05-12 07:00:00+02', '2025-08-30 17:00:00+02', v_owner_id)
  returning id into v_job7;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_chi, 'As-Built Water Main Survey', 'Survey water mains, valves and chambers from as-built drawings.', 'As-Built Survey', 'Chitungwiza', 'in_progress', '2025-03-20 07:00:00+02', '2025-06-20 17:00:00+02', v_owner_id)
  returning id into v_job8;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_bpl, 'Pavement Layer As-Built Checks', 'Core verification and road surface level checks.', 'As-Built Survey', 'Bulawayo–Plumtree Road', 'completed', '2024-10-01 07:00:00+02', '2024-11-30 17:00:00+02', v_owner_id)
  returning id into v_job9;

  insert into public.jobs (workspace_id, project_id, title, description, job_type, location, status, scheduled_start, scheduled_end, created_by)
  values (v_workspace_id, v_proj_nor, 'Production Line Foundation Setting-Out', 'Setting out bolt groups and gridlines for new line.', 'Construction Survey', 'Nestlé Ardbennie, Harare', 'planned', '2025-06-10 07:00:00+02', '2025-07-15 17:00:00+02', v_owner_id)
  returning id into v_job10;

  insert into public.job_events (workspace_id, project_id, job_id, title, event_type, event_date, start_time, end_time, location, notes, created_by)
  values
    (v_workspace_id, v_proj_hmr, v_job1, 'Mobilisation meeting with MOTID', 'meeting', '2025-01-20', '08:00', '09:30', 'Harare', 'Agreed access protocol and survey schedule.', v_owner_id),
    (v_workspace_id, v_proj_bor, v_job3, 'Boundary beacon replacement completed', 'milestone', '2025-03-15', '07:00', '17:00', 'Borrowdale', 'Replaced 14 beacons; awaiting diagram approval.', v_owner_id),
    (v_workspace_id, v_proj_uz,  v_job4, 'Primary control points handed over', 'milestone', '2025-02-10', '10:00', '11:00', 'UZ Campus', '14 primary control points accepted.', v_owner_id);

  -- ── 7) Quotes & quote items ─────────────────────────────────────────────

  insert into public.quotes (workspace_id, project_id, organization_id, contact_id, quote_number, issue_date, expires_on, status, currency_code, subtotal, tax_total, total, notes, created_by)
  values (v_workspace_id, v_proj_hmr, v_org_motid, v_contact_motid, 'Q-2025-001', '2025-01-10', current_date + interval '30 days', 'sent', 'USD', 45000.00, 0.00, 45000.00, 'MOTID highway survey quote', v_owner_id)
  returning id into v_quote1;

  insert into public.quotes (workspace_id, project_id, organization_id, contact_id, quote_number, issue_date, expires_on, status, currency_code, subtotal, tax_total, total, notes, accepted_at, created_by)
  values (v_workspace_id, v_proj_bor, v_org_borrowdale, v_contact_borrowdale, 'Q-2025-002', '2025-02-05', current_date + interval '14 days', 'accepted', 'USD', 12500.00, 0.00, 12500.00, 'Borrowdale residential subdivision', now(), v_owner_id)
  returning id into v_quote2;

  insert into public.quotes (workspace_id, project_id, organization_id, contact_id, quote_number, issue_date, expires_on, status, currency_code, subtotal, tax_total, total, notes, created_by)
  values (v_workspace_id, v_proj_eco, v_org_econet, v_contact_econet, 'Q-2025-003', '2025-01-22', current_date + interval '21 days', 'draft', 'USD', 8200.00, 0.00, 8200.00, 'Econet macro site surveys', v_owner_id)
  returning id into v_quote3;

  insert into public.quotes (workspace_id, project_id, organization_id, contact_id, quote_number, issue_date, expires_on, status, currency_code, subtotal, tax_total, total, notes, created_by)
  values (v_workspace_id, v_proj_uz, v_org_uz, v_contact_uz, 'Q-2025-004', '2025-01-08', current_date + interval '21 days', 'sent', 'USD', 18000.00, 0.00, 18000.00, 'UZ campus redevelopment survey', v_owner_id)
  returning id into v_quote4;

  insert into public.quote_items (workspace_id, quote_id, line_number, description, qty, unit, rate)
  values
    (v_workspace_id, v_quote1, 1, 'Route centreline survey (80 km)', 80, 'km', 350.00),
    (v_workspace_id, v_quote1, 2, 'Topographic survey (cross-sections)', 120, 'km', 100.00),
    (v_workspace_id, v_quote1, 3, 'MOGS and data processing', 1, 'lump sum', 5000.00),
    (v_workspace_id, v_quote2, 1, 'Cadastral boundary survey', 120, 'stands', 75.00),
    (v_workspace_id, v_quote2, 2, 'Diagrams and title plan preparation', 1, 'lump sum', 3500.00),
    (v_workspace_id, v_quote3, 1, 'Macro site topographic survey', 12, 'site', 500.00),
    (v_workspace_id, v_quote3, 2, 'Access road profile', 12, 'site', 150.00),
    (v_workspace_id, v_quote3, 3, 'Site coordination and tower coordinates', 1, 'lump sum', 400.00),
    (v_workspace_id, v_quote4, 1, 'Control network establishment', 1, 'lump sum', 6500.00),
    (v_workspace_id, v_quote4, 2, 'Campus detail topographic survey', 1, 'lump sum', 7500.00),
    (v_workspace_id, v_quote4, 3, 'Setting-out and as-built', 1, 'lump sum', 4000.00);

  -- ── 8) Invoices, items and payments ────────────────────────────────────

  insert into public.invoices (workspace_id, project_id, organization_id, contact_id, invoice_number, issue_date, due_date, status, currency_code, subtotal, tax_total, total, paid_at, notes, created_by)
  values (v_workspace_id, v_proj_hmr, v_org_motid, v_contact_motid, 'INV-2025-001', '2025-02-28', current_date + interval '14 days', 'paid', 'USD', 22500.00, 0.00, 22500.00, '2025-03-10 12:00:00+02', '50% mobilisation invoice – MOTID', v_owner_id)
  returning id into v_inv1;

  insert into public.invoices (workspace_id, project_id, organization_id, contact_id, invoice_number, issue_date, due_date, status, currency_code, subtotal, tax_total, total, notes, created_by)
  values (v_workspace_id, v_proj_bor, v_org_borrowdale, v_contact_borrowdale, 'INV-2025-002', '2025-03-01', current_date + interval '14 days', 'sent', 'USD', 6250.00, 0.00, 6250.00, 'Deposit invoice – Borrowdale Estates', v_owner_id)
  returning id into v_inv2;

  insert into public.invoices (workspace_id, project_id, organization_id, contact_id, invoice_number, issue_date, due_date, status, currency_code, subtotal, tax_total, total, notes, created_by)
  values (v_workspace_id, v_proj_hwt, v_org_hwange, v_contact_hwange, 'INV-2025-003', '2025-04-15', current_date - interval '5 days', 'overdue', 'USD', 9500.00, 0.00, 9500.00, 'Progress invoice – Hwange Colliery', v_owner_id)
  returning id into v_inv3;

  insert into public.invoice_items (workspace_id, invoice_id, line_number, description, qty, unit, rate)
  values
    (v_workspace_id, v_inv1, 1, 'Mobilisation fee – Harare–Masvingo survey', 1, 'lump sum', 7500.00),
    (v_workspace_id, v_inv1, 2, 'Centreline survey progress (40 km)', 40, 'km', 375.00),
    (v_workspace_id, v_inv2, 1, 'Boundary survey deposit (50%)', 1, 'lump sum', 6250.00),
    (v_workspace_id, v_inv3, 1, 'Open-cast pit detail survey', 1, 'lump sum', 9500.00);

  insert into public.payments (workspace_id, invoice_id, paid_on, amount, payment_method, reference, notes, created_by)
  values (v_workspace_id, v_inv1, '2025-03-12', 22500.00, 'Bank Transfer', 'REF-001-CBZ-MOTID', 'Paid in full via CBZ transfer', v_owner_id);

  -- ── 9) Marketplace listings, orders & requests ──────────────────────────

  insert into public.marketplace_listings (workspace_id, name, type, condition, price, currency, seller, location, description, specs, is_global)
  values (v_workspace_id, 'Trimble R8s GNSS Receiver – Hire', 'hire', 'good', 120.00, 'USD', 'GeoSurvey Zimbabwe', 'Harare', 'Daily hire of Trimble R8s with GSM modem. Delivery available in Harare.', ARRAY['GNSS receiver','GSM modem','carry case']::text[], true)
  returning id into v_listing1;

  insert into public.marketplace_listings (workspace_id, name, type, condition, price, currency, seller, location, description, specs, is_global)
  values (v_workspace_id, 'DJI Phantom 4 RTK Drone – Hire', 'hire', 'excellent', 800.00, 'USD', 'GeoSurvey Zimbabwe', 'Harare', 'Weekly hire of P4 RTK with base station and batteries.', ARRAY['RTK drone','3 batteries','D-RTK 2 base station']::text[], true)
  returning id into v_listing2;

  insert into public.marketplace_listings (workspace_id, name, type, condition, price, currency, seller, location, description, specs, is_global)
  values (v_workspace_id, 'Leica TS06 Plus 5" Total Station', 'sale', 'used', 8500.00, 'USD', 'GeoSurvey Zimbabwe', 'Harare', 'Used but calibrated and field-ready Leica TS06. Serial 5 years old.', ARRAY['Total station','5" accuracy','charger and tripod included']::text[], true)
  returning id into v_listing3;

  insert into public.marketplace_listings (workspace_id, name, type, condition, price, currency, seller, location, description, specs, is_global)
  values (v_workspace_id, 'Toyota Hilux 2.4 GD-6 Survey Vehicle', 'sale', 'good', 42000.00, 'USD', 'GeoSurvey Zimbabwe', 'Harare', '2019 Hilux with survey body and roof-mounted GNSS mast.', ARRAY['4x4','toolboxes','GNSS mast','ODO 92,000 km']::text[], false)
  returning id into v_listing4;

  insert into public.marketplace_listings (workspace_id, name, type, condition, price, currency, seller, location, description, specs, is_global)
  values (v_workspace_id, 'Sokkia Heavy-Duty Aluminium Tripod', 'sale', 'new', 90.00, 'USD', 'GeoSurvey Zimbabwe', 'Harare', 'Brand-new heavy-duty tripod for total station and level work.', ARRAY['Aluminium tripod','quick clamp','carry bag']::text[], true)
  returning id into v_listing5;

  insert into public.marketplace_orders (buyer_workspace_id, listing_workspace_id, listing_id, amount, currency, platform_fee_amount, provider, external_payment_ref, payment_status, metadata)
  values (v_workspace_id, v_workspace_id, v_listing1, 120.00, 'USD', 5.00, 'manual', 'ORD-2025-001', 'paid', '{"rental_days":1}'::jsonb);

  insert into public.marketplace_requests (listing_id, requester_workspace_id, requester_user_id, status, message, desired_start_date, desired_end_date)
  values (v_listing2, v_workspace_id, v_owner_id, 'pending', 'Can we hire the P4 RTK for two weeks in August for a Hwange survey?', '2025-08-04', '2025-08-15');

  -- ── 10) Professionals directory ─────────────────────────────────────────

  insert into public.professionals (workspace_id, name, title, discipline, experience, location, rate, rate_per, currency, availability, rating, reviews, skills, bio, certifications, is_global)
  values
    (v_workspace_id, 'Tendai Moyo', 'Principal Land Surveyor', 'Land Surveying', '18 years', 'Harare', 150.00, 'hour', 'USD', 'available', 4.9, 12, ARRAY['Boundary surveys','Cadastral','GPS']::text[], 'Registered Zimbabwean land surveyor; PSC registration.', ARRAY['Land Surveyor - PRAZ']::text[], true),
    (v_workspace_id, 'Privilege Ndlovu', 'Senior Engineering Surveyor', 'Engineering Surveying', '12 years', 'Harare', 120.00, 'hour', 'USD', 'available', 4.7, 8, ARRAY['Roads','Setting out','Earthworks']::text[], 'Engineering surveyor specialised in road and infrastructure projects.', ARRAY['BSc Surveying','PRAZ']::text[], true),
    (v_workspace_id, 'Rudo Chikwava', 'Operations Manager', 'Survey Operations', '10 years', 'Harare', 95.00, 'hour', 'USD', 'available', 4.8, 5, ARRAY['Project management','Logistics','Safety']::text[], 'Manages field operations and resource scheduling.', ARRAY['PRAZ Technician']::text[], false),
    (v_workspace_id, 'Nyasha Tsoka', 'Survey Technician', 'Field Surveying', '4 years', 'Harare', 50.00, 'hour', 'USD', 'available', 4.5, 3, ARRAY['Total station','Level','Drone data capture']::text[], 'Field technician with UAV experience.', ARRAY['Civil Aviation drone license']::text[], false);

  -- ── 11) Time & expense entries ──────────────────────────────────────────

  insert into public.time_entries (workspace_id, user_id, project_id, entry_date, task, hours, billable, notes)
  values
    (v_workspace_id, v_owner_id, v_proj_hmr, '2025-03-03', 'Route centreline survey', 8.00, true, 'Section A fieldwork'),
    (v_workspace_id, v_owner_id, v_proj_hmr, '2025-03-03', 'Instrument operation', 8.00, true, 'Assisted with centreline'),
    (v_workspace_id, v_owner_id, v_proj_bor, '2025-03-04', 'Cadastral boundary survey', 7.50, true, 'Borrowdale beacon search'),
    (v_workspace_id, v_owner_id, v_proj_hwt, '2025-04-16', 'Drone topographic capture', 6.00, true, 'Pit rim survey with P4 RTK'),
    (v_workspace_id, v_owner_id, v_proj_uz, '2025-02-12', 'Primary control network', 4.00, true, 'Control point coordination');

  insert into public.expense_entries (workspace_id, user_id, project_id, entry_date, category, amount, vendor, reimbursable, notes)
  values
    (v_workspace_id, v_owner_id, v_proj_hmr, '2025-03-03', 'Fuel', 75.00, 'Total Service Station Harare', true, 'Field vehicle fuel for HMR run'),
    (v_workspace_id, v_owner_id, v_proj_hmr, '2025-03-04', 'Accommodation', 120.00, 'Cresta Lodge Beatrice', true, 'Overnight near site'),
    (v_workspace_id, v_owner_id, v_proj_hwt, '2025-04-16', 'Air travel', 340.00, 'Fastjet Zimbabwe', true, 'Harare–Hwange return for pit survey'),
    (v_workspace_id, v_owner_id, v_proj_bor, '2025-03-04', 'Subcontractor fees', 200.00, 'Murray & Roberts Zimbabwe', false, 'Hired labour for beacon relocation');

  -- ── 12) Project activities ─────────────────────────────────────────────

  insert into public.project_activities (project_id, user_id, content, activity_type)
  values
    (v_proj_hmr, v_owner_id, 'Mobilised to site and confirmed access with MOTID.', 'note'),
    (v_proj_bor, v_owner_id, '14 boundary beacons replaced. Diagram drafted.', 'milestone'),
    (v_proj_uz,  v_owner_id, 'Primary control network accepted by UZ Estates.', 'milestone'),
    (v_proj_hwt, v_owner_id, 'P4 RTK pit rim survey completed ahead of schedule.', 'note'),
    (v_proj_eco, v_owner_id, 'Site 3 topographic data uploaded for review.', 'note');

  -- ── 13) Notifications ─────────────────────────────────────────────

  insert into public.notifications (workspace_id, user_id, title, body, status)
  values
    (v_workspace_id, v_owner_id, 'New project assigned', 'You have been assigned as lead on Harare–Masvingo Highway Rehabilitation Survey.', 'unread'),
    (v_workspace_id, v_owner_id, 'Quote accepted', 'Borrowdale Estates accepted Q-2025-002. Prepare invoice.', 'unread'),
    (v_workspace_id, v_owner_id, 'Payment received', 'CBZ deposit of USD 22,500 received for INV-2025-001.', 'unread'),
    (v_workspace_id, v_owner_id, 'Calibration due', 'Sokkia B40A auto level calibration has expired.', 'unread'),
    (v_workspace_id, v_owner_id, 'Job assignment', 'You are assigned to Harare–Masvingo Section A as instrument operator.', 'unread');

  -- ── 14) Audit trail ─────────────────────────────────────────────────────

  insert into audit.activity_log (workspace_id, actor_user_id, entity_table, entity_id, action, details)
  values
    (v_workspace_id, v_owner_id, 'workspaces', v_workspace_id, 'created', '{"note":"Zimbabwe demo workspace created"}'::jsonb),
    (v_workspace_id, v_owner_id, 'projects', v_proj_hmr, 'created', '{"description":"Harare–Masvingo Highway project seeded"}'::jsonb),
    (v_workspace_id, v_owner_id, 'invoices', v_inv1, 'marked_paid', '{"amount":22500,"currency":"USD"}'::jsonb),
    (v_workspace_id, v_owner_id, 'marketplace_orders', v_listing1, 'created', '{"amount":120,"currency":"USD"}'::jsonb);

    raise notice 'Zimbabwe seed data loaded into workspace % (%)', v_workspace_id, rec.slug;
  end loop;

  if v_workspace_id is null then
    raise notice 'No real workspace found. Sign up first to create an account/workspace, then run this seed.';
    return;
  end if;
end;
end $$;

commit;
