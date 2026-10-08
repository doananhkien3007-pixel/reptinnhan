import { getCustomerMeasurements } from './size-advice.js';

export const PROMOTION_MESSAGE = '🌷 Dạ mẫu này bên em đang sale còn 279K, freeship cho chị luôn nha. Mai bên em về lại giá 450K ạ 🥰\n\nVải lụa Mango Hàn Quốc mềm mịn, mặc mát và nhẹ người, lên form cũng rất đẹp chị ạ.';
export const SIZE_QUESTION = 'Dạ chị cho em xin chiều cao + cân nặng, em tư vấn chuẩn size cho mình luôn ạ 🥰';

export const normalizeText = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

// Only outbound shop messages count as completed introduction steps.
export function planIntroduction(product, texts, { allowLegacy = false, history = [], receivedText = '' } = {}) {
  const images = [...new Map((product.images || [])
    .filter((item) => item.media_type !== 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 3);
  if (images.length < 3) throw new Error('Sản phẩm chính cần đủ 3 ảnh Facebook khác nhau.');
  const videos = [...new Map((product.images || [])
    .filter((item) => item.media_type === 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 1);
  if (!videos.length) throw new Error('Sản phẩm chính cần ít nhất 1 video có facebook_attachment_id.');
  const prefix = `Dạ mẫu ${product.name}: `;
  const hasProductImages = texts.some((text) => text.startsWith(`[Ảnh sản phẩm ${product.id}:`));
  const relevant = texts.filter((text) => allowLegacy || text.startsWith(prefix) ||
    (hasProductImages && [PROMOTION_MESSAGE, SIZE_QUESTION].includes(text)));
  const normalized = relevant.map(normalizeText).join('\n');
  const amounts = [...normalized.matchAll(/(\d[\d.,]*)\s*(k|nghin|ngan|d|vnd)(?=\b|\s|[.,!?]|$)/g)]
    .map((match) => ['k', 'nghin', 'ngan'].includes(match[2])
      ? Number(match[1].replace(',', '.')) * 1000 : Number(match[1].replace(/[.,]/g, '')));
  const missing = [];
  if (!amounts.includes(279000)) missing.push('giá');
  if (!/(mien phi ship|freeship|free ship)/.test(normalized)) missing.push('ưu đãi MIỄN PHÍ SHIP');
  if (!normalized.includes('lua mango han quoc')) missing.push('chất vải');
  const questions = [];
  const measurements = getCustomerMeasurements(history, receivedText);
  const questionTexts = relevant.map(normalizeText).filter((text) => /\b(xin|cho em|cho shop|bao nhieu|may)\b|\?/.test(text));
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
    videos: videos.map((video) => ({
      video,
      marker: `[Video sản phẩm ${product.id}:${String(video.facebook_attachment_id).trim()}]`,
      legacyMarkers: [`[Video sản phẩm ${String(video.facebook_attachment_id).trim()}]`],
      legacyColorPrefix: `[Video sản phẩm ${String(video.facebook_attachment_id).trim()}, màu `
    })).filter(({ marker, legacyMarkers, legacyColorPrefix }) => !texts.includes(marker) &&
      !(allowLegacy && texts.some((text) => legacyMarkers.includes(text) || text.startsWith(legacyColorPrefix)))),
    messages: [
      missing.length ? PROMOTION_MESSAGE : null,
      questions.length === 2 ? SIZE_QUESTION : questions.length ? `Dạ chị cho em xin ${questions[0]}, em tư vấn size cho mình ạ.` : null
    ].filter(Boolean)
  };
}
