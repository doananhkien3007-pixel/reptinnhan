import { requireSupabase } from './supabase.js';

// Ads may change, but the receipt belongs to this customer and this product.
export const introductionKey = (senderId, productId) => `product_intro:${senderId}:${productId}`;

export async function readIntroductionState(senderId, productId) {
  const { data, error } = await requireSupabase().from('app_settings').select('value')
    .eq('key', introductionKey(senderId, productId)).maybeSingle();
  if (error) throw new Error(`Không thể đọc trạng thái giới thiệu sản phẩm: ${error.message}`);
  return data?.value || null;
}

export async function saveIntroductionState(senderId, productId, value) {
  const { error } = await requireSupabase().from('app_settings').upsert({
    key: introductionKey(senderId, productId), value,
    updated_at: new Date().toISOString()
  });
  if (error) throw new Error(`Không thể lưu trạng thái giới thiệu sản phẩm: ${error.message}`);
}
