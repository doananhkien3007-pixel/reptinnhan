import { requireSupabase } from '../server/supabase.js';
import { fetchFacebookAds, suggestProductForAd } from '../server/facebook-ads.js';

function productSummary(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const cover = images.find((image) => image.is_primary && image.image_url)
    || images.find((image) => image.image_url);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    price: product.price,
    status: product.status,
    image_url: cover?.image_url || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET');
    return res.status(405).json({ error: 'Chỉ hỗ trợ phương thức GET.' });
  }

  try {
    const supabase = requireSupabase();
    // Marketing API uses its own credential. Never fall back to the Page token
    // because the Messenger token normally does not have ads_read permission.
    const accessToken = process.env.FB_MARKETING_ACCESS_TOKEN;
    const accountId = process.env.FB_AD_ACCOUNT_ID;
    const version = process.env.GRAPH_API_VERSION || 'v26.0';
    const [facebook, productResult, mappingResult] = await Promise.all([
      fetchFacebookAds({ accountId, accessToken, version }),
      supabase.from('products').select('id, sku, name, price, status, images').order('created_at', { ascending: false }),
      supabase.from('ad_product_mappings').select('ad_id, product_id, updated_at')
    ]);

    if (productResult.error) throw new Error(`Không thể lấy sản phẩm: ${productResult.error.message}`);
    if (mappingResult.error) throw new Error(`Không thể lấy mapping quảng cáo: ${mappingResult.error.message}`);

    const products = (productResult.data || []).map(productSummary);
    const productById = new Map(products.map((product) => [Number(product.id), product]));
    const mappingByAdId = new Map((mappingResult.data || []).map((mapping) => [String(mapping.ad_id), mapping]));
    const ads = facebook.ads.map((ad) => {
      const mapping = mappingByAdId.get(ad.id);
      const product = mapping ? productById.get(Number(mapping.product_id)) || null : null;
      const suggestion = product ? null : suggestProductForAd(ad, products);
      return {
        ...ad,
        product,
        mapped_at: mapping?.updated_at || null,
        suggested_product_id: suggestion?.product_id || null,
        suggestion_reason: suggestion?.reason || null
      };
    });

    res.setHeader?.('Cache-Control', 'private, no-store');
    return res.status(200).json({
      account_id: facebook.account_id,
      synced_at: new Date().toISOString(),
      total: ads.length,
      mapped_count: ads.filter((ad) => ad.product).length,
      ads,
      products
    });
  } catch (error) {
    console.error('Facebook Ads API error:', error);
    return res.status(400).json({ error: error.message || 'Không thể đồng bộ Facebook Ads.' });
  }
}
