import { getCustomerMeasurements } from './size-advice.js';

export const PROMOTION_MESSAGE = '🌷 Dạ mẫu này bên em đang sale còn 279K, freeship cho chị luôn nha. Mai bên em về lại giá 450K ạ 🥰\n\nVải lụa Mango Hàn Quốc mềm mịn, mặc mát và nhẹ người, lên form cũng rất đẹp chị ạ.';
export const SIZE_QUESTION = 'Dạ chị cho em xin chiều cao + cân nặng, em tư vấn chuẩn size cho mình luôn ạ 🥰';
const MANGO_PROMOTION_SKUS = new Set(['MANGO-HQ-279', 'MANGO-HQ-HONG-TIM-279']);

export const normalizeText = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

export function getPromotionMessage(product) {
  if (MANGO_PROMOTION_SKUS.has(product.sku)) return PROMOTION_MESSAGE;
  const price = Number(product.price);
  const salePrice = Number(product.sale_price);
  const hasSale = product.sale_price != null && Number.isFinite(salePrice) && salePrice > 0 && salePrice < price;
  const money = value => `${value.toLocaleString('vi-VN')}đ`;
  const parts = [hasSale ? `giá ưu đãi ${money(salePrice)} (giá gốc ${money(price)})` : `giá ${money(price)}`];
  if (product.shipping_policy?.trim()) parts.push(product.shipping_policy.trim());
  return `Dạ mẫu ${product.name}: ${parts.join(', ')} ạ.`;
}

// Only outbound shop messages count as completed introduction steps.
export function planIntroduction(product, texts, { allowLegacy = false, history = [], receivedText = '' } = {}) {
  const prefix = `Dạ mẫu ${product.name}: `;
  const promotionMessage = getPromotionMessage(product);
  const priceParagraph = promotionMessage.split('\n\n')[0];
  const historicalQuotes = new Set([promotionMessage, priceParagraph, PROMOTION_MESSAGE, PROMOTION_MESSAGE.split('\n\n')[0]]);
  let currentProduct = false;
  let priceSent = false;
  const productQuestions = [];
  for (const text of texts) {
    // Historical quotes can be identical across products. The scoped media
    // marker identifies which product the following nameless quote belongs to.
    const mediaProductId = text.match(/^\[(?:Ảnh|Video) sản phẩm (\d+):[^\]]+\]$/)?.[1];
    if (mediaProductId) currentProduct = mediaProductId === String(product.id);
    if (text.startsWith('Dạ mẫu ')) currentProduct = text.startsWith(prefix);
    if (text.startsWith(prefix)) priceSent = true;
    // Matching copy alone is not product identity. Preview may split the price
    // into paragraphs, but must retain the preceding product attribution.
    if (currentProduct && historicalQuotes.has(text)) {
      priceSent = true;
    }
    if ((currentProduct || allowLegacy) && /can nang|chieu cao/.test(normalizeText(text)) &&
        /xin|cho em|cho shop|\?/.test(normalizeText(text))) productQuestions.push(text);
  }
  // Price followed by the measurement question completes this product's script.
  // This also covers customers introduced before optional video was restored.
  if (priceSent && productQuestions.some(text => /can nang/.test(normalizeText(text)) && /chieu cao/.test(normalizeText(text)))) {
    return { images: [], videos: [], messages: [] };
  }
  const images = [...new Map((product.images || [])
    .filter((item) => item.media_type !== 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 4);
  const videos = [...new Map((product.images || [])
    .filter((item) => item.media_type === 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 1);
  const questions = [];
  const measurements = getCustomerMeasurements(history, receivedText);
  const questionTexts = productQuestions.map(normalizeText);
  if (measurements.weight === null && !questionTexts.some((text) => /can nang|nang (bao nhieu|may)/.test(text))) questions.push('cân nặng');
  if (measurements.weight === null && measurements.height === null && !questionTexts.some((text) => /chieu cao|cao (bao nhieu|may)/.test(text))) questions.push('chiều cao');
  return {
    images: images.map((image, index) => ({
      image,
      marker: `[Ảnh sản phẩm ${product.id}:${String(image.facebook_attachment_id).trim()}]`,
      legacyMarkers: [`[Ảnh sản phẩm ${index + 1}]`, `[Ảnh sản phẩm ${String(image.facebook_attachment_id).trim()}]`],
      legacyColorPrefix: `[Ảnh sản phẩm ${String(image.facebook_attachment_id).trim()}, màu `
    })).filter(({ marker, legacyMarkers, legacyColorPrefix }) => !texts.includes(marker) &&
      !(allowLegacy && texts.some((text) => legacyMarkers.includes(text) || text.startsWith(legacyColorPrefix)))),
    videos: videos.map(video => ({
      video,
      marker: `[Video sản phẩm ${product.id}:${String(video.facebook_attachment_id).trim()}]`,
      legacyMarker: `[Video sản phẩm ${String(video.facebook_attachment_id).trim()}]`
    })).filter(({ marker, legacyMarker }) => !texts.includes(marker) && !(allowLegacy && texts.includes(legacyMarker))),
    messages: [
      priceSent ? null : promotionMessage,
      questions.length === 2 ? SIZE_QUESTION : questions.length ? `Dạ chị cho em xin ${questions[0]}, em tư vấn size cho mình ạ.` : null
    ].filter(Boolean)
  };
}
