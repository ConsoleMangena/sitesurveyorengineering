use std::path::Path;

/// Read SITESURVEYOR_LICENSE_PUBLIC_KEY from `backend/.env.licensing` if present,
/// so normal `cargo build` / `tauri build` invocations pick up the key without
/// anyone having to remember to export an env var. An explicit env var (e.g.
/// from CI secrets) always wins over the file.
fn load_public_key() -> Option<String> {
    // 1. Explicit env var takes precedence.
    if let Ok(k) = std::env::var("SITESURVEYOR_LICENSE_PUBLIC_KEY") {
        let k = k.trim().to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }

    // 2. Fall back to backend/.env.licensing (next to this build script).
    let env_file = Path::new(env!("CARGO_MANIFEST_DIR")).join(".env.licensing");
    println!("cargo:rerun-if-changed={}", env_file.display());
    let contents = std::fs::read_to_string(&env_file).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("SITESURVEYOR_LICENSE_PUBLIC_KEY=") {
            let v = rest.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn is_valid_pubkey(hex: &str) -> bool {
    hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

fn main() {
    // Re-run when the key source changes so a new value always takes effect
    // without a manual `cargo clean`.
    println!("cargo:rerun-if-env-changed=SITESURVEYOR_LICENSE_PUBLIC_KEY");

    let key = load_public_key();

    // Expose the resolved key to the crate as SITESURVEYOR_LICENSE_PUBLIC_KEY for
    // `option_env!` in src/license.rs. (Setting it here covers the file path.)
    if let Some(ref k) = key {
        println!("cargo:rustc-env=SITESURVEYOR_LICENSE_PUBLIC_KEY={k}");
    }

    // Unforgettable guarantee: a RELEASE build must not ship without a valid
    // licensing public key (otherwise the app silently rejects every license).
    // Debug/dev builds are allowed to proceed (verification fails closed) so
    // day-to-day development isn't blocked.
    let is_release = std::env::var("PROFILE")
        .map(|p| p == "release")
        .unwrap_or(false);
    if is_release {
        match key.as_deref() {
            Some(k) if is_valid_pubkey(k) => {}
            _ => {
                panic!(
                    "\n\n  x Licensing public key is not configured for this RELEASE build.\n\
                     \n  The app would reject every license. Fix it with:\n\
                     \n      node scripts/setup-licensing.mjs\n\
                     \n  (or set SITESURVEYOR_LICENSE_PUBLIC_KEY to a 64-hex-char key).\n\n"
                );
            }
        }
    } else if key.as_deref().map(is_valid_pubkey) != Some(true) {
        // Helpful nudge during development, without failing the build.
        println!(
            "cargo:warning=Licensing public key not set; license verification \
             will reject all licenses. Run `node scripts/setup-licensing.mjs`."
        );
    }

    tauri_build::build()
}
