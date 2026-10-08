import test from 'node:test';
import assert from 'node:assert/strict';
import { getCustomerMeasurements, getWeightSizeAdvice } from '../server/size-advice.js';

const product = { name: 'Váy cotton lạnh', size_guide: 'Size M: 50-58kg; Size L: 59-65kg' };

test('chọn size theo cân nặng có kg', () => {
  assert.equal(getWeightSizeAdvice('cao 1m60, 55kg', product).size, 'M');
});

test('chọn size khi khách nói nặng mà không ghi kg', () => {
  assert.equal(getWeightSizeAdvice('cao 1m60 nặng 55', product).size, 'M');
});

test('không đoán size ngoài bảng', () => {
  assert.equal(getWeightSizeAdvice('70kg', product).size, null);
});

test('đọc số đo viết gộp trong ảnh lỗi, không lấy số điện thoại và địa chỉ làm số đo', () => {
  assert.deepEqual(getCustomerMeasurements([], 'Cao m59 nặng 70kg sdt 0842432523 địa chỉ 1166/78 quốc lộ 1a bình tân'),
    { height: 159, weight: 70 });
  assert.deepEqual(getCustomerMeasurements([], 'sdt 0842432523 địa chỉ 159 đường 70'), { height: null, weight: null });
});

test('nhớ số đo chỉ từ khách và ưu tiên chỉnh sửa mới nhất', () => {
  const history = [
    { direction: 'inbound', text: 'cao 1m6 nang 70' },
    { direction: 'outbound', text: 'chị 55kg cao 1m55' }
  ];
  assert.deepEqual(getCustomerMeasurements(history, 'em nhầm, 65,5kg cao 1.59m'), { height: 159, weight: 65.5 });
  assert.deepEqual(getCustomerMeasurements(history, 'sdt 0842432523'), { height: 160, weight: 70 });
  assert.equal(getCustomerMeasurements([], 'không phải 70kg mà 53kg').weight, 53);
});

test('ranh giới size không hỏi lại chiều cao khách đã cung cấp', () => {
  const overlap = { ...product, size_guide: 'Size M: 50-58kg; Size L: 58-65kg' };
  const advice = getWeightSizeAdvice('58kg', overlap);
  assert.equal(advice.size, null);
  assert.doesNotMatch(advice.reply, /cho em thêm chiều cao/);
  assert.match(advice.reply, /chưa đủ để chọn một size duy nhất/);
});
