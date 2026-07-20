//! Desktop-only Tauri command adapters around `survey-core`.
//!
//! These let the native desktop build run TIN / contour / volume computations
//! over IPC. The web build does NOT use these — it loads the same logic via the
//! `survey-wasm` WebAssembly module so behaviour is identical everywhere. Never
//! make a web feature depend on these commands.

use survey_core::alignment::{
    self, CurveStation, HorizontalCurve, VerticalCurve,
};
use survey_core::cogo;
use survey_core::geojson_io::{self, GeoModel};
use survey_core::geom::{self, Bounds};
use survey_core::terrain::{self, TerrainStats, TriangleAnalysis};
use survey_core::{contour, tin, volume, ContourLine, Point3, Tin, Vertex, VolumeResult};

fn stringify_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn build_tin(points: Vec<Point3>) -> Result<Tin, String> {
    tin::build_tin(&points).map_err(stringify_err)
}

#[tauri::command]
pub fn generate_contours(tin: Tin, interval: f64, base: f64) -> Result<Vec<ContourLine>, String> {
    contour::generate_contours(&tin, interval, base).map_err(stringify_err)
}

#[tauri::command]
pub fn volume_to_elevation(tin: Tin, reference: f64) -> Result<VolumeResult, String> {
    volume::volume_to_elevation(&tin, reference).map_err(stringify_err)
}

#[tauri::command]
pub fn volume_between(top: Tin, base: Tin) -> Result<VolumeResult, String> {
    volume::volume_between(&top, &base).map_err(stringify_err)
}

// ── COGO (parity with the wasm surface) ─────────────────────────────────────

#[tauri::command]
pub fn cogo_inverse(from: cogo::Ne, to: cogo::Ne) -> Result<(f64, f64), String> {
    cogo::inverse(&from, &to).map_err(stringify_err)
}

#[tauri::command]
pub fn cogo_forward(
    start: cogo::Ne,
    azimuth_deg: f64,
    distance: f64,
) -> Result<cogo::Ne, String> {
    cogo::forward(&start, azimuth_deg, distance).map_err(stringify_err)
}

#[tauri::command]
pub fn cogo_polygon_area(ring: Vec<cogo::Ne>) -> Result<f64, String> {
    cogo::polygon_area(&ring).map_err(stringify_err)
}

#[tauri::command]
pub fn cogo_intersection_bearing_bearing(
    p1: cogo::Ne,
    az1_deg: f64,
    p2: cogo::Ne,
    az2_deg: f64,
) -> Result<cogo::Ne, String> {
    cogo::intersection_bearing_bearing(&p1, az1_deg, &p2, az2_deg).map_err(stringify_err)
}

// ── GeoRust `geo` algorithms (parity with the wasm surface) ─────────────────

#[tauri::command]
pub fn polygon_area(ring: Vec<Vertex>) -> f64 {
    geom::polygon_area(&ring)
}

#[tauri::command]
pub fn convex_hull(points: Vec<Vertex>) -> Vec<Vertex> {
    geom::convex_hull(&points)
}

#[tauri::command]
pub fn simplify(line: Vec<Vertex>, epsilon: f64) -> Vec<Vertex> {
    geom::simplify(&line, epsilon)
}

#[tauri::command]
pub fn centroid(ring: Vec<Vertex>) -> Option<Vertex> {
    geom::centroid(&ring)
}

#[tauri::command]
pub fn point_in_polygon(ring: Vec<Vertex>, point: Vertex) -> bool {
    geom::point_in_polygon(&ring, &point)
}

#[tauri::command]
pub fn bounds(points: Vec<Vertex>) -> Option<Bounds> {
    geom::bounds(&points)
}

// ── Alignment setting-out (parity with the wasm surface) ────────────────────

/// Solve a simple horizontal circular curve from the point of intersection,
/// the two tangent azimuths (degrees) and the radius. Returns `None` for
/// degenerate input.
#[tauri::command]
pub fn horizontal_curve(
    pi: Vertex,
    back_azimuth: f64,
    fwd_azimuth: f64,
    radius: f64,
) -> Option<HorizontalCurve> {
    alignment::horizontal_curve(&pi, back_azimuth, fwd_azimuth, radius)
}

/// Solve and stake a horizontal curve at a fixed arc `interval`. Returns the
/// curve geometry and its stations, or `None` for degenerate input.
#[tauri::command]
pub fn stake_horizontal_curve(
    pi: Vertex,
    back_azimuth: f64,
    fwd_azimuth: f64,
    radius: f64,
    interval: f64,
) -> Option<(HorizontalCurve, Vec<CurveStation>)> {
    let curve = alignment::horizontal_curve(&pi, back_azimuth, fwd_azimuth, radius)?;
    let stations = alignment::stake_horizontal_curve(&curve, back_azimuth, interval);
    Some((curve, stations))
}

/// Design an equal-tangent vertical parabolic curve. Grades are in percent.
#[tauri::command]
pub fn vertical_curve(
    bvc_elevation: f64,
    g1: f64,
    g2: f64,
    length: f64,
    interval: f64,
) -> Option<VerticalCurve> {
    alignment::vertical_curve(bvc_elevation, g1, g2, length, interval)
}

// ── Terrain analysis (parity with the wasm surface) ─────────────────────────

/// Per-triangle slope, aspect and area for every triangle of the TIN.
#[tauri::command]
pub fn analyse_terrain(tin: Tin) -> Vec<TriangleAnalysis> {
    terrain::analyse_triangles(&tin)
}

/// Whole-surface terrain statistics. Returns `None` for an empty TIN.
#[tauri::command]
pub fn terrain_stats(tin: Tin) -> Option<TerrainStats> {
    terrain::terrain_stats(&tin)
}

// ── GeoJSON interchange ──────────────────────────────────────────────────────

#[tauri::command]
pub fn model_to_geojson(model: GeoModel) -> String {
    geojson_io::model_to_geojson(&model)
}

#[tauri::command]
pub fn model_from_geojson(text: String) -> GeoModel {
    geojson_io::model_from_geojson(&text)
}

// ── Datum / CRS transforms (PROJ-backed, desktop-only, feature-gated) ───────
//
// Real datum transforms need the PROJ library and are only available in the
// native desktop build compiled with `--features proj`. The web build uses the
// hand-rolled Karney projection in `projection.ts`.

/// A reprojected coordinate result (X = Easting, Y = Northing).
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct ReprojectedPoint {
    pub e: f64,
    pub n: f64,
}

/// Whether this build can perform PROJ-backed datum transforms.
///
/// The frontend calls this once to decide whether to offer real reprojection
/// (desktop build compiled with `--features proj`) or to fall back to the
/// in-app Karney projection. Cheap and side-effect free.
#[tauri::command]
pub fn proj_available() -> bool {
    cfg!(feature = "proj")
}

/// Reproject a batch of coordinates between two CRS identified by PROJ strings
/// or EPSG codes (e.g. "EPSG:4326" -> "EPSG:32735"). Input/output use the
/// X = Easting, Y = Northing convention.
///
/// When the crate is built WITHOUT the `proj` feature this returns an error so
/// the caller can fall back to the in-app projection math.
#[tauri::command]
pub fn reproject(
    from: String,
    to: String,
    points: Vec<Vertex>,
) -> Result<Vec<ReprojectedPoint>, String> {
    reproject_impl(&from, &to, &points)
}

#[cfg(feature = "proj")]
fn reproject_impl(from: &str, to: &str, points: &[Vertex]) -> Result<Vec<ReprojectedPoint>, String> {
    use proj::Proj;

    if from.trim().is_empty() || to.trim().is_empty() {
        return Err("Both source and target CRS must be specified.".into());
    }
    // Building the transformer is the expensive step; do it once and reuse it
    // across the whole batch.
    let transformer = Proj::new_known_crs(from, to, None)
        .map_err(|e| format!("PROJ init failed ({from} -> {to}): {e}"))?;

    let mut out = Vec::with_capacity(points.len());
    for v in points {
        // PROJ works in (x, y) = (Easting/lon, Northing/lat).
        let (x, y) = transformer
            .convert((v.e, v.n))
            .map_err(|e| format!("PROJ convert failed: {e}"))?;
        if !x.is_finite() || !y.is_finite() {
            return Err("PROJ produced a non-finite coordinate (out of CRS domain?).".into());
        }
        out.push(ReprojectedPoint { e: x, n: y });
    }
    Ok(out)
}

#[cfg(not(feature = "proj"))]
fn reproject_impl(
    _from: &str,
    _to: &str,
    _points: &[Vertex],
) -> Result<Vec<ReprojectedPoint>, String> {
    Err("PROJ support not compiled in (build with --features proj)".into())
}

// ── GDAL raster/vector I/O (desktop-only, feature-gated) ────────────────────
//
// GDAL wraps the system GDAL C library and only exists in the native desktop
// build compiled with `--features gdal`. The web build has no equivalent.

/// Whether this build can perform GDAL-backed raster/vector I/O.
#[tauri::command]
pub fn gdal_available() -> bool {
    cfg!(feature = "gdal")
}

/// Read the corner coordinates of a raster dataset (e.g. a GeoTIFF DEM) as a
/// bounding box, using GDAL's geotransform. Returns an error when GDAL support
/// is not compiled in or the file cannot be opened.
#[tauri::command]
pub fn raster_bounds(path: String) -> Result<Bounds, String> {
    raster_bounds_impl(&path)
}

#[cfg(feature = "gdal")]
fn raster_bounds_impl(path: &str) -> Result<Bounds, String> {
    use gdal::Dataset;

    let ds = Dataset::open(path).map_err(|e| format!("GDAL open failed ({path}): {e}"))?;
    let (width, height) = ds.raster_size();
    let gt = ds
        .geo_transform()
        .map_err(|e| format!("GDAL geotransform unavailable: {e}"))?;

    // gt = [origin_x, pixel_w, row_rot, origin_y, col_rot, pixel_h]
    let corner = |px: f64, py: f64| -> (f64, f64) {
        let x = gt[0] + px * gt[1] + py * gt[2];
        let y = gt[3] + px * gt[4] + py * gt[5];
        (x, y)
    };
    let (w, h) = (width as f64, height as f64);
    let (x0, y0) = corner(0.0, 0.0);
    let (x1, y1) = corner(w, h);

    Ok(Bounds {
        min_e: x0.min(x1),
        max_e: x0.max(x1),
        min_n: y0.min(y1),
        max_n: y0.max(y1),
    })
}

#[cfg(not(feature = "gdal"))]
fn raster_bounds_impl(_path: &str) -> Result<Bounds, String> {
    Err("GDAL support not compiled in (build with --features gdal)".into())
}

// ── Shapefile import (desktop-only, feature-gated) ──────────────────────────

/// Whether this build can read ESRI Shapefiles.
#[tauri::command]
pub fn shapefile_available() -> bool {
    cfg!(feature = "shapefile")
}

/// Read all point geometries from a shapefile into project N/E vertices.
/// Non-point shapes contribute each of their points.
#[tauri::command]
pub fn read_shapefile_points(path: String) -> Result<Vec<Vertex>, String> {
    read_shapefile_points_impl(&path)
}

#[cfg(feature = "shapefile")]
fn read_shapefile_points_impl(path: &str) -> Result<Vec<Vertex>, String> {
    use shapefile::record::point::Point as ShpPoint;
    use shapefile::Shape;

    let mut reader =
        shapefile::Reader::from_path(path).map_err(|e| format!("Shapefile open failed: {e}"))?;

    let mut out = Vec::new();
    let push = |out: &mut Vec<Vertex>, p: &ShpPoint| out.push(Vertex { e: p.x, n: p.y });

    for shape in reader.iter_shapes() {
        let shape = shape.map_err(|e| format!("Shapefile read failed: {e}"))?;
        match shape {
            Shape::Point(p) => push(&mut out, &p),
            Shape::Polyline(pl) => {
                for part in pl.parts() {
                    for p in part {
                        push(&mut out, p);
                    }
                }
            }
            Shape::Polygon(pg) => {
                for ring in pg.rings() {
                    for p in ring.points() {
                        push(&mut out, p);
                    }
                }
            }
            Shape::Multipoint(mp) => {
                for p in mp.points() {
                    push(&mut out, p);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(not(feature = "shapefile"))]
fn read_shapefile_points_impl(_path: &str) -> Result<Vec<Vertex>, String> {
    Err("Shapefile support not compiled in (build with --features shapefile)".into())
}

// ── LiDAR .las/.laz import (desktop-only, feature-gated) ────────────────────

/// Whether this build can read LiDAR .las/.laz point clouds.
#[tauri::command]
pub fn las_available() -> bool {
    cfg!(feature = "las")
}

/// Read a LiDAR point cloud into 3D survey points (E, N, Z).
#[tauri::command]
pub fn read_las_points(path: String) -> Result<Vec<Point3>, String> {
    read_las_points_impl(&path)
}

#[cfg(feature = "las")]
fn read_las_points_impl(path: &str) -> Result<Vec<Point3>, String> {
    use las::{Read, Reader};

    let mut reader = Reader::from_path(path).map_err(|e| format!("LAS open failed ({path}): {e}"))?;
    let mut out = Vec::new();
    for point in reader.points() {
        let p = point.map_err(|e| format!("LAS read failed: {e}"))?;
        out.push(Point3 {
            e: p.x,
            n: p.y,
            z: p.z,
        });
    }
    Ok(out)
}

#[cfg(not(feature = "las"))]
fn read_las_points_impl(_path: &str) -> Result<Vec<Point3>, String> {
    Err("LAS support not compiled in (build with --features las)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proj_available_matches_feature_flag() {
        assert_eq!(proj_available(), cfg!(feature = "proj"));
    }

    #[cfg(not(feature = "proj"))]
    #[test]
    fn reproject_without_feature_reports_unavailable() {
        let err = reproject_impl("EPSG:4326", "EPSG:32735", &[]).unwrap_err();
        assert!(err.contains("not compiled in"));
    }

    #[cfg(feature = "proj")]
    #[test]
    fn reproject_wgs84_to_utm35s_roundtrips() {
        // A point in central Zimbabwe (lon ~31, lat ~ -17.8). Easting carries
        // longitude, Northing carries latitude in the (x, y) convention.
        let src = [Vertex { e: 31.05, n: -17.83 }];
        let fwd = reproject_impl("EPSG:4326", "EPSG:32735", &src).unwrap();
        assert_eq!(fwd.len(), 1);
        let back = reproject_impl(
            "EPSG:32735",
            "EPSG:4326",
            &[Vertex { e: fwd[0].e, n: fwd[0].n }],
        )
        .unwrap();
        assert!((back[0].e - 31.05).abs() < 1e-6, "lon was {}", back[0].e);
        assert!((back[0].n + 17.83).abs() < 1e-6, "lat was {}", back[0].n);
    }

    #[cfg(feature = "proj")]
    #[test]
    fn reproject_rejects_empty_crs() {
        assert!(reproject_impl("", "EPSG:4326", &[]).is_err());
    }
}
