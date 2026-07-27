#!/usr/bin/env node
/**
 * Start the Tauri dev app on Windows using a locally installed GDAL SDK.
 *
 * It detects, in order:
 *   1. GDAL_HOME environment variable
 *   2. OSGeo4W installation (C:\OSGeo4W64, C:\OSGeo4W, or %OSGEO4W_ROOT%)
 *   3. The GISInternals SDK cached in backend/gdal-sdk/ (auto-downloaded if missing)
 *
 * Run from PowerShell (not WSL):
 *   npm run tauri:dev:win
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
  console.log("[dev-windows]", ...args);
}

function fatal(...args) {
  console.error("[dev-windows]", ...args);
  process.exit(1);
}

function quote(p) {
  return `"${p}"`;
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

  // OSGeo4W installed per-user (e.g. via winget or the web installer).
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
          // QGIS ships GDAL under apps\gdal or similar; be permissive.
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

function findGdalHome() {
  if (process.env.GDAL_HOME && hasGdalHeaders(process.env.GDAL_HOME)) {
    return process.env.GDAL_HOME;
  }

  const osgeo = findOsgeo4wRoot();
  if (osgeo) return osgeo;

  const qgis = findQgisGdal();
  if (qgis) return qgis;

  if (hasGdalHeaders(SDK_DIR)) return SDK_DIR;

  return null;
}

async function downloadSdk() {
  log("No local GDAL found; downloading GISInternals SDK...");

  // Run node directly (no shell) so paths with spaces in node.exe are handled
  // correctly by CreateProcess.
  const child = spawn(process.execPath, [join(ROOT, "scripts", "download-gdal.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });

  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) {
    fatal("GDAL SDK download failed. Set GDAL_HOME to an existing GDAL install manually.");
  }
}

async function main() {
  if (process.platform !== "win32") {
    fatal("This script is for Windows.");
  }

  let gdalHome = findGdalHome();

  if (!gdalHome) {
    await downloadSdk();
    gdalHome = findGdalHome();
  }

  if (!gdalHome) {
    fatal(
      "Could not find a usable GDAL install. Install OSGeo4W or set GDAL_HOME to a prefix that contains include/gdal.h."
    );
  }

  log("GDAL_HOME ->", gdalHome);

  // OSGeo4W splits GDAL and its dependencies between apps/gdal-dev/bin and the
  // OSGeo4W root/bin. Make sure both are on PATH so the running app can load
  // gdal.dll, proj.dll, sqlite3.dll, and the rest of the dependency tree.
  const binPaths = [join(gdalHome, "bin")];
  const normalized = gdalHome.replace(/\\/g, "/");
  if (normalized.endsWith("/apps/gdal-dev")) {
    binPaths.push(resolve(gdalHome, "..", "..", "bin"));
  }
  const env = {
    ...process.env,
    GDAL_HOME: gdalHome,
    PATH: `${binPaths.join(";")};${process.env.PATH || ""}`,
  };

  // Invoke the local Tauri CLI directly. Using `npm exec tauri` is fragile on
  // Windows because npm may resolve the unscoped `tauri` package from the
  // registry instead of the locally installed `@tauri-apps/cli` binary.
  const tauriCli = join(ROOT, "frontend", "node_modules", "@tauri-apps", "cli", "tauri.js");
  const child = spawn(
    process.execPath,
    [tauriCli, "dev", "--features", "gdal", "--no-dev-server-wait"],
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
    },
  );

  child.on("close", (code) => process.exit(code ?? 0));
}

main().catch(fatal);
