import { normalizeText } from './product-introduction.js';

const sentences = text => String(text || '').trim().split(/(?<=[.!?…])\s+/u).filter(Boolean);
const comparable = text => normalizeText(text).replace(/[?!.,…]+$/g, '').trim();
const isQuestion = text => /\?/.test(text) || /\b(khong a|khong chi|nhe a)\s*[.!…]*$/.test(normalizeText(text));

function isGenericOffer(text) {
  const normalized = normalizeText(text);
  return isQuestion(text) && (
    /\b(?:co muon|muon|co can)\b.*\b(?:xem|gui)\b.*\b(?:anh|hinh|video)\b/.test(normalized) ||
    /\b(?:co can|co muon|can em|muon em)\b.*\b(?:tu van|ho tro|giup)\b.*\b(?:them|gi)\b/.test(normalized) ||
    /\b(?:con|co)\b.*\bcau hoi\b.*\b(?:nao|gi)\b/.test(normalized)
  );
}

// Conservative last-line guard: only remove standalone trailing questions when
// a substantive answer remains. Never rewrite size facts or remove the sole
// clarification from a reply that lacks enough information to answer.
export function trimRedundantFollowups(reply, history = []) {
  const previousQuestions = new Set(history.filter(message => message.direction === 'outbound')
    .slice(-6).flatMap(message => sentences(message.text)).filter(isQuestion).map(comparable));
  const parts = sentences(reply);
  const originalCount = parts.length;
  while (parts.length > 1) {
    const last = parts.at(-1);
    if (!isGenericOffer(last) && !(isQuestion(last) && previousQuestions.has(comparable(last)))) break;
    if (!parts.slice(0, -1).some(part => !isQuestion(part))) break;
    parts.pop();
  }
  return parts.length === originalCount ? reply.trim() : parts.join(' ');
}
