//! ════════════════════════════════════════════════════════════════
//! SiteSurveyor — License verification core (Rust / Tauri)
//! ════════════════════════════════════════════════════════════════
//!
//! Security model
//! --------------
//! * Licenses are **Ed25519-signed tokens** issued by the server (Supabase
//!   Edge Function). The private key NEVER ships with the app; only the
//!   public key is embedded below, so a cracked client cannot forge a token.
//! * The token is a compact `base64url(payload).base64url(signature)` string.
//!   The payload is canonical JSON describing the license (edition, expiry,
//!   bound machine fingerprint, features, …).
//! * Verification happens **here in Rust**, not in JS, so the gate cannot be
//!   trivially patched out of the web bundle.
//! * The license is bound to a **machine fingerprint** (seat binding). A token
//!   copied to another machine fails the fingerprint check.
//! * A **tamper-evident local cache** persists the last validated license so
//!   the app keeps working offline. The cache is keyed/HMAC'd to the machine
//!   so it cannot be copied between machines or hand-edited.
//! * **Clock-rollback detection**: we persist the highest wall-clock time we
//!   have ever seen. If the system clock is later found to be *before* that
//!   value, we treat the environment as tampered and fall back to the strict
//!   grace rules / refuse to extend grace.
//! * An **offline grace period** lets legitimate users keep working without a
//!   network for a bounded window; it silently refreshes whenever the app is
//!   online and re-validates with the server.
//!
//! What this module deliberately does NOT do
//! -----------------------------------------
//! * It does not talk to the network. Online activation/refresh is performed
//!   by the frontend against the Supabase Edge Function; the resulting signed
//!   token is handed back here via `activate_license` / `refresh_license` for
//!   verification and caching. This keeps the HTTP/secret handling in one
//!   place (the Edge Function) while keeping verification in Rust.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};

// ─── Configuration ──────────────────────────────────────────────

/// Ed25519 **public** key (32 bytes, hex-encoded) used to verify license
/// tokens. It is provided at COMPILE TIME via the `SITESURVEYOR_LICENSE_PUBLIC_KEY`
/// environment variable so that no real key is ever committed to source.
///
/// How to build with your key (generate the pair privately, see SECURITY notes):
///   Windows (cmd):   set SITESURVEYOR_LICENSE_PUBLIC_KEY=<64-hex> && cargo build
///   PowerShell:      $env:SITESURVEYOR_LICENSE_PUBLIC_KEY="<64-hex>"; cargo build
///   bash:            SITESURVEYOR_LICENSE_PUBLIC_KEY=<64-hex> cargo build
///
/// The matching 32-byte private SEED goes ONLY into the Supabase secret
/// `LICENSE_PRIVATE_KEY_HEX` (never into any file).
///
/// NOTE: shipping the *public* key in the binary is safe and expected. Only
/// the *private* key must stay server-side. If this env var is unset at build
/// time, verification fails closed (all licenses are rejected as invalid).
const LICENSE_PUBLIC_KEY_HEX: &str = match option_env!("SITESURVEYOR_LICENSE_PUBLIC_KEY") {
    Some(k) => k,
    // Intentionally invalid placeholder: keeps the type a &'static str while
    // guaranteeing no usable key is baked in by default. `verifying_key()`
    // rejects this, so an unconfigured build cannot validate any license.
    None => "UNSET",
};

/// Default offline grace window (days) after a license's last successful
/// server validation, during which the app keeps running offline. Kept inside
/// the recommended 7–14 day band.
const DEFAULT_OFFLINE_GRACE_DAYS: i64 = 14;

/// Filename of the tamper-evident local license cache (stored in the app data
/// dir).
const LICENSE_CACHE_FILE: &str = "license.cache";

/// Filename of the monotonic clock anchor used for rollback detection.
const CLOCK_ANCHOR_FILE: &str = "license.anchor";

// ─── License edition / status ───────────────────────────────────

/// The product edition a license grants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    Starter,
    Business,
    Enterprise,
}

impl Edition {
    fn as_str(&self) -> &'static str {
        match self {
            Edition::Starter => "starter",
            Edition::Business => "business",
            Edition::Enterprise => "enterprise",
        }
    }
}

/// Overall license state surfaced to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseState {
    /// No license has ever been activated on this machine.
    Unlicensed,
    /// Valid and within its paid term.
    Active,
    /// Term expired or no longer server-validated, but still inside the
    /// offline grace window — app keeps working, UI should warn.
    Grace,
    /// Past expiry and past the grace window — app must lock to activation.
    Expired,
    /// The token failed signature/fingerprint/tamper checks — treat as locked.
    Invalid,
}

impl LicenseState {
    fn as_str(&self) -> &'static str {
        match self {
            LicenseState::Unlicensed => "unlicensed",
            LicenseState::Active => "active",
            LicenseState::Grace => "grace",
            LicenseState::Expired => "expired",
            LicenseState::Invalid => "invalid",
        }
    }
}

// ─── Token payload (signed by the server) ───────────────────────

/// The canonical, server-signed payload. Field names are stable because they
/// are part of the signed bytes — changing them breaks verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    /// License id (uuid) in the server's `licenses` table.
    pub license_id: String,
    /// The account / customer this license belongs to.
    pub account_id: String,
    /// Edition granted.
    pub edition: Edition,
    /// Machine fingerprint this seat is bound to (sha256 hex).
    pub fingerprint: String,
    /// Unix seconds: when the license term ends (paid-through date).
    pub expires_at: i64,
    /// Unix seconds: when the server last validated/issued this token.
    pub issued_at: i64,
    /// Optional explicit grace override (days). Falls back to default.
    #[serde(default)]
    pub grace_days: Option<i64>,
    /// Feature flags layered on top of the edition (e.g. ["lidar_import"]).
    #[serde(default)]
    pub features: Vec<String>,
    /// Monotonic seat/issue counter; lets the server invalidate older tokens
    /// for the same seat by issuing a higher number (revocation/refresh).
    #[serde(default)]
    pub seq: u64,
}

// ─── Public status returned to the frontend ─────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub state: String,
    pub edition: Option<String>,
    pub features: Vec<String>,
    pub expires_at: Option<i64>,
    pub issued_at: Option<i64>,
    /// Unix seconds at which offline grace runs out (if in grace / active).
    pub grace_until: Option<i64>,
    pub fingerprint: String,
    /// The account / customer this license belongs to. Surfaced so the
    /// frontend gate can verify the locally-cached license belongs to the
    /// account currently signed in. `None` when no valid license is installed.
    pub account_id: Option<String>,
    /// Human-readable reason when state is invalid/expired (for support).
    pub message: Option<String>,
}

impl LicenseStatus {
    fn unlicensed(fingerprint: String, message: Option<String>) -> Self {
        LicenseStatus {
            state: LicenseState::Unlicensed.as_str().to_string(),
            edition: None,
            features: vec![],
            expires_at: None,
            issued_at: None,
            grace_until: None,
            fingerprint,
            account_id: None,
            message,
        }
    }

    fn invalid(fingerprint: String, message: &str) -> Self {
        LicenseStatus {
            state: LicenseState::Invalid.as_str().to_string(),
            edition: None,
            features: vec![],
            expires_at: None,
            issued_at: None,
            grace_until: None,
            fingerprint,
            account_id: None,
            message: Some(message.to_string()),
        }
    }
}

// ─── Tamper-evident cache envelope ──────────────────────────────

/// What we actually persist to disk: the raw signed token plus an HMAC-style
/// integrity tag bound to the machine. We re-verify the token's signature on
/// every load anyway, so the tag's job is only to make casual hand-editing /
/// cross-machine copying obvious and to protect the bookkeeping fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEnvelope {
    /// The server-signed license token (payload.signature, base64url).
    token: String,
    /// Highest validated wall-clock time we have observed (unix seconds).
    last_seen_time: i64,
    /// Integrity tag = sha256(token || last_seen_time || machine_secret).
    tag: String,
}

// ─── Errors ─────────────────────────────────────────────────────

#[derive(Debug)]
enum LicenseError {
    Format(String),
    Signature,
    Fingerprint,
    PublicKey,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseError::Format(s) => write!(f, "malformed license token: {s}"),
            LicenseError::Signature => write!(f, "license signature verification failed"),
            LicenseError::Fingerprint => write!(f, "license is bound to a different machine"),
            LicenseError::PublicKey => write!(f, "embedded license public key is invalid"),
        }
    }
}

// ─── Machine fingerprint ────────────────────────────────────────

/// A stable, machine-bound identifier. We hash the OS machine-uid so the raw
/// id is never exposed and the value is uniform-length.
pub fn machine_fingerprint(app_data_dir: &Path) -> String {
    let raw = raw_machine_id(app_data_dir);
    let mut hasher = Sha256::new();
    hasher.update(b"sitesurveyor-fp-v1:");
    hasher.update(raw.as_bytes());
    hex_encode(&hasher.finalize())
}

/// Returns the raw, OS-provided stable machine identifier.
///
/// On desktop platforms we use the `machine-uid` crate. That crate does not
/// build for mobile targets (Android/iOS), so there we fall back to a stable
/// per-install identifier persisted in the app data dir (see
/// `mobile_install_id`). Seat binding on mobile therefore tracks the install
/// rather than the hardware, which is the expected behaviour for app-store
/// distributions where hardware IDs are not exposed to apps.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
fn raw_machine_id(_app_data_dir: &Path) -> String {
    machine_uid::get().unwrap_or_else(|_| "unknown-machine".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn raw_machine_id(app_data_dir: &Path) -> String {
    mobile_install_id(app_data_dir)
}

/// A stable per-install identifier for mobile targets. Generated once and
/// stored next to the app's data; if it cannot be read or written we fall back
/// to a constant so the app still functions (verification remains anchored on
/// the Ed25519 signature, not this value).
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn mobile_install_id(app_data_dir: &Path) -> String {
    use std::io::Write;

    let dir = app_data_dir;
    let id_path = dir.join("install.id");

    if let Ok(existing) = std::fs::read_to_string(&id_path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    // Generate a new random id from the current time + process entropy.
    let mut hasher = Sha256::new();
    hasher.update(b"sitesurveyor-install-v1:");
    hasher.update(now_unix().to_le_bytes());
    hasher.update(std::process::id().to_le_bytes());
    let id = hex_encode(&hasher.finalize());

    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::File::create(&id_path) {
        let _ = f.write_all(id.as_bytes());
    }
    id
}

/// A per-machine secret used only to tag the local cache. Derived from the
/// fingerprint with domain separation; not security-critical (the real trust
/// anchor is the Ed25519 signature) but it deters trivial tampering.
fn machine_secret(app_data_dir: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"sitesurveyor-cache-secret-v1:");
    hasher.update(machine_fingerprint(app_data_dir).as_bytes());
    hex_encode(&hasher.finalize())
}

// ─── Time helpers ───────────────────────────────────────────────

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

const DAY_SECONDS: i64 = 86_400;

// ─── Token verification ─────────────────────────────────────────

fn verifying_key() -> Result<VerifyingKey, LicenseError> {
    let bytes = hex_decode(LICENSE_PUBLIC_KEY_HEX).ok_or(LicenseError::PublicKey)?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| LicenseError::PublicKey)?;
    VerifyingKey::from_bytes(&arr).map_err(|_| LicenseError::PublicKey)
}

/// Parse and cryptographically verify a token, returning its payload.
/// Does NOT check expiry or fingerprint — callers layer those on top.
fn verify_token(token: &str) -> Result<LicensePayload, LicenseError> {
    let (payload_b64, sig_b64) = token
        .split_once('.')
        .ok_or_else(|| LicenseError::Format("missing separator".into()))?;

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| LicenseError::Format(format!("payload base64: {e}")))?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|e| LicenseError::Format(format!("signature base64: {e}")))?;

    let sig_arr: [u8; 64] = sig_bytes
        .try_into()
        .map_err(|_| LicenseError::Format("signature length".into()))?;
    let signature = Signature::from_bytes(&sig_arr);

    let key = verifying_key()?;
    // The signature covers the raw base64url payload segment bytes (what the
    // server signed), which avoids JSON re-serialization ambiguity.
    key.verify_strict(payload_b64.as_bytes(), &signature)
        .map_err(|_| LicenseError::Signature)?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|e| LicenseError::Format(format!("payload json: {e}")))?;

    Ok(payload)
}

/// Verify a token AND that it is bound to this machine.
fn verify_token_for_this_machine(
    app_data_dir: &Path,
    token: &str,
) -> Result<LicensePayload, LicenseError> {
    let payload = verify_token(token)?;
    if payload.fingerprint != machine_fingerprint(app_data_dir) {
        return Err(LicenseError::Fingerprint);
    }
    Ok(payload)
}

// ─── Cache I/O (tamper-evident) ─────────────────────────────────

fn cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LICENSE_CACHE_FILE)
}

fn anchor_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CLOCK_ANCHOR_FILE)
}

fn compute_tag(app_data_dir: &Path, token: &str, last_seen_time: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.update(b"|");
    hasher.update(last_seen_time.to_le_bytes());
    hasher.update(b"|");
    hasher.update(machine_secret(app_data_dir).as_bytes());
    hex_encode(&hasher.finalize())
}

fn write_cache(app_data_dir: &Path, token: &str, last_seen_time: i64) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let env = CacheEnvelope {
        token: token.to_string(),
        last_seen_time,
        tag: compute_tag(app_data_dir, token, last_seen_time),
    };
    let json = serde_json::to_vec(&env).map_err(std::io::Error::other)?;
    std::fs::write(cache_path(app_data_dir), json)
}

/// Returns (envelope, tampered?). `tampered = true` when the integrity tag
/// does not match — the token may still verify cryptographically, but we know
/// the bookkeeping was altered or the file was moved between machines.
fn read_cache(app_data_dir: &Path) -> Option<(CacheEnvelope, bool)> {
    let data = std::fs::read(cache_path(app_data_dir)).ok()?;
    let env: CacheEnvelope = serde_json::from_slice(&data).ok()?;
    let expected = compute_tag(app_data_dir, &env.token, env.last_seen_time);
    let tampered = expected != env.tag;
    Some((env, tampered))
}

// ─── Clock-rollback anchor ──────────────────────────────────────

fn read_anchor(app_data_dir: &Path) -> i64 {
    std::fs::read_to_string(anchor_path(app_data_dir))
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

fn write_anchor(app_data_dir: &Path, value: i64) {
    let _ = std::fs::create_dir_all(app_data_dir);
    let _ = std::fs::write(anchor_path(app_data_dir), value.to_string());
}

/// Advance the monotonic clock anchor and return the trusted "now": the larger
/// of wall-clock and anchor, and whether a rollback was detected.
fn trusted_now(app_data_dir: &Path) -> (i64, bool) {
    let wall = now_unix();
    let anchor = read_anchor(app_data_dir);
    let rolled_back = wall < anchor;
    let trusted = wall.max(anchor);
    // Only move the anchor forward.
    if trusted > anchor {
        write_anchor(app_data_dir, trusted);
    }
    (trusted, rolled_back)
}

// ─── Status evaluation ──────────────────────────────────────────

fn grace_window_seconds(payload: &LicensePayload) -> i64 {
    payload.grace_days.unwrap_or(DEFAULT_OFFLINE_GRACE_DAYS) * DAY_SECONDS
}

/// Compute the user-facing status from a verified payload, the trusted time,
/// the last-seen validation time, and whether tamper/rollback was detected.
fn evaluate(
    payload: &LicensePayload,
    trusted_now: i64,
    last_seen_time: i64,
    tampered: bool,
    rolled_back: bool,
    fingerprint: String,
) -> LicenseStatus {
    let grace = grace_window_seconds(payload);

    // The grace clock is anchored to the last server validation we trust.
    let grace_until = last_seen_time + grace;

    // If the clock was rolled back or the cache tag was tampered, we refuse to
    // grant any extra leniency: we evaluate strictly against the paid term and
    // do not extend grace beyond what was already earned.
    let suspicious = tampered || rolled_back;

    let (state, message) = if trusted_now <= payload.expires_at {
        // Within the paid term.
        (LicenseState::Active, None)
    } else if !suspicious && trusted_now <= grace_until {
        // Past expiry but within offline grace.
        (
            LicenseState::Grace,
            Some("License term ended; running in offline grace. Connect to renew.".to_string()),
        )
    } else if suspicious && trusted_now <= grace_until {
        // Grace would apply, but environment looks tampered → lock.
        (
            LicenseState::Expired,
            Some("License validation failed (clock/tamper). Connect to re-activate.".to_string()),
        )
    } else {
        (
            LicenseState::Expired,
            Some("License expired. Connect to renew your subscription.".to_string()),
        )
    };

    LicenseStatus {
        state: state.as_str().to_string(),
        edition: Some(payload.edition.as_str().to_string()),
        features: payload.features.clone(),
        expires_at: Some(payload.expires_at),
        issued_at: Some(payload.issued_at),
        grace_until: Some(grace_until),
        fingerprint,
        account_id: Some(payload.account_id.clone()),
        message,
    }
}

// ─── In-memory state (debounce repeated disk reads) ─────────────

/// Serializes cache reads/writes so concurrent command invocations cannot
/// race on the license cache / clock anchor files.
#[derive(Default)]
pub struct LicenseManager {
    _lock: Mutex<()>,
}

impl LicenseManager {
    pub fn new() -> Self {
        LicenseManager {
            _lock: Mutex::new(()),
        }
    }
}

// ─── Core operations (used by Tauri commands) ───────────────────

/// Validate whatever license is cached on this machine and report status.
/// This is the function called on startup and on every gate check.
fn status_internal(app_data_dir: &Path) -> LicenseStatus {
    let fingerprint = machine_fingerprint(app_data_dir);
    let (trusted, rolled_back) = trusted_now(app_data_dir);

    let (env, tampered) = match read_cache(app_data_dir) {
        Some(v) => v,
        None => return LicenseStatus::unlicensed(fingerprint, None),
    };

    let payload = match verify_token_for_this_machine(app_data_dir, &env.token) {
        Ok(p) => p,
        Err(LicenseError::Fingerprint) => {
            return LicenseStatus::invalid(
                fingerprint,
                "This license is activated on a different device.",
            )
        }
        Err(e) => return LicenseStatus::invalid(fingerprint, &e.to_string()),
    };

    evaluate(
        &payload,
        trusted,
        env.last_seen_time,
        tampered,
        rolled_back,
        fingerprint,
    )
}

/// Accept a freshly issued/refreshed token from the server, verify it, bind it
/// to this machine, and persist it. Returns the resulting status.
fn install_token_internal(app_data_dir: &Path, token: &str) -> Result<LicenseStatus, String> {
    // Cryptographically verify and confirm seat binding before trusting it.
    let payload = verify_token_for_this_machine(app_data_dir, token).map_err(|e| e.to_string())?;

    // Reject tokens that are already expired at install time when there is no
    // offline grace left. This prevents installing stale tokens that can never
    // result in a usable license state.
    let (trusted, _rolled_back) = trusted_now(app_data_dir);
    let grace_until = payload.issued_at + grace_window_seconds(&payload);
    if trusted > payload.expires_at && trusted > grace_until {
        return Err("License token is expired and outside the offline grace window.".to_string());
    }

    // If a newer token already exists for this seat (higher seq), refuse to
    // downgrade — protects against replay of an older, broader token.
    if let Some((env, _)) = read_cache(app_data_dir) {
        if let Ok(existing) = verify_token(&env.token) {
            if existing.license_id == payload.license_id && existing.seq > payload.seq {
                return Err("A newer license is already installed on this device.".to_string());
            }
        }
    }

    // last_seen_time = the server's issued_at (trusted validation moment),
    // clamped to not exceed trusted_now to keep the grace clock honest. A
    // token with a future issued_at must not push the grace window forward.
    let last_seen = payload.issued_at.min(trusted);

    write_cache(app_data_dir, token, last_seen)
        .map_err(|e| format!("failed to persist license: {e}"))?;

    Ok(status_internal(app_data_dir))
}

// ─── Tauri commands ─────────────────────────────────────────────

/// Returns the machine fingerprint the frontend must send to the activation
/// Edge Function so the server can bind the seat.
#[tauri::command]
pub fn license_fingerprint(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Error: {}", e))?;
    Ok(machine_fingerprint(&dir))
}

/// Returns the current license status for this machine (validated offline).
#[tauri::command]
pub fn license_status(app_handle: tauri::AppHandle) -> LicenseStatus {
    use tauri::Manager;
    let dir = match app_handle.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => {
            return LicenseStatus::invalid(
                "unknown".to_string(),
                "Could not resolve application data directory.",
            )
        }
    };
    status_internal(&dir)
}

/// Install a signed token returned by the activation/refresh Edge Function.
/// Used for both first-time activation and periodic online refresh.
#[tauri::command]
pub fn license_activate(
    app_handle: tauri::AppHandle,
    token: String,
) -> Result<LicenseStatus, String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    install_token_internal(&dir, &token)
}

/// Convenience alias for periodic refresh; identical verification path.
#[tauri::command]
pub fn license_refresh(
    app_handle: tauri::AppHandle,
    token: String,
) -> Result<LicenseStatus, String> {
    license_activate(app_handle, token)
}

/// Remove the local license (e.g. on explicit deactivation / sign-out of a
/// licensed seat). Does not touch the server-side seat record.
#[tauri::command]
pub fn license_deactivate(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let path = cache_path(&dir);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("failed to remove license: {e}"))?;
    }
    Ok(())
}

/// Hard gate used before privileged operations (e.g. enabling cloud sync in
/// the UI). Returns true only when the license is Active or in Grace.
#[tauri::command]
pub fn license_is_valid(app_handle: tauri::AppHandle) -> bool {
    let status = license_status(app_handle);
    status.state == LicenseState::Active.as_str() || status.state == LicenseState::Grace.as_str()
}

/// Build-config self-check surfaced to the UI (dev banner) and usable by the
/// activation flow to detect a server/client key mismatch early.
#[derive(Debug, Clone, Serialize)]
pub struct LicenseSelfCheck {
    /// True when a syntactically valid public key was embedded at build time.
    pub key_configured: bool,
    /// First 8 hex chars of the embedded public key (a stable "key id"), or
    /// empty when unconfigured.
    pub key_id: String,
    /// Human-readable hint when something is wrong (for a dev-only banner).
    pub message: Option<String>,
}

/// Returns whether the embedded licensing public key is present and valid.
/// Lets the frontend warn immediately (in dev) instead of failing only at
/// activation time, and exposes a key id for mismatch detection.
#[tauri::command]
pub fn license_selfcheck() -> LicenseSelfCheck {
    match verifying_key() {
        Ok(_) => {
            let key_id = LICENSE_PUBLIC_KEY_HEX
                .get(0..8)
                .unwrap_or_default()
                .to_lowercase();
            LicenseSelfCheck {
                key_configured: true,
                key_id,
                message: None,
            }
        }
        Err(_) => LicenseSelfCheck {
            key_configured: false,
            key_id: String::new(),
            message: Some(
                "Licensing public key is not configured for this build. \
                 Run `node scripts/setup-licensing.mjs` and rebuild."
                    .to_string(),
            ),
        },
    }
}

// ─── Hex helpers (avoid extra deps) ─────────────────────────────

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

// ─── Tests ──────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn test_keypair() -> (SigningKey, [u8; 32]) {
        // Deterministic test key (NOT used in production).
        let secret = [7u8; 32];
        let sk = SigningKey::from_bytes(&secret);
        let vk = sk.verifying_key().to_bytes();
        (sk, vk)
    }

    #[test]
    fn fingerprint_stability() {
        let dir = std::path::Path::new("/dummy/path");
        let a = machine_fingerprint(dir);
        let b = machine_fingerprint(dir);
        assert_eq!(a, b);
        assert!(a.len() > 10);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hex_roundtrip() {
        let data = vec![0u8, 1, 2, 250, 255];
        let enc = hex_encode(&data);
        assert_eq!(hex_decode(&enc).unwrap(), data);
    }

    #[test]
    fn evaluate_states_across_lifecycle() {
        let payload = LicensePayload {
            license_id: "L1".into(),
            account_id: "A1".into(),
            edition: Edition::Business,
            fingerprint: machine_fingerprint(std::path::Path::new("")),
            issued_at: 1_000,
            expires_at: 2_000,
            grace_days: Some(1), // 86_400s grace
            features: vec!["lidar_import".into()],
            seq: 1,
        };

        // Active: before expiry.
        let s = evaluate(
            &payload,
            1_500,
            1_000,
            false,
            false,
            payload.fingerprint.clone(),
        );
        assert_eq!(s.state, "active");
        assert_eq!(s.edition.as_deref(), Some("business"));

        // Grace: after expiry, within grace, clean environment.
        let s = evaluate(
            &payload,
            2_000 + 10,
            2_000,
            false,
            false,
            payload.fingerprint.clone(),
        );
        assert_eq!(s.state, "grace");

        // Expired: past grace window.
        let s = evaluate(
            &payload,
            2_000 + DAY_SECONDS + 10,
            2_000,
            false,
            false,
            payload.fingerprint.clone(),
        );
        assert_eq!(s.state, "expired");

        // Tamper inside grace → expired (no leniency).
        let s = evaluate(
            &payload,
            2_000 + 10,
            2_000,
            true,
            false,
            payload.fingerprint.clone(),
        );
        assert_eq!(s.state, "expired");

        // Clock rollback inside grace → expired.
        let s = evaluate(
            &payload,
            2_000 + 10,
            2_000,
            false,
            true,
            payload.fingerprint.clone(),
        );
        assert_eq!(s.state, "expired");
    }

    #[test]
    fn selfcheck_reports_key_id_when_configured() {
        // This test build embeds the dev key from backend/.env.licensing via
        // build.rs, so the self-check should report a configured key.
        let sc = license_selfcheck();
        if sc.key_configured {
            assert_eq!(sc.key_id.len(), 8);
            assert!(sc.key_id.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(sc.message.is_none());
        } else {
            // Unconfigured build: must clearly say so and carry no key id.
            assert!(sc.key_id.is_empty());
            assert!(sc.message.is_some());
        }
    }

    fn make_token(sk: &SigningKey, payload: &LicensePayload) -> String {
        let json = serde_json::to_vec(payload).unwrap();
        let payload_b64 = URL_SAFE_NO_PAD.encode(&json);
        let sig = sk.sign(payload_b64.as_bytes());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
        format!("{payload_b64}.{sig_b64}")
    }

    #[test]
    fn token_verifies_only_with_matching_key() {
        let (sk, vk) = test_keypair();
        let payload = LicensePayload {
            license_id: "L1".into(),
            account_id: "A1".into(),
            edition: Edition::Starter,
            fingerprint: machine_fingerprint(std::path::Path::new("")),
            issued_at: 1,
            expires_at: 99_999_999_999,
            grace_days: None,
            features: vec![],
            seq: 0,
        };
        let token = make_token(&sk, &payload);

        // Manually verify with the matching key (mirrors verify_token).
        let (p_b64, s_b64) = token.split_once('.').unwrap();
        let sig_bytes = URL_SAFE_NO_PAD.decode(s_b64).unwrap();
        let sig_arr: [u8; 64] = sig_bytes.try_into().unwrap();
        let sig = Signature::from_bytes(&sig_arr);
        let key = VerifyingKey::from_bytes(&vk).unwrap();
        assert!(key.verify_strict(p_b64.as_bytes(), &sig).is_ok());

        // A different key must reject it.
        let (_, other_vk) = {
            let other = SigningKey::from_bytes(&[9u8; 32]);
            (other.clone(), other.verifying_key().to_bytes())
        };
        let other_key = VerifyingKey::from_bytes(&other_vk).unwrap();
        assert!(other_key.verify_strict(p_b64.as_bytes(), &sig).is_err());
    }

    #[test]
    fn cache_tag_detects_tampering() {
        let token = "abc.def";
        let dir = std::path::Path::new("/dummy/path");
        let tag = compute_tag(dir, token, 1234);
        assert_eq!(tag, compute_tag(dir, token, 1234));
        assert_ne!(tag, compute_tag(dir, token, 1235));
        assert_ne!(tag, compute_tag(dir, "abc.xyz", 1234));
    }
}
