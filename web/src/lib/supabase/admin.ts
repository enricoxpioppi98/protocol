import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-only routes that need to bypass RLS
 * (e.g. reading the encrypted Garmin password row, which has no SELECT policy
 * exposed to authenticated clients).
 *
 * NEVER import this from a client component. It carries SUPABASE_SERVICE_ROLE_KEY.
 *
 * Typed as untyped (`SupabaseClient` with default generics) because we don't
 * generate Database types from the schema in v1 — would be a follow-up.
 */

let _admin: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL not set');
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
