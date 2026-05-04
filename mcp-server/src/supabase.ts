/**
 * Thin wrapper around supabase-js for the MCP server.
 *
 * The service-role key is required and bypasses RLS; PROTOCOL_USER_ID is the
 * sole authorization boundary. We resolve and cache both at module load so
 * that a misconfigured environment fails the process before Claude Desktop
 * can hand the server a tool call.
 *
 * NEVER log SUPABASE_SERVICE_ROLE_KEY. The MCP stdio transport prints to
 * stderr for diagnostics; keep secrets out of those streams.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `[protocol-mcp] Missing required environment variable: ${name}. ` +
        `See README.md for the Claude Desktop config snippet.`
    );
  }
  return v.trim();
}

// Resolved once at process start. Throwing here surfaces clearly in Claude
// Desktop's MCP server log on startup rather than at first tool call.
export const SUPABASE_URL = readEnv('SUPABASE_URL');
export const SUPABASE_SERVICE_ROLE_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY');
export const PROTOCOL_USER_ID = readEnv('PROTOCOL_USER_ID');

let _client: SupabaseClient | null = null;

/**
 * Lazy service-role client. Identical pattern to web/src/lib/supabase/admin.ts
 * — single instance per process, no session persistence, no auto-refresh.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
