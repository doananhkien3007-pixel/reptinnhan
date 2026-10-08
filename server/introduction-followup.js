import { normalizeText } from './product-introduction.js';
import { getCustomerMeasurements, getWeightSizeAdvice } from './size-advice.js';

const hasContactDetails = text => /\b(sdt|so dien thoai|dia chi)\b/.test(normalizeText(text)) || /\b0[35789]\d{8}\b/.test(text);

// Information supplied by the customer takes priority over the welcome script.
// This route remains deterministic and never confirms or creates an order.
export function getIntroductionFollowup(product, history, text) {
  const current = getCustomerMeasurements([], text);
  const measurements = getCustomerMeasurements(history, text);
  const normalized = normalizeText(text);
  const contactDetails = hasContactDetails(text);
  const sizeQuestion = /\b(size|kich co)\s+(gi|nao|may|bao nhieu)\b|\b(tu van|hoi)\s+(size|kich co)\b|^(size|kich co)\??$/.test(normalized);
  if (current.weight === null && current.height === null && !contactDetails && !sizeQuestion) {
    const suppliedInformation = measurements.weight !== null || measurements.height !== null ||
      history.some(item => item.direction === 'inbound' && hasContactDetails(item.text || ''));
    const requestedMedia = /\b(anh|hinh|video|xem mau|gui mau)\b/.test(normalized);
    // A later acknowledgement must not restart the welcome sequence that was
    // skipped when the customer supplied their details. Explicit media requests
    // can still use the existing introduction and its durable media markers.
    return suppliedInformation && !requestedMedia ? { intent: 'other', reply: null } : null;
  }

  const acknowledgement = contactDetails ? 'Dạ em đã nhận thông tin chị gửi. ' : '';
  if (measurements.weight !== null) {
    const advice = getWeightSizeAdvice(`${measurements.weight}kg`, product);
    return { intent: 'size', reply: acknowledgement + advice.reply };
  }
  if (contactDetails && current.height === null && !sizeQuestion) {
    return { intent: 'other', reply: acknowledgement.trim() };
  }
  return { intent: 'size', reply: acknowledgement + 'Dạ chị cho em xin cân nặng, em đối chiếu bảng size cho mình ạ.' };
}
