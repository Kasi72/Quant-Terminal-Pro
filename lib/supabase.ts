import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Module-level singleton avoids creating a new WebSocket+HTTP pool per call.
// Keep this file browser-safe: service-role access lives in supabaseServer.ts.
let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  return (_client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ));
}
