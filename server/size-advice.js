export const WEIGHT_PATTERN = /\b(\d{2,3}(?:[.,]\d+)?)\s*(?:kg|ký|kí|ky|ki)(?=$|[\s.,!?;])|(?:nặng|cân nặng|nang|can nang)\s*[:：]?\s*(\d{2,3}(?:[.,]\d+)?)(?=$|[\s.,!?;])/i;

export function getCustomerMeasurements(history = [], text = '') {
  const result = { height: null, weight: null };
  // Bot suggestions are never evidence of the customer's measurements.
  const texts = [...history.filter(item => item.direction === 'inbound').map(item => item.text), text];
  for (const value of texts) {
    const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const match of normalized.matchAll(new RegExp(WEIGHT_PATTERN.source, 'gi'))) {
      const weight = Number((match[1] || match[2]).replace(',', '.'));
      if (weight >= 20 && weight <= 350) result.weight = weight;
    }
    const heightPattern = /(?:\b(?:cao|chieu cao)\s*[:：]?\s*)?\b(?:1?m\s*(\d{1,2})|(1[.,]\d{1,2})\s*m)(?=$|[\s.,!?;])|\b(\d{3})\s*cm(?=$|[\s.,!?;])|\b(?:cao|chieu cao)\s*[:：]?\s*(\d{3})(?=$|[\s.,!?;])/g;
    for (const match of normalized.matchAll(heightPattern)) {
      const height = match[1] ? 100 + Number(match[1].padEnd(2, '0'))
        : match[2] ? Math.round(Number(match[2].replace(',', '.')) * 100) : Number(match[3] || match[4]);
      if (height >= 100 && height <= 250) result.height = height;
    }
  }
  return result;
}

export function getWeightSizeAdvice(message, product) {
  const { weight } = getCustomerMeasurements([], message);
  if (weight === null) return null;
  const label = `${weight}kg`;
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
    return { reply: `Dạ chị ${label} nằm trong cả khoảng size ${matches.map((item) => item.size).join('/')} của ${product.name} ạ. Bảng size hiện có chưa đủ để chọn một size duy nhất; shop cần kiểm tra thêm thông số của mẫu này ạ.`, size: null };
  }
  return { reply: `Dạ chị ${label} không nằm trong khoảng cân nặng của bảng size ${product.name}, nên hiện không có size phù hợp theo bảng ạ 🌷`, size: null };
}
