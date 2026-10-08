import { normalizeText } from './product-introduction.js';
import { getCustomerMeasurements } from './size-advice.js';

const hasContactDetails = text => /\b(sdt|so dien thoai|dia chi)\b/.test(normalizeText(text)) || /\b0[35789]\d{8}\b/.test(text);

// Once the customer supplies any measurement, a human advises this product.
// Read only inbound messages: the bot's question is not a customer measurement.
export function getIntroductionFollowup(product, history, text) {
  const measurements = getCustomerMeasurements(history, text);
  const customerTexts = [...history.filter(item => item.direction === 'inbound').map(item => item.text || ''), text];
  let askedMeasurements = false;
  let bareMeasurement = false;
  for (const item of [...history, { direction: 'inbound', text }]) {
    const normalized = normalizeText(item.text).replace(/[.!]$/, '');
    if (item.direction === 'outbound' && /can nang|chieu cao/.test(normalized)) askedMeasurements = true;
    if (item.direction === 'inbound' && askedMeasurements && /^\d{2,3}(?:[.,]\d+)?$/.test(normalized)) {
      const number = Number(normalized.replace(',', '.'));
      if (number >= 20 && number <= 250) bareMeasurement = true;
    }
  }
  return measurements.weight !== null || measurements.height !== null || bareMeasurement || customerTexts.some(hasContactDetails)
    ? { intent: 'human_handoff', reply: null } : null;
}
