import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabase() {
  if (client !== undefined) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    client = null;
    return client;
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}

export function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trên Vercel.');
  }
  return supabase;
}
