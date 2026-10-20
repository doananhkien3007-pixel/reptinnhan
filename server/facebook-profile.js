import { getSupabase } from './supabase.js';

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

function hasFacebookProfile(conversation) {
  return [conversation?.facebook_name, conversation?.facebook_profile_pic]
    .some((value) => typeof value === 'string' && value.trim());
}

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
  const profilePic = typeof result.profile_pic === 'string' ? result.profile_pic.trim() : '';
  if (!name && !profilePic) {
    throw new Error('Facebook không trả về tên hoặc ảnh đại diện cho PSID này.');
  }
  return {
    facebook_name: name || null,
    facebook_first_name: firstName || null,
    facebook_last_name: lastName || null,
    facebook_profile_pic: /^https:\/\//i.test(profilePic) ? profilePic : null,
    profile_updated_at: new Date().toISOString()
  };
}

export async function syncFacebookProfile(conversation, {
  fetchImpl = fetch,
  supabase = getSupabase(),
  onError = (error, currentConversation) => console.warn(
    `Không thể đồng bộ hồ sơ Facebook cho khách …${String(currentConversation.external_user_id).slice(-6)}:`,
    error.message
  )
} = {}) {
  if (!conversation?.id || !conversation.external_user_id) return conversation;
  const lastUpdated = conversation.profile_updated_at ? new Date(conversation.profile_updated_at).getTime() : 0;
  // Chỉ dùng TTL khi đã có dữ liệu thật. Một lần Graph API lỗi không được khóa
  // khách ở trạng thái "Khách · ID" trong 24 giờ.
  if (hasFacebookProfile(conversation) && lastUpdated && Date.now() - lastUpdated < PROFILE_TTL_MS) return conversation;
  if (!supabase) return conversation;
  try {
    const profile = await fetchFacebookProfile(conversation.external_user_id, { fetchImpl });
    const { error } = await supabase.from('conversations').update(profile).eq('id', conversation.id);
    if (error) throw new Error(`Không thể lưu hồ sơ Facebook: ${error.message}`);
    return { ...conversation, ...profile };
  } catch (error) {
    // Hồ sơ là dữ liệu bổ sung: lỗi không được làm webhook thất bại hay chặn bot.
    // Không ghi profile_updated_at để tin nhắn tiếp theo có thể thử lại.
    onError(error, conversation);
    return conversation;
  }
}
