// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod license;
mod survey;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(license::LicenseManager::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            survey::build_tin,
            survey::generate_contours,
            survey::volume_to_elevation,
            survey::volume_between,
            survey::horizontal_curve,
            survey::stake_horizontal_curve,
            survey::vertical_curve,
            survey::analyse_terrain,
            survey::terrain_stats,
            survey::polygon_area,
            survey::convex_hull,
            survey::simplify,
            survey::centroid,
            survey::point_in_polygon,
            survey::bounds,
            survey::model_to_geojson,
            survey::model_from_geojson,
            survey::cogo_forward,
            survey::cogo_inverse,
            survey::cogo_polygon_area,
            survey::cogo_intersection_bearing_bearing,
            survey::proj_available,
            survey::reproject,
            survey::gdal_available,
            survey::raster_bounds,
            survey::shapefile_available,
            survey::read_shapefile_points,
            survey::las_available,
            survey::read_las_points,
            license::license_fingerprint,
            license::license_status,
            license::license_activate,
            license::license_refresh,
            license::license_deactivate,
            license::license_is_valid,
            license::license_selfcheck,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

