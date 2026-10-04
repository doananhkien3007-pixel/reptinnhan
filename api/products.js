import crypto from 'node:crypto';
import { requireSupabase } from '../server/supabase.js';
import { listProducts } from '../server/products.js';
import { handleOrders } from '../server/orders.js';

// Facebook may need time to fetch and register a large video from Storage.
export const maxDuration = 60;

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

async function readVideoBytes(req) {
  if (String(req.headers?.['content-type'] || '').split(';')[0] !== 'application/octet-stream') {
    throw new Error('Upload video phải gửi dữ liệu file trực tiếp.');
  }
  let buffer;
  if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (req.body === undefined && req[Symbol.asyncIterator]) {
    const chunks = [];
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
    }
    buffer = Buffer.concat(chunks);
  } else {
    throw new Error('Dữ liệu video không hợp lệ.');
  }
  if (!buffer.length) throw new Error('Video không được để trống.');
  // ISO BMFF files identify their container in the opening ftyp box.
  if (buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Hãy chọn file video MP4 hợp lệ.');
  return buffer;
}

async function uploadVideoToFacebook(buffer) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('Thiếu PAGE_ACCESS_TOKEN để upload video lên Facebook.');
  const version = process.env.GRAPH_API_VERSION || 'v26.0';
  const form = new FormData();
  form.append('message', JSON.stringify({ attachment: { type: 'video', payload: { is_reusable: true } } }));
  form.append('filedata', new Blob([buffer], { type: 'video/mp4' }), 'video.mp4');
  const response = await fetch(`https://graph.facebook.com/${version}/me/message_attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.attachment_id) {
    throw new Error(`Facebook không cấp attachment_id cho video (${response.status}): ${result.error?.message || 'Phản hồi không hợp lệ'}`);
  }
  return String(result.attachment_id);
}

async function uploadAttachmentToFacebook(mediaUrl, type = 'image') {
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
          type,
          payload: { url: mediaUrl, is_reusable: true }
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
    if (String(req.query.action || '').startsWith('orders_')) return await handleOrders(req, res);
    const supabase = requireSupabase();
    const action = req.query.action || 'list';

    if (req.method === 'GET' && action === 'list') {
      return res.status(200).json(await listProducts({ includeInactive: true }));
    }

    if (req.method === 'GET' && action === 'ad_mappings') {
      const { data, error } = await supabase.from('ad_product_mappings')
        .select('ad_id, product_id, created_at, updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(`Không thể tải mapping quảng cáo: ${error.message}`);
      return res.status(200).json(data || []);
    }

    if (req.method === 'POST' && action === 'save_ad_mapping') {
      const adId = String(req.body?.ad_id || '').trim();
      const productId = Number(req.body?.product_id);
      if (!/^\d+$/.test(adId)) throw new Error('Ads ID chỉ được chứa chữ số.');
      if (!Number.isInteger(productId) || productId <= 0) throw new Error('Hãy chọn sản phẩm hợp lệ.');
      const { data: products, error: productError } = await supabase.from('products')
        .select('id').eq('id', productId).limit(1);
      if (productError) throw new Error(`Không thể kiểm tra sản phẩm: ${productError.message}`);
      if (!products?.[0]) throw new Error('Không tìm thấy sản phẩm để mapping.');
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('ad_product_mappings').upsert({
        ad_id: adId, product_id: productId, updated_at: now
      }, { onConflict: 'ad_id' }).select('ad_id, product_id, created_at, updated_at').single();
      if (error) throw new Error(`Không thể lưu mapping quảng cáo: ${error.message}`);
      return res.status(200).json(data);
    }

    if (req.method === 'POST' && action === 'delete_ad_mapping') {
      const adId = String(req.body?.ad_id || '').trim();
      if (!adId) throw new Error('Thiếu Ads ID cần xoá.');
      const { error } = await supabase.from('ad_product_mappings').delete().eq('ad_id', adId);
      if (error) throw new Error(`Không thể xoá mapping quảng cáo: ${error.message}`);
      return res.status(200).json({ ok: true });
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

    if (req.method === 'POST' && action === 'prepare_video_upload') {
      const productId = Number(req.body?.product_id);
      const filename = String(req.body?.filename || 'video.mp4');
      if (!Number.isInteger(productId) || productId <= 0) throw new Error('Thiếu product_id hợp lệ.');
      if (!/\.mp4$/i.test(filename)) throw new Error('Chỉ hỗ trợ video MP4.');
      const { data: products, error: productError } = await supabase.from('products')
        .select('id').eq('id', productId).limit(1);
      if (productError) throw new Error(`Không thể kiểm tra sản phẩm: ${productError.message}`);
      if (!products?.[0]) throw new Error('Không tìm thấy sản phẩm để lưu video.');
      await ensureImageBucket(supabase);
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `${productId}/videos/${crypto.randomUUID()}-${safeName}`;
      const { data, error } = await supabase.storage.from('product-images').createSignedUploadUrl(path);
      if (error || !data?.signedUrl) throw new Error(`Không thể tạo đường dẫn upload video: ${error?.message || 'Phản hồi không hợp lệ'}`);
      return res.status(200).json({ path, signed_url: data.signedUrl });
    }

    if (req.method === 'POST' && action === 'finalize_video_upload') {
      const productId = Number(req.body?.product_id);
      const path = String(req.body?.path || '');
      if (!Number.isInteger(productId) || productId <= 0 || !path.startsWith(`${productId}/videos/`) || !/\.mp4$/i.test(path)) {
        throw new Error('Đường dẫn video không hợp lệ.');
      }
      const { data: products, error: productError } = await supabase.from('products')
        .select('images').eq('id', productId).limit(1);
      if (productError) throw new Error(`Không thể lấy sản phẩm: ${productError.message}`);
      const product = products?.[0];
      if (!product) throw new Error('Không tìm thấy sản phẩm để lưu video.');
      const images = Array.isArray(product.images) ? product.images : [];
      const existing = images.find((item) => item.media_type === 'video' && item.storage_path === path && item.facebook_attachment_id);
      if (existing) return res.status(200).json(existing);
      const { data: publicUrl } = supabase.storage.from('product-images').getPublicUrl(path);
      if (!publicUrl?.publicUrl) throw new Error('Không thể tạo URL công khai cho video.');
      const facebookAttachmentId = await uploadAttachmentToFacebook(publicUrl.publicUrl, 'video');
      const video = {
        id: `video-${crypto.createHash('sha256').update(path).digest('hex')}`,
        media_type: 'video', video_url: publicUrl.publicUrl, storage_path: path,
        facebook_attachment_id: String(facebookAttachmentId),
        color: String(req.body?.color || '').trim(), sort_order: Number(req.body?.sort_order || 0)
      };
      const { error } = await supabase.from('products').update({
        images: [...images, video], updated_at: new Date().toISOString()
      }).eq('id', productId);
      if (error) throw new Error(`Không thể lưu attachment_id video: ${error.message}`);
      return res.status(200).json(video);
    }

    if (req.method === 'POST' && action === 'upload_video') {
      const productId = Number(req.query.product_id);
      if (!Number.isInteger(productId) || productId <= 0) throw new Error('Thiếu product_id hợp lệ.');
      const buffer = await readVideoBytes(req);
      const { data: products, error: productError } = await supabase.from('products')
        .select('images').eq('id', productId).limit(1);
      if (productError) throw new Error(`Không thể lấy sản phẩm: ${productError.message}`);
      const product = products?.[0];
      if (!product) throw new Error('Không tìm thấy sản phẩm để lưu video.');
      const images = Array.isArray(product.images) ? product.images : [];
      // Stable ID makes retrying the same file safe after a lost HTTP response.
      const id = `video-${crypto.createHash('sha256').update(buffer).digest('hex')}`;
      const existing = images.find((item) => item.media_type === 'video' && item.id === id && item.facebook_attachment_id);
      if (existing) return res.status(200).json(existing);
      const facebookAttachmentId = await uploadVideoToFacebook(buffer);
      // The file exists only in memory while forwarding it to Facebook.
      const video = {
        id, media_type: 'video', facebook_attachment_id: facebookAttachmentId,
        color: String(req.query.color || '').trim(), sort_order: Number(req.query.sort_order || 0)
      };
      const { error } = await supabase.from('products').update({
        images: [...images, video], updated_at: new Date().toISOString()
      }).eq('id', productId);
      if (error) throw new Error(`Không thể lưu attachment_id video: ${error.message}`);
      return res.status(200).json(video);
    }

    if (req.method === 'POST' && action === 'upload_image') {
      const productId = Number(req.body?.product_id);
      const dataUrl = String(req.body?.data || '');
      if (!Number.isInteger(productId) || productId <= 0 || !dataUrl.startsWith('data:')) throw new Error('Thiếu product_id hoặc dữ liệu ảnh.');
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) throw new Error('Định dạng ảnh không hợp lệ.');

      const contentType = match[1];
      if (!contentType.startsWith('image/')) throw new Error('Chức năng này chỉ nhận ảnh; hãy dùng upload video cho MP4.');
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
