export const PROMOTION_MESSAGE = '🌷 Dạ mẫu này bên em đang giảm giá còn 289K + MIỄN PHÍ SHIP chị nha, ngày mai bên em về lại giá gốc 450K ạ 🥰  Vải cotton lạnh mềm mát, co giãn nhẹ, ít nhăn, mặc thoải mái không bí nóng. Form lên dáng đẹp, dễ mặc lắm chị ạ.';
export const SIZE_QUESTION = 'Chị cho em xin cân nặng và chiều cao để em chọn size chuẩn cho chị nhé ạ.';

export const normalizeText = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

// Only outbound shop messages count as completed introduction steps.
export function planIntroduction(product, texts, { allowLegacy = false } = {}) {
  const images = [...new Map((product.images || [])
    .filter((item) => item.media_type !== 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 2);
  if (images.length < 2) throw new Error('Sản phẩm chính cần ít nhất 2 ảnh Facebook khác nhau.');
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
  if (!amounts.includes(289000)) missing.push('giá');
  if (!/(mien phi ship|freeship|free ship)/.test(normalized)) missing.push('ưu đãi MIỄN PHÍ SHIP');
  if (!normalized.includes('cotton lanh')) missing.push('chất vải');
  const questions = [];
  const questionTexts = relevant.map(normalizeText).filter((text) => /\b(xin|cho em|cho shop|bao nhieu|may)\b|\?/.test(text));
  if (!questionTexts.some((text) => /can nang|nang (bao nhieu|may)/.test(text))) questions.push('cân nặng');
  if (!questionTexts.some((text) => /chieu cao|cao (bao nhieu|may)/.test(text))) questions.push('chiều cao');
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
      questions.length ? SIZE_QUESTION : null
    ].filter(Boolean)
  };
}
