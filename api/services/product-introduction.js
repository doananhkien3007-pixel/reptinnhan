export const normalizeText = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();

// Only outbound shop messages count as completed introduction steps.
export function planIntroduction(product, texts, { allowLegacy = false } = {}) {
  const price = Number(product.price);
  if (!Number.isFinite(price) || price <= 0 || !String(product.material || '').trim()) {
    throw new Error('Sản phẩm chính cần có giá và chất vải trong Supabase.');
  }
  const images = [...new Map((product.images || [])
    .filter((item) => item.media_type !== 'video' && String(item.facebook_attachment_id || '').trim())
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => [String(item.facebook_attachment_id).trim(), item])).values()].slice(0, 2);
  if (images.length < 2) throw new Error('Sản phẩm chính cần ít nhất 2 ảnh Facebook khác nhau.');
  const prefix = `Dạ mẫu ${product.name}: `;
  const relevant = texts.filter((text) => allowLegacy || text.startsWith(prefix));
  const normalized = relevant.map(normalizeText).join('\n');
  const amounts = [...normalized.matchAll(/(\d[\d.,]*)\s*(k|nghin|ngan|d|vnd)(?=\b|\s|[.,!?]|$)/g)]
    .map((match) => ['k', 'nghin', 'ngan'].includes(match[2])
      ? Number(match[1].replace(',', '.')) * 1000 : Number(match[1].replace(/[.,]/g, '')));
  const missing = [];
  if (!amounts.includes(price)) missing.push(`giá ${price.toLocaleString('vi-VN')}đ`);
  if (!/(mien phi ship|freeship|free ship)/.test(normalized)) missing.push('ưu đãi MIỄN PHÍ SHIP');
  if (!normalized.includes(normalizeText(product.material))) missing.push(`chất vải ${product.material}`);
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
    messages: [
      missing.length ? `${prefix}${missing.join(', ')} chị nha.` : null,
      questions.length ? `${prefix}chị cho em xin ${questions.join(' và ')} để em tư vấn size phù hợp nhé ạ.` : null
    ].filter(Boolean)
  };
}
