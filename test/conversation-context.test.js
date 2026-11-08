import test from 'node:test';
import assert from 'node:assert/strict';
import { describeProduct } from '../server/conversation-context.js';

test('ngữ cảnh AI có nội dung tư vấn và tin nhắn rep mẫu theo sản phẩm', () => {
  const context = describeProduct({
    id: 7,
    sku: 'VAY-07',
    name: 'Váy xanh',
    price: 249000,
    material: 'Lụa mềm',
    colors: ['Xanh'],
    size_guide: 'M: 50-58kg',
    consultation_notes: 'Dáng suông che bụng, hợp đi làm và đi tiệc.',
    reply_template: 'Dạ mẫu này dáng suông nhẹ, che bụng tốt chị nhé.'
  });

  assert.match(context, /"consultation_notes":"Dáng suông che bụng, hợp đi làm và đi tiệc\."/);
  assert.match(context, /"reply_template_reference":"Dạ mẫu này dáng suông nhẹ, che bụng tốt chị nhé\."/);
});
