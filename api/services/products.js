import { requireSupabase } from './supabase.js';

const DEFAULT_PRODUCT_STATUS = 'active';

export async function listProducts({ includeInactive = true } = {}) {
  const supabase = requireSupabase();
  let query = supabase.from('products').select('*').order('created_at', { ascending: false });
  if (!includeInactive) query = query.eq('status', DEFAULT_PRODUCT_STATUS);
  const { data, error } = await query;
  if (error) throw new Error(`Không thể lấy products: ${error.message}`);

  const products = data || [];
  if (!products.length) return [];

  const ids = products.map((product) => product.id);
  const [{ data: variants, error: variantsError }, { data: images, error: imagesError }] = await Promise.all([
    supabase.from('product_variants').select('*').in('product_id', ids).order('color').order('size'),
    supabase.from('product_images').select('*').in('product_id', ids).order('sort_order')
  ]);
  if (variantsError) throw new Error(`Không thể lấy product_variants: ${variantsError.message}`);
  if (imagesError) throw new Error(`Không thể lấy product_images: ${imagesError.message}`);

  return products.map((product) => ({
    ...product,
    variants: (variants || []).filter((variant) => variant.product_id === product.id),
    images: (images || []).filter((image) => image.product_id === product.id)
  }));
}

export async function getProductContext(productId) {
  const supabase = requireSupabase();
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('status', DEFAULT_PRODUCT_STATUS)
    .maybeSingle();
  if (productError) throw new Error(`Không thể lấy product: ${productError.message}`);
  if (!product) return null;

  const { data: variants, error: variantsError } = await supabase
    .from('product_variants')
    .select('color, size, stock')
    .eq('product_id', productId)
    .order('color')
    .order('size');
  if (variantsError) throw new Error(`Không thể lấy product_variants: ${variantsError.message}`);

  const colors = [...new Set((variants || []).map((variant) => variant.color).filter(Boolean))];
  return [
    'SẢN PHẨM ĐANG TƯ VẤN:',
    `Tên: ${product.name}`,
    `Giá: ${product.price}`,
    `Chất liệu: ${product.material || 'Chưa cập nhật'}`,
    `Màu: ${colors.length ? colors.join(', ') : 'Chưa cập nhật'}`,
    `Size guide: ${product.size_guide || 'Chưa cập nhật'}`
  ].join('\n');
}

export async function getOrCreateConversation(externalUserId) {
  const supabase = requireSupabase();
  const base = { channel: 'facebook', external_user_id: externalUserId, updated_at: new Date().toISOString() };
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('channel', 'facebook')
    .eq('external_user_id', externalUserId)
    .maybeSingle();
  if (findError) throw new Error(`Không thể lấy conversation: ${findError.message}`);
  if (existing) {
    await supabase.from('conversations').update({ updated_at: base.updated_at }).eq('id', existing.id);
    return existing;
  }

  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert(base)
    .select('*')
    .single();
  if (createError) throw new Error(`Không thể tạo conversation: ${createError.message}`);
  return created;
}

export async function updateConversationProduct(conversationId, productId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('conversations')
    .update({ current_product_id: productId, updated_at: new Date().toISOString() })
    .eq('id', conversationId)
    .select('*')
    .single();
  if (error) throw new Error(`Không thể cập nhật conversation: ${error.message}`);
  return data;
}

export async function findMentionedProduct(message) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('id, name')
    .eq('status', DEFAULT_PRODUCT_STATUS)
    .limit(200);
  if (error) throw new Error(`Không thể tìm product: ${error.message}`);

  const normalizedMessage = message.toLocaleLowerCase('vi-VN');
  return (data || [])
    .sort((a, b) => b.name.length - a.name.length)
    .find((product) => normalizedMessage.includes(product.name.toLocaleLowerCase('vi-VN'))) || null;
}

export async function getRecentConversationMessages(conversationId, limit = 10) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('messenger_messages')
    .select('direction, text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Không thể lấy lịch sử conversation: ${error.message}`);
  return (data || []).reverse();
}

export async function saveConversationMessage({ conversationId, senderId, direction, text }) {
  const supabase = requireSupabase();
  const { error } = await supabase.from('messenger_messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    direction,
    text
  });
  if (error) throw new Error(`Không thể lưu tin nhắn conversation: ${error.message}`);
}
