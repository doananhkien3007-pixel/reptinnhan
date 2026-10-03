import { requireSupabase } from './supabase.js';
import { normalizeText } from './product-introduction.js';

const DEFAULT_PRODUCT_STATUS = 'active';

export async function getMainProduct() {
  const { data, error } = await requireSupabase().from('products').select('*').eq('status', DEFAULT_PRODUCT_STATUS);
  if (error) throw new Error(`Không thể đọc sản phẩm chính: ${error.message}`);
  const matches = (data || []).filter((product) => normalizeText(product.name) === 'vay hoa thiet ke');
  if (matches.length !== 1) throw new Error('Cần đúng một sản phẩm đang hoạt động tên Váy hoa thiết kế trong Supabase.');
  return matches[0];
}

export async function getAllSentTexts(senderId) {
  const texts = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await requireSupabase().from('messenger_messages').select('text')
      .eq('sender_id', senderId).eq('direction', 'outbound')
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`Không thể kiểm tra lịch sử tư vấn: ${error.message}`);
    texts.push(...(data || []).map((message) => message.text || ''));
    if (!data || data.length < pageSize) return texts;
  }
}

export async function listProducts({ includeInactive = true } = {}) {
  const supabase = requireSupabase();
  let query = supabase.from('products').select('*').order('created_at', { ascending: false });
  if (!includeInactive) query = query.eq('status', DEFAULT_PRODUCT_STATUS);
  const { data, error } = await query;
  if (error) throw new Error(`Không thể lấy products: ${error.message}`);

  const products = data || [];
  if (!products.length) return [];

  return products.map((product) => ({
    ...product,
    variants: (product.colors || []).map((color) => ({ color, size: null, stock: 0 })),
    images: product.images || []
  }));
}

export async function getOnlyActiveProduct() {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('products')
    .select('id, name, sku, images, price, material')
    .eq('status', DEFAULT_PRODUCT_STATUS)
    .limit(2);
  if (error) throw new Error(`Không thể lấy sản phẩm đang bán: ${error.message}`);
  if (!data?.length) throw new Error('Supabase chưa có sản phẩm đang hoạt động.');
  if (data.length > 1) throw new Error('Có nhiều hơn một sản phẩm đang hoạt động; không thể tự chọn mẫu để tư vấn.');
  return data[0];
}

export async function getSentConversationTexts(conversationId, texts) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('messenger_messages')
    .select('text')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .in('text', texts);
  if (error) throw new Error(`Không thể kiểm tra tin nhắn đã gửi: ${error.message}`);
  return new Set((data || []).map((message) => message.text));
}

export async function getActiveProduct(productId) {
  const supabase = requireSupabase();
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .eq('status', DEFAULT_PRODUCT_STATUS)
    .maybeSingle();
  if (productError) throw new Error(`Không thể lấy product: ${productError.message}`);
  return product;
}

export async function getProductContext(productId) {
  const product = await getActiveProduct(productId);
  if (!product) return null;

  const colors = Array.isArray(product.colors) ? product.colors : [];
  const media = Array.isArray(product.images) ? product.images : [];
  const hasSendableImages = media.some((item) => item.media_type !== 'video' && String(item.facebook_attachment_id || '').trim());
  return [
    'SẢN PHẨM ĐANG TƯ VẤN:',
    `Tên: ${product.name}`,
    `Giá: ${product.price}`,
    `Chất liệu: ${product.material || 'Chưa cập nhật'}`,
    `Màu: ${colors.length ? colors.join(', ') : 'Chưa cập nhật'}`,
    `Size guide: ${product.size_guide || 'Chưa cập nhật'}`,
    `Hình ảnh: ${hasSendableImages ? 'Có thể gửi cho khách' : 'Chưa có hình ảnh có thể gửi'}`
  ].join('\n');
}

export async function getProductImages(productId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('products').select('images').eq('id', productId).limit(1);
  if (error) throw new Error(`Không thể lấy hình ảnh sản phẩm: ${error.message}`);
  const images = data?.[0]?.images;
  return Array.isArray(images) ? images : [];
}

export async function getProductSizeGuide(productId) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('products')
    .select('name, size_guide')
    .eq('id', productId)
    .eq('status', DEFAULT_PRODUCT_STATUS)
    .maybeSingle();
  if (error) throw new Error(`Không thể lấy bảng size sản phẩm: ${error.message}`);
  return data;
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

export async function updateConversationAd(conversation, adId) {
  const supabase = requireSupabase();
  const { data: mapping, error: mappingError } = await supabase
    .from('ad_product_mappings')
    .select('product_id')
    .eq('ad_id', adId)
    .maybeSingle();
  if (mappingError) throw new Error(`Không thể tìm sản phẩm theo Ads ID: ${mappingError.message}`);
  const productId = mapping?.product_id ?? null;
  const values = {
    ad_id: adId,
    updated_at: new Date().toISOString()
  };
  // Quảng cáo chưa map không được xóa sản phẩm đã tư vấn của cùng khách hàng.
  if (productId) values.current_product_id = productId;
  const { data: saved, error: saveError } = await supabase.from('conversations')
    .update(values)
    .eq('id', conversation.id)
    .select('ad_id')
    .single();
  if (saveError) throw new Error(`Không thể lưu Ads ID: ${saveError.message}`);
  if (saved?.ad_id !== adId) throw new Error('Không thể xác nhận Ads ID đã được lưu.');

  return productId;
}

export async function findMentionedProduct(message) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
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
    .order('id', { ascending: false })
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
