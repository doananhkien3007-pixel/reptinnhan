import { getSupabase } from './supabase.js';

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchFacebookProfile(psid, { fetchImpl = fetch } = {}) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const version = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken) throw new Error('Thiếu PAGE_ACCESS_TOKEN để lấy tên khách Facebook.');
  if (!/^\d+$/.test(String(psid || ''))) throw new Error('PSID khách hàng không hợp lệ.');

  const url = new URL(`https://graph.facebook.com/${version}/${psid}`);
  url.searchParams.set('fields', 'first_name,last_name,name,profile_pic');
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${pageAccessToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    throw new Error(result.error?.message || `Facebook Profile API HTTP ${response.status}`);
  }
  const firstName = String(result.first_name || '').trim();
  const lastName = String(result.last_name || '').trim();
  const name = String(result.name || `${firstName} ${lastName}`).trim();
  return {
    facebook_name: name || null,
    facebook_first_name: firstName || null,
    facebook_last_name: lastName || null,
    facebook_profile_pic: typeof result.profile_pic === 'string' ? result.profile_pic : null,
    profile_updated_at: new Date().toISOString()
  };
}

export async function syncFacebookProfile(conversation) {
  if (!conversation?.id || !conversation.external_user_id) return conversation;
  const lastUpdated = conversation.profile_updated_at ? new Date(conversation.profile_updated_at).getTime() : 0;
  if (lastUpdated && Date.now() - lastUpdated < PROFILE_TTL_MS) return conversation;
  const supabase = getSupabase();
  if (!supabase) return conversation;
  try {
    const profile = await fetchFacebookProfile(conversation.external_user_id);
    const { error } = await supabase.from('conversations').update(profile).eq('id', conversation.id);
    return error ? conversation : { ...conversation, ...profile };
  } catch {
    // Facebook may withhold a profile or the migration may not be installed yet.
    // Profile enrichment is optional and must never block a customer reply.
    const profileUpdatedAt = new Date().toISOString();
    try {
      await supabase.from('conversations').update({ profile_updated_at: profileUpdatedAt }).eq('id', conversation.id);
    } catch {}
    return { ...conversation, profile_updated_at: profileUpdatedAt };
  }
}
