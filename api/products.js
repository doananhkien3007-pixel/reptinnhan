import crypto from 'node:crypto';
import { requireSupabase } from './services/supabase.js';
import { listProducts } from './services/products.js';

function normalizeProduct(input = {}) {
  return {
    sku: String(input.sku || '').trim(),
    name: String(input.name || '').trim(),
    price: Number(input.price || 0),
    sale_price: input.sale_price === '' || input.sale_price == null ? null : Number(input.sale_price),
    material: String(input.material || '').trim(),
    description: String(input.description || '').trim(),
    size_guide: String(input.size_guide || '').trim(),
    shipping_policy: String(input.shipping_policy || '').trim(),
    return_policy: String(input.return_policy || '').trim(),
    status: input.status === 'inactive' ? 'inactive' : 'active'
  };
}

function validateProduct(product) {
  if (!product.sku) throw new Error('SKU không được để trống.');
  if (!product.name) throw new Error('Tên sản phẩm không được để trống.');
  if (!Number.isFinite(product.price) || product.price < 0) throw new Error('Giá gốc không hợp lệ.');
  if (product.sale_price !== null && (!Number.isFinite(product.sale_price) || product.sale_price < 0)) {
    throw new Error('Giá sale không hợp lệ.');
  }
}

async function ensureImageBucket(supabase) {
  const { data, error } = await supabase.storage.getBucket('product-images');
  if (!data && error) {
    const { error: createError } = await supabase.storage.createBucket('product-images', { public: true });
    if (createError && !createError.message.toLowerCase().includes('already exists')) {
      throw new Error(`Không thể tạo bucket product-images: ${createError.message}`);
    }
  }
}

async function saveVariants(supabase, productId, variants = []) {
  const cleanVariants = variants
    .map((variant) => ({
      product_id: productId,
      color: String(variant.color || '').trim(),
      size: String(variant.size || '').trim(),
      stock: Math.max(0, Number.parseInt(variant.stock, 10) || 0)
    }))
    .filter((variant) => variant.color && variant.size);

  await supabase.from('product_variants').delete().eq('product_id', productId);
  if (!cleanVariants.length) return;
  const { error } = await supabase.from('product_variants').insert(cleanVariants);
  if (error) throw new Error(`Không thể lưu biến thể: ${error.message}`);
}

export default async function handler(req, res) {
  try {
    const supabase = requireSupabase();
    const action = req.query.action || 'list';

    if (req.method === 'GET' && action === 'list') {
      return res.status(200).json(await listProducts({ includeInactive: true }));
    }

    if (req.method === 'POST' && (action === 'create' || action === 'update')) {
      const product = normalizeProduct(req.body?.product);
      validateProduct(product);
      let productId = req.body?.id;

      if (action === 'create') {
        const { data, error } = await supabase.from('products').insert(product).select('*').single();
        if (error) throw new Error(`Không thể tạo sản phẩm: ${error.message}`);
        productId = data.id;
      } else {
        if (!productId) throw new Error('Thiếu id sản phẩm.');
        const { error } = await supabase
          .from('products')
          .update({ ...product, updated_at: new Date().toISOString() })
          .eq('id', productId);
        if (error) throw new Error(`Không thể cập nhật sản phẩm: ${error.message}`);
      }

      await saveVariants(supabase, productId, req.body?.variants);
      const products = await listProducts({ includeInactive: true });
      return res.status(200).json(products.find((item) => item.id === productId));
    }

    if (req.method === 'POST' && action === 'toggle') {
      const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
      const { error } = await supabase.from('products')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', req.body?.id);
      if (error) throw new Error(`Không thể đổi trạng thái: ${error.message}`);
      return res.status(200).json({ ok: true, status });
    }

    if (req.method === 'POST' && action === 'delete') {
      const { error } = await supabase.from('products').delete().eq('id', req.body?.id);
      if (error) throw new Error(`Không thể xoá sản phẩm: ${error.message}`);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && action === 'upload_image') {
      const productId = req.body?.product_id;
      const dataUrl = String(req.body?.data || '');
      if (!productId || !dataUrl.startsWith('data:')) throw new Error('Thiếu product_id hoặc dữ liệu ảnh.');
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('Định dạng ảnh không hợp lệ.');

      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new Error('Ảnh vượt quá 8MB.');
      await ensureImageBucket(supabase);

      const originalName = String(req.body?.filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `${productId}/${crypto.randomUUID()}-${originalName}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(path, buffer, {
        contentType,
        upsert: false
      });
      if (uploadError) throw new Error(`Không thể upload ảnh: ${uploadError.message}`);

      const { data: publicUrl } = supabase.storage.from('product-images').getPublicUrl(path);
      const { data, error } = await supabase.from('product_images').insert({
        product_id: productId,
        color: String(req.body?.color || '').trim(),
        image_url: publicUrl.publicUrl,
        is_primary: Boolean(req.body?.is_primary),
        sort_order: Number(req.body?.sort_order || 0)
      }).select('*').single();
      if (error) throw new Error(`Không thể lưu ảnh sản phẩm: ${error.message}`);
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method/action không được hỗ trợ.' });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(400).json({ error: error.message || 'Lỗi xử lý sản phẩm.' });
  }
}
