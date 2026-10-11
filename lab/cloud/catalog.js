import { createHash } from 'node:crypto';
import { fail } from './settings.js';

const ACTIVE = 'active';
const MAX_PRODUCTS = 50;
const MAX_AD_MAPPINGS = 200;

const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const money = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

function productMedia(images, usedIds) {
  const source = Array.isArray(images) ? images : [];
  const sorted = [...source].sort((a, b) =>
    Number(Boolean(b?.is_primary)) - Number(Boolean(a?.is_primary)) ||
    Number(a?.media_type === 'video') - Number(b?.media_type === 'video') ||
    Number(a?.sort_order || 0) - Number(b?.sort_order || 0)
  );
  const counts = { image: 0, video: 0 };
  const media = [];
  for (const item of sorted) {
    const id = String(item?.facebook_attachment_id || '').trim();
    const type = item?.media_type === 'video' ? 'video' : 'image';
    const limit = type === 'video' ? 1 : 4;
    if (!id || usedIds.has(id) || counts[type] >= limit) continue;
    usedIds.add(id);
    counts[type] += 1;
    media.push({ id, type });
  }
  return media;
}

export function normalizeProductCatalog(rows, mappingRows = []) {
  const usedIds = new Set();
  const products = (Array.isArray(rows) ? rows : []).map(product => ({
    id: String(product.id),
    sku: text(product.sku),
    name: text(product.name) || `Sản phẩm ${product.id}`,
    price: money(product.price),
    sale_price: money(product.sale_price),
    material: text(product.material),
    colors: Array.isArray(product.colors) ? product.colors.map(text).filter(Boolean) : [],
    size_guide: product.size_guide ?? null,
    fit: text(product.fit),
    description: text(product.description),
    media: productMedia(product.images, usedIds),
    stock: product.stock ?? null
  }));
  const productNames = new Map(products.map(product => [product.id, product.name]));
  const usedAds = new Set();
  const ads = (Array.isArray(mappingRows) ? mappingRows : []).flatMap(mapping => {
    const id = String(mapping?.ad_id || '').trim();
    const productId = String(mapping?.product_id || '').trim();
    if (!/^\d+$/.test(id) || usedAds.has(id) || !productNames.has(productId)) return [];
    usedAds.add(id);
    return [{ id, product_id: productId, name: `Ads ${id} · ${productNames.get(productId)}` }];
  });
  const fingerprint = createHash('sha256').update(JSON.stringify({ products, ads })).digest('hex').slice(0, 16);
  return {
    version: `supabase-products-${fingerprint}`,
    source: 'supabase-products',
    notice: 'Ads ID được đối chiếu với ad_product_mappings và sản phẩm đang hoạt động trong Supabase. Media chỉ chứa Facebook attachment ID; Lab không trả URL ảnh/video về trình duyệt.',
    policies: { shipping_fee: null, delivery_time: null, returns: null, stock: null },
    products,
    ads
  };
}

export async function loadProductCatalog(client) {
  if (!client?.from) fail(503, 'Chưa kết nối được Supabase để tải sản phẩm thật.');
  const [productsResult, mappingsResult] = await Promise.all([
    client.from('products').select('*').eq('status', ACTIVE).order('created_at', { ascending: false }).limit(MAX_PRODUCTS),
    client.from('ad_product_mappings').select('ad_id, product_id').order('updated_at', { ascending: false }).limit(MAX_AD_MAPPINGS)
  ]);
  if (productsResult.error) fail(503, 'Không tải được sản phẩm đang hoạt động từ Supabase.');
  if (mappingsResult.error) fail(503, 'Không tải được mapping Ads ID từ Supabase.');
  const catalog = normalizeProductCatalog(productsResult.data, mappingsResult.data);
  if (!catalog.products.length) fail(503, 'Supabase chưa có sản phẩm đang hoạt động để tư vấn trong Lab.');
  return catalog;
}
