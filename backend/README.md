# SiteSurveyor backend (Tauri + Rust)

Native desktop shell and the pure-Rust survey engine. Geospatial work is split
deliberately between two layers so the **same** geometry code runs on the web
(WebAssembly) and the desktop (native), while heavyweight C-library bindings
stay desktop-only.

## Geospatial stack

### GeoRust (WASM-safe, always on) — `crates/survey-core`

These are pure-Rust [GeoRust](https://georust.org) crates. They compile into
both `survey-wasm` (browser) and the desktop shell, so behaviour is identical
everywhere:

| Crate       | Used for                                                        |
| ----------- | --------------------------------------------------------------- |
| `geo`       | area, convex hull, simplify (RDP), centroid, point-in-polygon, bounds (`geom.rs`) |
| `geo-types` | shared `Coord`/`LineString`/`Polygon` types                     |
| `geojson`   | GeoJSON import/export (`geojson_io.rs`)                          |
| `wkt`       | Well-Known-Text geometry interchange                            |
| `contour`   | marching-squares isolines for gridded sources (`contour.rs`)    |
| `spade`     | Delaunay triangulation for the TIN (`tin.rs`)                   |

Run the engine tests:

```bash
cargo test -p survey-core
```

### Native C-library bindings (desktop-only, feature-gated) — root crate

`gdal` and `proj` are GeoRust bindings to the **system** GDAL and PROJ C
libraries. They **cannot** compile to WASM, so they live in the root crate
only, behind Cargo features, and the frontend degrades gracefully when they are
absent (see `frontend/.../survey/reprojectBridge.ts`).

| Feature     | Crate       | Capability                              | Native dependency           |
| ----------- | ----------- | --------------------------------------- | --------------------------- |
| `proj`      | `proj` 0.27 | true datum/CRS transforms (`reproject`) | PROJ ≥ 9                     |
| `gdal`      | `gdal` 0.17 | GeoTIFF/DEM raster + vector I/O         | GDAL ≥ 3                     |
| `shapefile` | `shapefile` | ESRI Shapefile import (pure Rust)       | none                        |
| `las`       | `las`       | LiDAR `.las`/`.laz` point clouds        | none                        |

Each command exposes an `*_available()` probe (`proj_available`,
`gdal_available`, …) so the UI can detect support at runtime, and every
implementation has a `#[cfg(not(feature = ...))]` stub that returns a clear
"not compiled in" error instead of failing to build.

## Building

Default build (GeoRust only, no native C libs required):

```bash
cargo build              # or: cargo check / cargo test
```

Enable the native geospatial features (requires the system libraries below):

```bash
cargo build --features proj,gdal,shapefile,las
```

### Installing the native libraries

The `gdal`/`proj` features link against system libraries. Install them on the
**build host** and pin the Cargo crate version to the installed major version.

- **Debian/Ubuntu**

  ```bash
  sudo apt-get install libgdal-dev libproj-dev
  ```

- **macOS (Homebrew)**

  ```bash
  brew install gdal proj
  ```

- **Windows**

  Easiest via vcpkg or conda (OSGeo4W also works). Then point the build at the
  libraries, e.g.:

  ```bash
  vcpkg install gdal proj
  # PowerShell: set before `cargo build --features proj,gdal`
  $env:GDAL_HOME = "C:\path\to\gdal"      # must contain lib\gdal_i.lib
  $env:GDAL_LIB_DIR = "$env:GDAL_HOME\lib"
  $env:PROJ_LIB = "C:\path\to\proj\share\proj"
  ```

  > Building `--features gdal` without `gdal_i.lib` on `$GDAL_LIB_DIR` /
  > `$GDAL_HOME\lib` fails with a `gdal-sys` build-script panic. That is a
  > missing system library, **not** a project misconfiguration — the default
  > build (no `gdal` feature) compiles without it.

## Tauri commands

`src/survey.rs` exposes the engine and the geospatial bridges over IPC; they are
registered in `src/lib.rs`. The web build calls the equivalent `survey-wasm`
exports instead, so never make a web feature depend on a desktop command.
