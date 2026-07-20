/**
 * Shared license-signing helpers for SiteSurveyor Edge Functions (Deno).
 * ------------------------------------------------------------------
 * The Ed25519 PRIVATE key lives ONLY here, sourced from a Supabase secret
 * (`LICENSE_PRIVATE_KEY_HEX`). It is never shipped to clients. The Rust client
 * embeds only the matching PUBLIC key and verifies the signed tokens offline.
 *
 * Token format (matches backend/src/license.rs):
 *   base64url(payload_json) + "." + base64url(signature)
 *   - signature is Ed25519 over the *bytes of the base64url payload segment*.
 *
 * Set the secret once (locally generate a keypair):
 *   supabase secrets set LICENSE_PRIVATE_KEY_HEX=<64-hex-bytes seed>
 */

export type Edition = "starter" | "business" | "enterprise";

export interface LicensePayload {
  license_id: string;
  account_id: string;
  edition: Edition;
  fingerprint: string;
  expires_at: number; // unix seconds
  issued_at: number; // unix seconds
  grace_days?: number | null;
  features: string[];
  seq: number;
}

// ─── base64url (no padding) ─────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ─── Key import ─────────────────────────────────────────────────

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

async function importPrivateKey(seedHex: string): Promise<CryptoKey> {
  const seed = hexToBytes(seedHex.trim());
  if (seed.length !== 32) {
    throw new Error("LICENSE_PRIVATE_KEY_HEX must be a 32-byte (64 hex char) seed");
  }
  const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_ED25519_PREFIX, 0);
  pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);

  return await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
}

// ─── Token signing ──────────────────────────────────────────────

export async function signLicense(payload: LicensePayload): Promise<string> {
  const seedHex = Deno.env.get("LICENSE_PRIVATE_KEY_HEX");
  if (!seedHex) {
    throw new Error("LICENSE_PRIVATE_KEY_HEX secret is not configured");
  }
  const key = await importPrivateKey(seedHex);

  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64UrlEncode(payloadBytes);

  // IMPORTANT: sign the bytes of the base64url payload segment (not the raw
  // JSON), to exactly match the Rust verifier.
  const sigBuf = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(payloadB64),
  );
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));

  return `${payloadB64}.${sigB64}`;
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
