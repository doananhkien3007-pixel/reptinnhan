export const PROMOTION_MESSAGE = '🌷 Dạ mẫu này hôm nay bên em đang giảm còn 279K + miễn phí vận chuyển chị nha.\nChất vải lụa Mango Hàn Quốc mềm mịn lắm chị, mặc thoáng mát, nhẹ người, lên dáng cũng rất đẹp ạ 🥰';
export const MANGO_PROMOTION_MESSAGES = Object.freeze([PROMOTION_MESSAGE]);
const LEGACY_PROMOTION_MESSAGE = '🌷 Dạ mẫu này bên em đang sale còn 279K, freeship cho chị luôn nha. Mai bên em về lại giá 450K ạ 🥰\n\nVải lụa Mango Hàn Quốc mềm mịn, mặc mát và nhẹ người, lên form cũng rất đẹp chị ạ.';
const PREVIOUS_MANGO_PROMOTION_MESSAGES = Object.freeze([
  '🌷 Dạ mẫu này hôm nay bên em đang giảm còn 279K + miễn phí vận chuyển chị nha.\nChất vải là lụa Mango Hàn Quốc, mềm mịn, thoáng mát và nhẹ nhàng, mặc lên rất thoải mái chị nha 🥰',
  '🌷 Dạ mẫu này hôm nay bên em đang giảm còn 279K + miễn phí vận chuyển chị nha.\nChất vải lụa Mango Hàn Quốc, mềm mịn, mặc mát và nhẹ người ạ.',
  '🌷 Dạ mẫu này hôm nay bên em đang giảm còn 279K + miễn phí vận chuyển chị nha.\nVải lụa Mango Hàn Quốc, mềm mịn, mặc mát và nhẹ người ạ 🥰',
  '🌷 Dạ mẫu này bên em đang giảm 40% còn 279k và miễn phí vận chuyển toàn quốc 🥰 Chất vải là lụa Mango Hàn Quốc mềm mịn, mặc mát và nhẹ người, ko nhăn khi giặt máy và lên form cũng rất đẹp chị ạ.',
  'Mẫu này đang giảm 20% còn 279K + miễn phí ship ạ. Chị được kiểm tra và mặc thử trước khi thanh toán, vừa ý mình mới nhận nha.',
  'Dạ mẫu này bên em đang giảm 20% còn 279K, miễn phí ship cho chị luôn ạ 🌷 Chị được kiểm tra hàng và mặc thử trước khi thanh toán, vừa ý mình mới nhận chị nha.'
]);
export const SIZE_QUESTION = 'Chị cho em xin chiều cao + cân nặng, em chọn size chuẩn cho chị nha.';
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

export function getPromotionMessages(product) {
  return MANGO_PROMOTION_SKUS.has(product.sku) ? [...MANGO_PROMOTION_MESSAGES] : [getPromotionMessage(product)];
}

// Only outbound shop messages count as completed introduction steps.
export function planIntroduction(product, texts, { allowLegacy = false, history = [], receivedText = '' } = {}) {
  const prefix = `Dạ mẫu ${product.name}: `;
  const promotionMessages = getPromotionMessages(product);
  const sentPromotionMessages = new Set();
  const legacyPromotionQuotes = new Set([LEGACY_PROMOTION_MESSAGE, ...LEGACY_PROMOTION_MESSAGE.split('\n\n')]);
  let currentProduct = false;
  let legacyPromotionSent = false;
  const productQuestions = [];
  for (const text of texts) {
    const previousPromotionIndex = PREVIOUS_MANGO_PROMOTION_MESSAGES.indexOf(text);
    const isPreviousMangoPromotion = MANGO_PROMOTION_SKUS.has(product.sku) && previousPromotionIndex >= 0;
    // Historical quotes can be identical across products. The scoped media
    // marker identifies which product the following nameless quote belongs to.
    const mediaProductId = text.match(/^\[(?:Ảnh|Video) sản phẩm (\d+):[^\]]+\]$/)?.[1];
    if (mediaProductId) currentProduct = mediaProductId === String(product.id);
    if (text.startsWith(prefix)) {
      currentProduct = true;
      promotionMessages.forEach(message => sentPromotionMessages.add(message));
    } else if (text.startsWith('Dạ mẫu ') && !promotionMessages.includes(text) && !isPreviousMangoPromotion) currentProduct = false;
    // Nameless Mango copy belongs to the product identified by the preceding
    // media marker. Keep recognizing the former combined copy after rollout.
    if (currentProduct || allowLegacy) {
      if (promotionMessages.includes(text)) sentPromotionMessages.add(text);
      if (isPreviousMangoPromotion) {
        sentPromotionMessages.add(PROMOTION_MESSAGE);
      }
      if (legacyPromotionQuotes.has(text)) legacyPromotionSent = true;
    }
    if ((currentProduct || allowLegacy) && /can nang|chieu cao/.test(normalizeText(text)) &&
        /xin|cho em|cho shop|\?/.test(normalizeText(text))) productQuestions.push(text);
  }
  // Promotion followed by the measurement question completes this product's script.
  const promotionComplete = legacyPromotionSent || sentPromotionMessages.size === promotionMessages.length;
  if (promotionComplete && productQuestions.some(text => /can nang/.test(normalizeText(text)) && /chieu cao/.test(normalizeText(text)))) {
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
      ...(legacyPromotionSent ? [] : promotionMessages.filter(message => !sentPromotionMessages.has(message))),
      questions.length === 2 ? SIZE_QUESTION : questions.length ? `Dạ chị cho em xin ${questions[0]}, em tư vấn size cho mình ạ.` : null
    ].filter(Boolean)
  };
}
import { getCustomerMeasurements } from './size-advice.js';
