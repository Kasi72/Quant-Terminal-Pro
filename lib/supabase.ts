import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Module-level singletons — avoids creating a new WebSocket+HTTP pool per call
let _client: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  return (_client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  ));
}

export function getServiceClient(): SupabaseClient {
  return (_serviceClient ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ));
}
