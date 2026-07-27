#!/usr/bin/env node
/**
 * Build the SiteSurveyor Windows desktop installer with a GDAL SDK.
 *
 * This wrapper finds or downloads a GDAL SDK, sets GDAL_HOME so the Rust
 * gdal-sys crate can link, bundles the GDAL/PROJ runtime as a Tauri resource,
 * and then runs the Tauri build with the `gdal` feature enabled.
 *
 * It detects, in order:
 *   1. GDAL_HOME environment variable
 *   2. OSGeo4W installation (C:\OSGeo4W64, C:\OSGeo4W, or %OSGEO4W_ROOT%)
 *   3. The GISInternals SDK cached in backend/gdal-sdk/ (auto-downloaded if missing)
 *
 * Run from PowerShell:
 *   npm run tauri:build:win
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BACKEND = join(ROOT, "backend");
const SDK_DIR = join(BACKEND, "gdal-sdk");

function log(...args) {
  console.log("[build-windows]", ...args);
}

function fatal(...args) {
  console.error("[build-windows]", ...args);
  process.exit(1);
}

function hasGdalHeaders(prefix) {
  return (
    existsSync(join(prefix, "include", "gdal.h")) ||
    existsSync(join(prefix, "apps", "gdal-dev", "include", "gdal.h"))
  );
}

function findOsgeo4wRoot() {
  const env = process.env.OSGEO4W_ROOT;
  if (env) {
    const dev = join(env, "apps", "gdal-dev");
    if (hasGdalHeaders(dev)) return dev;
    if (hasGdalHeaders(env)) return env;
  }

  for (const drive of ["C:", "D:"]) {
    for (const name of ["OSGeo4W64", "OSGeo4W"]) {
      const candidate = join(drive, "\\", name);
      const dev = join(candidate, "apps", "gdal-dev");
      if (hasGdalHeaders(dev)) return dev;
      if (hasGdalHeaders(candidate)) return candidate;
    }
  }

  if (process.env.LOCALAPPDATA) {
    const candidate = join(process.env.LOCALAPPDATA, "Programs", "OSGeo4W");
    const dev = join(candidate, "apps", "gdal-dev");
    if (hasGdalHeaders(dev)) return dev;
    if (hasGdalHeaders(candidate)) return candidate;
  }

  return null;
}

function findQgisGdal() {
  for (const programFiles of [
    process.env["ProgramFiles"] || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ]) {
    if (!existsSync(programFiles)) continue;
    try {
      for (const entry of readdirSync(programFiles)) {
        if (/^QGIS/i.test(entry)) {
          const candidate = join(programFiles, entry);
          if (hasGdalHeaders(candidate)) return candidate;
          const apps = join(candidate, "apps");
          if (existsSync(apps)) {
            for (const app of readdirSync(apps)) {
              const sub = join(apps, app);
              if (hasGdalHeaders(sub)) return sub;
            }
          }
        }
      }
    } catch {
      // ignore permission errors
    }
  }
  return null;
}

async function findGdalHome() {
  if (process.env.GDAL_HOME && hasGdalHeaders(process.env.GDAL_HOME)) {
    log(`using GDAL_HOME from environment: ${process.env.GDAL_HOME}`);
    return process.env.GDAL_HOME;
  }

  const osgeo = findOsgeo4wRoot();
  if (osgeo) {
    log(`using OSGeo4W GDAL: ${osgeo}`);
    return osgeo;
  }

  const qgis = findQgisGdal();
  if (qgis) {
    log(`using QGIS-bundled GDAL: ${qgis}`);
    return qgis;
  }

  if (!hasGdalHeaders(SDK_DIR)) {
    log("No local GDAL found; downloading GISInternals SDK...");
    const code = await run(process.execPath, [join(ROOT, "scripts", "download-gdal.mjs")], {
      cwd: ROOT,
    });
    if (code !== 0) {
      fatal("GDAL SDK download failed. Set GDAL_HOME to an existing GDAL install manually.");
    }
  }

  if (!hasGdalHeaders(SDK_DIR)) {
    fatal(`Could not find a usable GDAL install. Install OSGeo4W or set GDAL_HOME to a prefix that contains include/gdal.h.`);
  }

  log(`using downloaded GISInternals SDK: ${SDK_DIR}`);
  return SDK_DIR;
}

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main() {
  if (process.platform !== "win32") {
    fatal("This script is for Windows desktop builds. Use the platform-specific Tauri build on macOS/Linux, and make sure GDAL_HOME is set.");
  }

  const gdalHome = await findGdalHome();
  const buildEnv = { ...process.env, GDAL_HOME: gdalHome };

  // Bundle the GDAL/PROJ runtime so the installer ships it.
  const bundleCode = await run(process.execPath, [join(ROOT, "scripts", "bundle-gdal.mjs")], {
    cwd: BACKEND,
    env: buildEnv,
  });
  if (bundleCode !== 0) {
    fatal("Failed to bundle GDAL runtime.");
  }

  // Build the Tauri desktop installer with GDAL support.
  // GDAL_HOME must be visible to cargo/gdal-sys during the Rust build.
  const extraArgs = process.argv.slice(2);
  const tauriCli = join(ROOT, "frontend", "node_modules", "@tauri-apps", "cli", "tauri.js");
  const buildCode = await run(
    process.execPath,
    [tauriCli, "build", "--features", "gdal", ...extraArgs],
    {
      cwd: BACKEND,
      env: buildEnv,
    },
  );

  process.exit(buildCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
