import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntroductionFollowup } from '../server/introduction-followup.js';
import { planIntroduction, SIZE_QUESTION } from '../server/product-introduction.js';

const product = { id: 12, name: 'Váy hoa', size_guide: 'Size XL: 66-75kg', images: [
  ...[1, 2, 3].map(id => ({ facebook_attachment_id: `image-${id}` })),
  { media_type: 'video', facebook_attachment_id: 'video-1' }
] };

test('đủ số đo và thông tin nhận hàng thì tư vấn size, không chạy lời chào', () => {
  const result = getIntroductionFollowup(product, [], 'Cao m59 nặng 70kg sdt 0842432523 địa chỉ 1166/78 quốc lộ 1a bình tân');
  assert.match(result.reply, /70kg.*size XL/);
  assert.doesNotMatch(result.reply, /xin|279K|tạo đơn/);
});

test('chỉ hỏi cân nặng khi đã có chiều cao; cân nặng đủ thì không hỏi chiều cao', () => {
  assert.match(getIntroductionFollowup(product, [], 'cao m59').reply, /xin cân nặng/);
  assert.doesNotMatch(getIntroductionFollowup(product, [], '70kg').reply, /xin|chiều cao/);
});

test('dùng số đo ở lượt trước, không suy từ tin bot hoặc giả định khách đã chốt', () => {
  const history = [{ direction: 'inbound', text: '70kg' }, { direction: 'outbound', text: 'cao 1m60 nặng 55kg' }];
  assert.match(getIntroductionFollowup(product, history, 'chị mặc size gì').reply, /70kg.*size XL/);
  assert.equal(getIntroductionFollowup(product, history, 'cảm ơn').reply, null);
  assert.equal(getIntroductionFollowup(product, history, 'gửi ảnh mẫu cho chị'), null);
  assert.doesNotMatch(getIntroductionFollowup(product, [], 'sdt 0842432523').reply, /đơn|xin/);
  assert.equal(getIntroductionFollowup(product, [], 'chị lấy size XL'), null);
});

test('giới thiệu còn thiếu chỉ hỏi số đo chưa có trong lịch sử', () => {
  assert.ok(planIntroduction(product, []).messages.includes(SIZE_QUESTION));
  const knownHeight = planIntroduction(product, [], { history: [{ direction: 'inbound', text: 'cao m59' }] });
  assert.match(knownHeight.messages.at(-1), /xin cân nặng/);
  assert.doesNotMatch(knownHeight.messages.at(-1), /chiều cao/);
  const knownWeight = planIntroduction(product, [], { history: [{ direction: 'inbound', text: '70kg' }] });
  assert.equal(knownWeight.messages.length, 1);
});
