import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntroductionFollowup } from '../server/introduction-followup.js';
import { planIntroduction, SIZE_QUESTION, getPromotionMessage } from '../server/product-introduction.js';

const product = { id: 12, name: 'Váy hoa', price: 450000, sale_price: 279000, shipping_policy: 'Freeship', material: 'Lụa Mango Hàn Quốc', size_guide: 'Size XL: 66-75kg', images: [
  ...[1, 2, 3].map(id => ({ facebook_attachment_id: `image-${id}` })),
  { media_type: 'video', facebook_attachment_id: 'video-1' }
] };

test('số đo hoặc thông tin nhận hàng nhường nhân viên, không trả lời size', () => {
  for (const text of ['Cao m59 nặng 70kg sdt 0842432523', 'cao m59', '70kg', 'nang 53', 'sdt 0842432523']) {
    assert.deepEqual(getIntroductionFollowup(product, [], text), {intent:'human_handoff',reply:null});
  }
});

test('số đo ở lịch sử khách dừng bot kể cả xin ảnh; lời bot không phải số đo', () => {
  const history=[{direction:'inbound',text:'70kg'}];
  assert.equal(getIntroductionFollowup(product,history,'gửi ảnh').intent,'human_handoff');
  assert.equal(getIntroductionFollowup(product,[{direction:'outbound',text:'chị 70kg'}],'gửi ảnh'),null);
});

test('số trần sau câu xin số đo bàn giao, giá hoặc số điện thoại không bị đoán thành số đo', () => {
  assert.equal(getIntroductionFollowup(product,[{direction:'outbound',text:SIZE_QUESTION}],'53').intent,'human_handoff');
  assert.equal(getIntroductionFollowup(product,[{direction:'inbound',text:'53'},{direction:'outbound',text:SIZE_QUESTION}],'gửi ảnh'),null);
  assert.equal(getIntroductionFollowup(product,[],'giá 279k'),null);
});

test('giới thiệu còn thiếu chỉ hỏi số đo chưa có trong lịch sử', () => {
  assert.ok(planIntroduction(product, []).messages.includes(SIZE_QUESTION));
  const knownHeight = planIntroduction(product, [], { history: [{ direction: 'inbound', text: 'cao m59' }] });
  assert.match(knownHeight.messages.at(-1), /xin cân nặng/);
  assert.doesNotMatch(knownHeight.messages.at(-1), /chiều cao/);
  const knownWeight = planIntroduction(product, [], { history: [{ direction: 'inbound', text: '70kg' }] });
  assert.equal(knownWeight.messages.length, 1);
});

test('mẫu chỉ một ảnh, không video vẫn giới thiệu đúng giá ưu đãi và số đo', () => {
  const photoOnly = { ...product, images: [product.images[0]] };
  const plan = planIntroduction(photoOnly, []);
  assert.equal(plan.images.length, 1);
  assert.deepEqual(plan.videos, []);
  assert.match(plan.messages[0], /279\.000đ.*450\.000đ.*Freeship/);
  assert.equal(plan.messages[1], SIZE_QUESTION);
  const sent = [plan.images[0].marker, ...plan.messages];
  assert.deepEqual(planIntroduction(photoOnly, sent), { images: [], videos: [], messages: [] });
});

test('mẫu không giảm giá không dùng giá khuyến mãi hoặc freeship của mẫu khác', () => {
  const regular = { ...product, price: 399000, sale_price: null, shipping_policy: '' };
  const message = getPromotionMessage(regular);
  assert.match(message, /399\.000đ/);
  assert.doesNotMatch(message, /279|ưu đãi|Freeship|Mai/);
});

test('gửi một video nếu có và không gửi lại video đã lưu', () => {
  const plan=planIntroduction({...product,images:[...product.images,{media_type:'video',facebook_attachment_id:'video-2',sort_order:1}]},[]);
  assert.equal(plan.videos.length,1);
  assert.equal(plan.videos[0].video.facebook_attachment_id,'video-1');
  assert.deepEqual(planIntroduction(product,[plan.videos[0].marker]).videos,[]);
});

test('khách đã nhận giá và câu xin số đo không nhận lại media hay giá mới', () => {
  const sent=[getPromotionMessage(product),SIZE_QUESTION];
  assert.deepEqual(planIntroduction({...product,sale_price:259000},sent),{images:[],videos:[],messages:[]});
});

test('câu xin số đo của mẫu cũ không đánh dấu mẫu mới đã tư vấn', () => {
  const oldProduct={...product,id:11,name:'Váy cũ'};
  const sent=[getPromotionMessage(oldProduct),SIZE_QUESTION,'[Ảnh sản phẩm 12:image-1]'];
  const plan=planIntroduction(product,sent);
  assert.equal(plan.images.length,2);
  assert.deepEqual(plan.messages,[getPromotionMessage(product),SIZE_QUESTION]);
});

test('mẫu chưa có ảnh vẫn chỉ xin số đo một lần', () => {
  const noImages={...product,images:[]};
  const first=planIntroduction(noImages,[]);
  assert.deepEqual(planIntroduction(noImages,first.messages),{images:[],videos:[],messages:[]});
});
