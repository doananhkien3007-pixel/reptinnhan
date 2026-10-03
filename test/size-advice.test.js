import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeightSizeAdvice } from '../server/size-advice.js';

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
