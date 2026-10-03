import test from 'node:test';
import assert from 'node:assert/strict';
import { trimRedundantFollowups } from '../server/reply-policy.js';

test('bỏ câu mời xem hình sau khi đã trả lời size như ảnh phản ánh', () => {
  assert.equal(trimRedundantFollowups('Dạ theo bảng size chị 60kg phù hợp size L ạ. Chị có muốn xem hình váy hoa thiết kế không ạ?'),
    'Dạ theo bảng size chị 60kg phù hợp size L ạ.');
});

test('không thêm lời mời hỗ trợ chung chung sau đáp án cụ thể', () => {
  assert.equal(trimRedundantFollowups('Giá mẫu này là 289.000đ ạ. Chị cần em tư vấn gì thêm không?'), 'Giá mẫu này là 289.000đ ạ.');
});

test('loại câu hỏi cuối đã hỏi trước đó, giữ phần giải đáp ý mới', () => {
  const question = 'Chị cho em xin số điện thoại nhận hàng nhé?';
  assert.equal(trimRedundantFollowups('Dạ mẫu này dùng cotton lạnh ạ. ' + question, [{ direction: 'outbound', text: question }]),
    'Dạ mẫu này dùng cotton lạnh ạ.');
});

test('giữ câu hỏi bổ sung cần thiết và câu hỏi duy nhất', () => {
  const text = 'Dạ em đã ghi nhận màu đen. Chị cho em xin số điện thoại nhận hàng nhé?';
  assert.equal(trimRedundantFollowups(text), text);
  assert.equal(trimRedundantFollowups('Chị đang hỏi mẫu nào ạ?'), 'Chị đang hỏi mẫu nào ạ?');
});

test('giữ giá tiền, xuống dòng và nội dung xem ảnh có ý nghĩa', () => {
  const text = 'Dạ mẫu này giá 289.000đ.\nEm gửi chị ảnh chi tiết bên dưới ạ.';
  assert.equal(trimRedundantFollowups(text), text);
});
