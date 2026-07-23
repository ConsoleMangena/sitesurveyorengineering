/**
 * License admin service
 * ---------------------
 * Typed wrappers around the platform-admin-only Edge Functions
 * (license-admin-create / -list / -update). All authorization is enforced
 * server-side; these calls simply forward the authenticated session.
 *
 * Mirrors the contract returned by the Edge Functions and used by the
 * platform admin license dashboard.
 */

import { supabase } from '@/lib/supabase/client';
import type { Edition } from '@/services/license';

export type LicenseStatus = 'active' | 'suspended' | 'cancelled';

export interface BoundDevice {
  id: string;
  fingerprint: string;
  last_seen_at: string | null;
  created_at: string;
}

export interface AdminLicense {
  id: string;
  account_id: string | null;
  customer_email: string | null;
  license_key: string;
  edition: Edition;
  features: string[];
  seats: number;
  grace_days: number;
  status: LicenseStatus;
  expires_at: string;
  notes: string | null;
  issued_by: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  seats_used: number;
  bound_devices: BoundDevice[];
}

export interface CreateLicenseInput {
  customer_email: string;
  edition: Edition;
  seats?: number;
  features?: string[];
  expires_at?: string;
  grace_days?: number;
  notes?: string;
}

function ensureSupabase() {
  if (!supabase) throw new Error('A Supabase connection is required for license administration.');
  return supabase;
}

async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const client = ensureSupabase();
  const { data, error } = await client.functions.invoke<T & { error?: string }>(name, { body });
  if (error) {
    // On a non-2xx response, supabase-js sets `error.context` to the raw
    // Response object (NOT a parsed body). Read the JSON body so the precise
    // server-side reason (e.g. "expires_at must be a valid future date") is
    // surfaced to the user instead of the generic "non-2xx status code".
    const ctx = (error as { context?: unknown })?.context;
    let serverMessage: string | undefined;
    if (ctx instanceof Response) {
      try {
        const parsed = await ctx.clone().json();
        serverMessage = (parsed as { error?: string })?.error;
      } catch {
        try {
          const text = await ctx.clone().text();
          serverMessage = text || undefined;
        } catch {
          /* ignore: fall back to error.message below */
        }
      }
    } else if (ctx && typeof ctx === 'object' && 'error' in ctx) {
      serverMessage = (ctx as { error?: string }).error;
    }
    throw new Error(serverMessage || error.message || 'Request failed');
  }
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { error?: string }).error as string);
  }
  return data as T;
}

export interface CreateLicenseResult {
  license: AdminLicense;
  key: string;
}

export async function createLicense(input: CreateLicenseInput): Promise<CreateLicenseResult> {
  return invokeFn('license-admin-create', input as unknown as Record<string, unknown>);
}

export interface ListParams {
  search?: string;
  status?: LicenseStatus;
  page?: number;
  page_size?: number;
}

export interface ListResult {
  licenses: AdminLicense[];
  total: number;
  page: number;
  page_size: number;
}

export async function listLicenses(params: ListParams = {}): Promise<ListResult> {
  return invokeFn('license-admin-list', params as unknown as Record<string, unknown>);
}

type UpdateAction =
  | { action: 'revoke' }
  | { action: 'suspend' }
  | { action: 'reactivate' }
  | { action: 'extend'; expires_at: string }
  | { action: 'set_seats'; seats: number }
  | { action: 'set_edition'; edition: Edition }
  | { action: 'set_features'; features: string[] }
  | { action: 'set_notes'; notes: string }
  | { action: 'unbind_seat'; seat_id: string };

export interface UpdateLicenseResult {
  license: AdminLicense;
}

export async function updateLicense(
  licenseId: string,
  change: UpdateAction,
): Promise<UpdateLicenseResult> {
  return invokeFn('license-admin-update', { license_id: licenseId, ...change });
}
