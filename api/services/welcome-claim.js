import { requireSupabase } from './supabase.js';

const LEASE_MS = 5 * 60 * 1000;

export async function acquireWelcomeClaim(recipientId) {
  const supabase = requireSupabase();
  const key = `bot_welcome:${recipientId}`;
  const updatedAt = new Date().toISOString();
  const value = { status: 'sending', lease_until: new Date(Date.now() + LEASE_MS).toISOString() };
  const { error } = await supabase.from('app_settings').insert({ key, value, updated_at: updatedAt });
  if (!error) return { key, updatedAt };
  if (error.code !== '23505') throw new Error(`Không thể khoá lời chào: ${error.message}`);

  const { data: existing, error: readError } = await supabase.from('app_settings')
    .select('value, updated_at')
    .eq('key', key)
    .maybeSingle();
  if (readError) throw new Error(`Không thể đọc khoá lời chào: ${readError.message}`);
  if (!existing || existing.value?.status === 'complete' || Date.parse(existing.value?.lease_until) > Date.now()) {
    return null;
  }

  const retryAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from('app_settings')
    .update({ value, updated_at: retryAt })
    .eq('key', key)
    .eq('updated_at', existing.updated_at)
    .select('key')
    .maybeSingle();
  if (claimError) throw new Error(`Không thể lấy lại khoá lời chào: ${claimError.message}`);
  return claimed ? { key, updatedAt: retryAt } : null;
}

export async function completeWelcomeClaim(claim) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('app_settings')
    .update({ value: { status: 'complete' }, updated_at: new Date().toISOString() })
    .eq('key', claim.key)
    .eq('updated_at', claim.updatedAt)
    .select('key')
    .maybeSingle();
  if (error || !data) throw new Error(`Không thể hoàn tất lời chào: ${error?.message || 'Khoá đã thay đổi'}`);
}

export async function releaseWelcomeClaim(claim) {
  const supabase = requireSupabase();
  const { error } = await supabase.from('app_settings')
    .delete()
    .eq('key', claim.key)
    .eq('updated_at', claim.updatedAt);
  if (error) throw new Error(`Không thể giải phóng khoá lời chào: ${error.message}`);
}
