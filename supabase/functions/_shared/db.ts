import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { config } from "./config.ts";

let admin: SupabaseClient | null = null;

/** Service-role client. Server-side only; bypasses RLS. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
