import crypto from 'node:crypto';
import { requireSupabase } from './services/supabase.js';
import { listProducts } from './services/products.js';

function normalizeProduct(input = {}) {
  return {
    name: String(input.name || '').trim(),
    price: Number(input.price || 0),
    material: String(input.material || '').trim(),
    size_guide: String(input.size_guide || '').trim()
  };
}

function validateProduct(product) {
  if (!product.name) throw new Error('Tên sản phẩm không được để trống.');
  if (!Number.isFinite(product.price) || product.price < 0) throw new Error('Giá gốc không hợp lệ.');
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

async function uploadAttachmentToFacebook(imageUrl) {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
  const graphApiVersion = process.env.GRAPH_API_VERSION || 'v26.0';
  if (!pageAccessToken) throw new Error('Thiếu PAGE_ACCESS_TOKEN để upload attachment lên Facebook.');

  const apiUrl = `https://graph.facebook.com/${graphApiVersion}/me/message_attachments?access_token=${encodeURIComponent(pageAccessToken)}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        attachment: {
          type: 'image',
          payload: { url: imageUrl, is_reusable: true }
        }
      }
    })
  });
  const raw = await response.text();
  let result;
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }
  if (!response.ok || !result.attachment_id) {
    throw new Error(`Facebook không cấp attachment_id (${response.status}): ${raw.slice(0, 300)}`);
  }
  return result.attachment_id;
}

async function saveColors(supabase, productId, variants = []) {
  const colors = [...new Map(variants
    .map((variant) => String(variant.color || '').trim())
    .filter(Boolean)
    .map((color) => [color.toLocaleLowerCase('vi-VN'), color])).values()];
  const { error } = await supabase.from('products').update({ colors, updated_at: new Date().toISOString() }).eq('id', productId);
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
        const generatedSku = `P-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const { data, error } = await supabase.from('products').insert({ ...product, sku: generatedSku, status: 'active', colors: [], images: [] }).select('*').single();
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

      await saveColors(supabase, productId, req.body?.variants);
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
      const productId = Number(req.body?.product_id);
      const dataUrl = String(req.body?.data || '');
      if (!Number.isInteger(productId) || productId <= 0 || !dataUrl.startsWith('data:')) throw new Error('Thiếu product_id hoặc dữ liệu ảnh.');
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
      const { data: products, error: productError } = await supabase
        .from('products')
        .select('sku, images')
        .eq('id', productId)
        .limit(1);
      if (productError) throw new Error(`Không thể lấy sản phẩm để lưu ảnh: ${productError.message}`);
      const product = products?.[0];
      if (!product) throw new Error('Không tìm thấy sản phẩm để lưu ảnh.');
      const color = String(req.body?.color || '').trim();
      const isPrimary = Boolean(req.body?.is_primary);
      const facebookAttachmentId = await uploadAttachmentToFacebook(publicUrl.publicUrl);
      const images = Array.isArray(product.images) ? product.images : [];
      const nextImages = images.map((image) => isPrimary && image.color === color ? { ...image, is_primary: false } : image);
      const image = {
        id: crypto.randomUUID(), product_id: productId, product_sku: product.sku,
        color, image_url: publicUrl.publicUrl, facebook_attachment_id: facebookAttachmentId,
        is_primary: isPrimary, sort_order: Number(req.body?.sort_order || 0), created_at: new Date().toISOString()
      };
      nextImages.push(image);
      const { error } = await supabase.from('products').update({ images: nextImages, updated_at: new Date().toISOString() }).eq('id', productId);
      if (error) throw new Error(`Không thể lưu ảnh sản phẩm vào products: ${error.message}`);
      return res.status(200).json(image);
    }

    return res.status(405).json({ error: 'Method/action không được hỗ trợ.' });
  } catch (error) {
    console.error('Products API error:', error);
    return res.status(400).json({ error: error.message || 'Lỗi xử lý sản phẩm.' });
  }
}
