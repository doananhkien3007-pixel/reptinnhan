export const WEIGHT_PATTERN = /\b(\d{2,3}(?:[.,]\d+)?)\s*(?:kg|ký|kí)(?=$|[\s.,!?])/i;

export function getWeightSizeAdvice(message, product) {
  const weightMatch = String(message).match(WEIGHT_PATTERN);
  if (!weightMatch) return null;

  const weight = Number(weightMatch[1].replace(',', '.'));
  const label = `${weightMatch[1]}kg`;
  if (!product) {
    return { reply: 'Dạ chị đang quan tâm mẫu nào ạ? Chị gửi hình hoặc tên mẫu giúp em để em xem bảng size chính xác nhé 🌷', size: null };
  }
  const ranges = [...String(product.size_guide || '').matchAll(/size\s+([a-z0-9]+)\s*[:：]?\s*(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*kg/gi)]
    .map((match) => ({ size: match[1].toUpperCase(), min: Number(match[2].replace(',', '.')), max: Number(match[3].replace(',', '.')) }))
    .filter((range) => range.min <= range.max);
  if (!ranges.length) {
    return { reply: `Dạ em chưa có bảng size rõ ràng của ${product.name} nên chưa thể xác định size cho chị ${label} ạ 🌷`, size: null };
  }

  const matches = ranges.filter((range) => weight >= range.min && weight <= range.max);
  if (matches.length === 1) {
    return { reply: `Dạ chị ${label} theo bảng size của ${product.name} thì phù hợp size ${matches[0].size} ạ 🌷`, size: matches[0].size };
  }
  if (matches.length > 1) {
    return { reply: `Dạ chị ${label} đang ở ranh giới size ${matches.map((item) => item.size).join('/')} của ${product.name} ạ. Chị cho em thêm chiều cao hoặc số đo để tư vấn chính xác hơn nhé 🌷`, size: null };
  }
  return { reply: `Dạ chị ${label} không nằm trong khoảng cân nặng của bảng size ${product.name}, nên hiện không có size phù hợp theo bảng ạ 🌷`, size: null };
}
