import { normalizeText } from './product-introduction.js';
import { getCustomerMeasurements } from './size-advice.js';
import { requireSupabase } from './supabase.js';

export const REMARKETING_MESSAGE = 'Chị ưng mẫu nào không ạ ?\nChị gửi em chiều cao + cân nặng, em chọn size vừa đẹp cho mình nha 🥰';
const OUTBOUND_METADATA_PREFIX = 'leafchat:';

export const remarketingAvailable = () => process.env.MESSENGER_REMARKETING_AVAILABLE === 'true';

export function eventTimestamp(event) {
  const value = Number(event?.timestamp);
  const parsed = Number.isFinite(value) && value > 0 ? new Date(value) : new Date();
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
}

export function customerDeclined(text) {
  const value = ` ${normalizeText(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return [
    ' khong mua ', ' khong quan tam ', ' khong can ', ' thoi nha ',
    ' thoi em ', ' dung nhan ', ' dung nhan tin ', ' huy nha '
  ].some(phrase => value.includes(phrase));
}

export function customerHasMeasurements(history, text) {
  const measurements = getCustomerMeasurements(history || [], text || '');
  return measurements.height !== null || measurements.weight !== null;
}

export async function cancelRemarketing({ pageId, customerPsid, reason, hasMeasurements = false }) {
  if (!remarketingAvailable() || !pageId || !customerPsid) return 0;
  const { data, error } = await requireSupabase().rpc('remarketing_cancel_customer', {
    p_page_id: pageId,
    p_customer_psid: customerPsid,
    p_reason: reason,
    p_has_measurements: hasMeasurements
  });
  if (error) throw new Error(`Không thể huỷ lịch remarketing: ${error.message}`);
  return Number(data || 0);
}

export async function scheduleRemarketing({
  pageId, conversationId, customerPsid, productId, introVersion,
  sourceAdId = null, lastCustomerInteractionAt, introCompletedAt = new Date().toISOString(),
  hasMeasurements = false
}) {
  if (!remarketingAvailable()) return { started: false, reason: 'feature_unavailable' };
  const { data, error } = await requireSupabase().rpc('remarketing_start_cycle', {
    p_page_id: pageId,
    p_conversation_id: conversationId,
    p_customer_psid: customerPsid,
    p_product_id: productId,
    p_intro_version: String(introVersion),
    p_last_customer_interaction_at: lastCustomerInteractionAt,
    p_intro_completed_at: introCompletedAt,
    p_has_measurements: hasMeasurements,
    p_source_ad_id: sourceAdId
  });
  if (error) throw new Error(`Không thể tạo lịch remarketing: ${error.message}`);
  return data;
}

export async function prepareBotOutbound({ customerPsid, source, cycleId = null }) {
  if (!remarketingAvailable()) return null;
  const { data, error } = await requireSupabase().from('messenger_bot_outbound').insert({
    customer_psid: customerPsid,
    source,
    cycle_id: cycleId
  }).select('token').single();
  if (error) throw new Error(`Không thể đăng ký tin bot: ${error.message}`);
  return { token: data.token, metadata: `${OUTBOUND_METADATA_PREFIX}${data.token}` };
}

export async function finishBotOutbound(registration, { status, messageId = null }) {
  if (!registration) return;
  const { error } = await requireSupabase().from('messenger_bot_outbound').update({
    status,
    message_id: messageId,
    updated_at: new Date().toISOString()
  }).eq('token', registration.token);
  if (error) throw new Error(`Không thể cập nhật dấu vết tin bot: ${error.message}`);
}

export async function classifyEcho(customerPsid, message) {
  if (!remarketingAvailable()) return { ownBot: false, reason: 'feature_unavailable' };
  const metadata = String(message?.metadata || '');
  if (!metadata.startsWith(OUTBOUND_METADATA_PREFIX)) {
    return { ownBot: false, reason: 'external_outbound' };
  }
  const token = metadata.slice(OUTBOUND_METADATA_PREFIX.length);
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ownBot: false, reason: 'invalid_bot_marker' };
  const { data, error } = await requireSupabase().from('messenger_bot_outbound')
    .select('token, source, message_id').eq('token', token).eq('customer_psid', customerPsid).maybeSingle();
  if (error) throw new Error(`Không thể kiểm tra echo Messenger: ${error.message}`);
  if (!data) return { ownBot: false, reason: 'unknown_bot_marker' };
  const patch = { status: 'echoed', updated_at: new Date().toISOString() };
  if (!data.message_id && message?.mid) patch.message_id = message.mid;
  const { error: updateError } = await requireSupabase().from('messenger_bot_outbound')
    .update(patch).eq('token', token);
  if (updateError) throw new Error(`Không thể xác nhận echo Messenger: ${updateError.message}`);
  return { ownBot: true, source: data.source };
}

export async function readRemarketingStatus() {
  if (!remarketingAvailable()) return { available: false, enabled: false, dry_run: true };
  const { data, error } = await requireSupabase().rpc('remarketing_status');
  if (error) throw new Error(`Không thể đọc trạng thái remarketing: ${error.message}`);
  return { available: true, ...data };
}

export async function updateRemarketingConfig({ enabled, dryRun, maxSteps }) {
  if (!remarketingAvailable()) throw new Error('Bản triển khai hiện tại chưa bật mô-đun remarketing.');
  const { data, error } = await requireSupabase().rpc('remarketing_update_config', {
    p_enabled: Boolean(enabled),
    p_dry_run: Boolean(dryRun),
    p_max_steps: Number(maxSteps) === 2 ? 2 : 1
  });
  if (error) throw new Error(`Không thể cập nhật remarketing: ${error.message}`);
  return { available: true, ...data };
}
