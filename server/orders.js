import { createHash, timingSafeEqual } from 'node:crypto';
import { requireSupabase } from './supabase.js';
import { advanceCheckout } from './order-checkout.js';

export const ordersEnabled = () => process.env.AUTO_ORDERS_ENABLED === 'true';

export async function readCheckout(conversationId) {
  const { data, error } = await requireSupabase().from('order_checkouts').select('state, revision').eq('conversation_id', conversationId).maybeSingle();
  if (error) throw new Error('Không đọc được bộ nhớ đặt hàng. Kiểm tra cấu hình bảng đơn hàng.');
  return data || { state: {}, revision: 0 };
}

export async function readOrderEvent(eventKey) {
  const { data, error } = await requireSupabase().from('order_events').select('result').eq('event_key', eventKey).maybeSingle();
  if (error) throw new Error('Không đọc được tiến trình đặt hàng.');
  return data?.result || null;
}

export async function commitCheckout({ eventKey, checkout, extraction, conversation, context, text, reply, intent, media_ids = [] }) {
  const next = advanceCheckout({ previous: checkout.state, extraction, conversation, context: { ...context, intent }, text });
  const result = { reply: next.reply || reply, handled: Boolean(next.reply), order_id: next.state.order_id || null,
    intent: next.reply ? 'order' : intent, media_ids: next.reply ? [] : media_ids };
  const { data, error } = await requireSupabase().rpc('commit_order_checkout', {
    p_event_key: eventKey, p_conversation_id: conversation.id, p_revision: checkout.revision,
    p_state: next.state, p_order: next.order, p_result: result,
    p_review_request: next.review_request || null
  });
  if (error) throw new Error('Chưa lưu được thông tin đặt hàng. Hệ thống sẽ thử lại, chưa xác nhận đơn cho khách.');
  return data;
}

export function authorizeOrders(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = process.env.ORDERS_ADMIN_TOKEN;
  if (!expected || expected.length < 24) {
    res.status(503).json({ error: 'Chưa cấu hình ORDERS_ADMIN_TOKEN (ít nhất 24 ký tự) trên server.' });
    return false;
  }
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer /, '');
  const digest = value => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(supplied))) {
    res.status(401).json({ error: 'Mã truy cập quản lý đơn không hợp lệ.' });
    return false;
  }
  return true;
}

export async function handleOrders(req, res) {
  if (!authorizeOrders(req, res)) return;
  const client = requireSupabase();
  if (req.method === 'GET' && req.query.action === 'orders_list') {
    const limit = 50;
    const page = Math.max(0, Math.min(100000, Number.parseInt(req.query.page, 10) || 0));
    const status = String(req.query.status || 'all');
    const statuses = ['new', 'processing', 'shipped', 'completed', 'cancelled'];
    let query = client.from('orders').select('*', { count: 'exact' });
    if (status !== 'all') {
      if (!statuses.includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
      query = query.eq('status', status);
    }
    const { data, count, error } = await query.order('created_at', { ascending: false }).order('id').range(page * limit, (page + 1) * limit - 1);
    if (error) throw new Error('Không tải được danh sách đơn hàng.');
    const { data: pending, error: pendingError } = await client.from('order_checkouts').select('conversation_id, state, updated_at')
      .contains('state', { confirmed: true }).is('state->>order_id', null).order('updated_at', { ascending: false }).limit(50);
    if (pendingError) throw new Error('Không tải được đơn đang thu thập thông tin.');
    return res.status(200).json({ orders: data || [], total: count || 0, page, limit, pending: pending || [], enabled: ordersEnabled() });
  }
  if (req.method === 'POST' && req.query.action === 'orders_status') {
    const { id, status, updated_at: updatedAt } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(id)) || !['new', 'processing', 'shipped', 'completed', 'cancelled'].includes(status) || !Number.isFinite(Date.parse(updatedAt))) {
      return res.status(400).json({ error: 'Thông tin cập nhật đơn không hợp lệ.' });
    }
    const { data, error } = await client.from('orders').update({ status, updated_at: new Date().toISOString() })
      .eq('id', id).eq('updated_at', updatedAt).select('*').maybeSingle();
    if (error) throw new Error('Không cập nhật được đơn hàng.');
    if (!data) return res.status(409).json({ error: 'Đơn đã thay đổi. Hãy làm mới trước khi cập nhật.' });
    return res.status(200).json(data);
  }
  return res.status(405).json({ error: 'Method/action không được hỗ trợ.' });
}
