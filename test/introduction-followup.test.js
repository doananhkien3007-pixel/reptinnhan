import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntroductionFollowup } from '../server/introduction-followup.js';
import { planIntroduction, SIZE_QUESTION, TH_VAY_SIZE_QUESTION, MAX_INTRODUCTION_IMAGES, MAX_TH_VAY_INTRODUCTION_IMAGES, getPromotionMessage, getPromotionMessages, PROMOTION_MESSAGE, MANGO_PROMOTION_MESSAGES, TH_VAY_PROMOTION_MESSAGE, shouldIntroduceBeforeHandoff } from '../server/product-introduction.js';

const LEGACY_PROMOTION_MESSAGE = '🌷 Dạ mẫu này bên em đang sale còn 279K, freeship cho chị luôn nha. Mai bên em về lại giá 450K ạ 🥰\n\nVải lụa Mango Hàn Quốc mềm mịn, mặc mát và nhẹ người, lên form cũng rất đẹp chị ạ.';

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

test('các SKU Mango dùng chung hai bong bóng tư vấn đã cấu hình', () => {
  assert.equal(PROMOTION_MESSAGE, '🌷 Dạ mẫu này hôm nay bên em đang ưu đãi còn 249K + miễn phí ship chị nha.\nChất vải lụa Mango Hàn Quốc mềm mịn lắm chị, mặc thoáng mát, nhẹ người, lên dáng cũng rất đẹp ạ 🥰');
  assert.equal(SIZE_QUESTION, 'Chị cho em xin chiều cao + cân nặng, em chọn size chuẩn cho chị ạ.🥰');
  for (const sku of ['MANGO-HQ-279', 'MANGO-HQ-HONG-TIM-279', 'MANGO-HQ-HOA-7MAU-279']) {
    assert.equal(getPromotionMessage({ ...product, sku }), PROMOTION_MESSAGE);
    assert.deepEqual(getPromotionMessages({ ...product, sku }), [PROMOTION_MESSAGE]);
    assert.equal(shouldIntroduceBeforeHandoff({ ...product, sku }), true);
  }
  assert.equal(shouldIntroduceBeforeHandoff({ ...product, sku: 'VAY-THUONG' }), false);
  assert.equal(MANGO_PROMOTION_MESSAGES.length, 1);
  assert.equal(PROMOTION_MESSAGE.split('\n').length, 2);
});

test('TH váy báo giá 280K theo từng dòng rồi xin chiều cao và cân nặng', () => {
  const thVay = { ...product, id: 15, sku: 'TH-VAY-20261029', name: 'TH váy' };
  assert.equal(TH_VAY_PROMOTION_MESSAGE, '🌷 Dạ mẫu này đang ưu đãi còn 280K (giá gốc 450K).\nMiễn phí ship chị nha.\nChất vải lụa Mango Hàn Quốc mềm mịn, thoáng mát.\nChe khuyết điểm tốt và giữ phom sau khi giặt ạ 🥰');
  assert.equal(TH_VAY_SIZE_QUESTION, '⏰ Ưu đãi 40% chỉ áp dụng trong hôm nay chị nha.\nChị cho em xin chiều cao + cân nặng.\nEm chọn size vừa đẹp cho mình ạ 🥰');
  assert.equal(getPromotionMessage(thVay), TH_VAY_PROMOTION_MESSAGE);
  assert.deepEqual(getPromotionMessages(thVay), [TH_VAY_PROMOTION_MESSAGE]);
  assert.equal(shouldIntroduceBeforeHandoff(thVay), true);
  assert.deepEqual(planIntroduction(thVay, []).messages, [TH_VAY_PROMOTION_MESSAGE, TH_VAY_SIZE_QUESTION]);
  assert.deepEqual(planIntroduction(thVay, [
    '[Ảnh sản phẩm 15:image-1]', TH_VAY_PROMOTION_MESSAGE, TH_VAY_SIZE_QUESTION
  ]), { images: [], videos: [], messages: [] });
  const previousPromotion = '🌷 Dạ bên em đang có ưu đãi đồng giá chỉ 249k và 279k + miễn phí ship từ 1 đầm\n\nChất vải lụa Mango Hàn Quốc mềm mịn lắm chị, mặc thoáng mát, nhẹ người, che khuyết điểm tốt và không bị mất phom khi giặt ạ 🥰';
  assert.deepEqual(planIntroduction(thVay, [
    '[Ảnh sản phẩm 15:image-1]', previousPromotion, TH_VAY_SIZE_QUESTION
  ]).messages, []);
  const actualFiveDressProduct = { ...thVay, sku: 'P-1793464317378-2XP8U', name: '5 mẫu' };
  assert.equal(getPromotionMessage(actualFiveDressProduct), TH_VAY_PROMOTION_MESSAGE);
  assert.deepEqual(planIntroduction(actualFiveDressProduct, []).messages,
    [TH_VAY_PROMOTION_MESSAGE, TH_VAY_SIZE_QUESTION]);
});

test('TH váy lấy đủ toàn bộ 23 ảnh thay vì giới hạn bảy ảnh', () => {
  const images = Array.from({ length: 23 }, (_, index) => ({
    facebook_attachment_id: `th-vay-image-${index + 1}`,
    image_url: `https://example.com/th-vay-${index + 1}.jpg`,
    sort_order: index + 1
  }));
  const plan = planIntroduction({
    ...product,
    id: 15,
    sku: 'TH-VAY-20261029',
    name: 'TH váy',
    images
  }, []);
  assert.equal(MAX_TH_VAY_INTRODUCTION_IMAGES, 30);
  assert.equal(plan.images.length, 23);
  assert.deepEqual(plan.images.map(item => item.image.facebook_attachment_id),
    images.map(item => item.facebook_attachment_id));
});

test('nội dung Mango ngay trước lần rút gọn vẫn được nhận diện để không gửi lặp', () => {
  const mango = { ...product, sku: 'MANGO-HQ-279' };
  const previousMessages = [
    '[Ảnh sản phẩm 12:image-1]',
    '[Ảnh sản phẩm 12:image-2]',
    '[Ảnh sản phẩm 12:image-3]',
    '[Video sản phẩm 12:video-1]',
    'Chất vải bên em là vải lụa mango Hàn Quốc, chất mềm mát, mặc thoải mái, co giãn nhẹ và ko nhăn khi giặt. 🌷 Form lên dáng đẹp, không bị bí nóng ạ',
    'Mẫu này đang giảm 20% còn 279K + miễn phí ship ạ. Chị được kiểm tra và mặc thử trước khi thanh toán, vừa ý mình mới nhận nha.',
    'Dạ chị cho em xin chiều cao + cân nặng, em chọn size chuẩn cho chị ạ 🥰'
  ];
  assert.deepEqual(planIntroduction(mango, previousMessages), { images: [], videos: [], messages: [] });
});

test('gửi một video nếu có và không gửi lại video đã lưu', () => {
  const plan=planIntroduction({...product,images:[...product.images,{media_type:'video',facebook_attachment_id:'video-2',sort_order:1}]},[]);
  assert.equal(plan.videos.length,1);
  assert.equal(plan.videos[0].video.facebook_attachment_id,'video-1');
  assert.deepEqual(planIntroduction(product,[plan.videos[0].marker]).videos,[]);
});

test('album giới thiệu gửi tối đa đủ bảy ảnh theo thứ tự ưu tiên', () => {
  const images = [1, 2, 3, 4, 5, 6, 7, 8].map(id => ({
    facebook_attachment_id: `album-image-${id}`,
    sort_order: id
  }));
  images[6].is_primary = true;
  const plan = planIntroduction({ ...product, images }, []);
  assert.equal(MAX_INTRODUCTION_IMAGES, 7);
  assert.deepEqual(plan.images.map(item => item.image.facebook_attachment_id), [
    'album-image-7', 'album-image-1', 'album-image-2', 'album-image-3',
    'album-image-4', 'album-image-5', 'album-image-6'
  ]);
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

test('báo giá Mango không có tên chỉ thuộc mẫu trong dấu vết media trước đó', () => {
  const mango = { ...product, id: 13, sku: 'MANGO-HQ-HONG-TIM-279' };
  const oldScript = ['[Video sản phẩm 12:old-video]', '[Ảnh sản phẩm 12:old-image]', LEGACY_PROMOTION_MESSAGE, SIZE_QUESTION];
  const plan = planIntroduction(mango, oldScript);
  assert.equal(plan.images.length, 3);
  assert.equal(plan.videos.length, 1);
  assert.deepEqual(plan.messages, [...MANGO_PROMOTION_MESSAGES, SIZE_QUESTION]);

  const currentScript = [...oldScript, '[Ảnh sản phẩm 13:image-1]', ...MANGO_PROMOTION_MESSAGES, SIZE_QUESTION];
  assert.deepEqual(planIntroduction(mango, currentScript), { images: [], videos: [], messages: [] });
  assert.deepEqual(planIntroduction(mango, ['[Video sản phẩm 13:video-1]', LEGACY_PROMOTION_MESSAGE, SIZE_QUESTION]),
    { images: [], videos: [], messages: [] });
  // Product 12 used the same nameless copy before its current quote changed.
  assert.deepEqual(planIntroduction(product, oldScript), { images: [], videos: [], messages: [] });
});

test('media mẫu khác ngắt ngữ cảnh giá và câu hỏi của mẫu hiện tại', () => {
  const mango = { ...product, id: 13, sku: 'MANGO-HQ-HONG-TIM-279' };
  const plan = planIntroduction(mango, ['[Ảnh sản phẩm 13:image-1]', '[Ảnh sản phẩm 12:old-image]', PROMOTION_MESSAGE, SIZE_QUESTION]);
  assert.deepEqual(plan.messages, [...MANGO_PROMOTION_MESSAGES, SIZE_QUESTION]);
  assert.equal(plan.images.length, 2);
  assert.deepEqual(planIntroduction(mango, [PROMOTION_MESSAGE, SIZE_QUESTION]).messages, [...MANGO_PROMOTION_MESSAGES, SIZE_QUESTION]);
});

test('retry Mango đã gửi ưu đãi chỉ gửi bong bóng hỏi size còn thiếu', () => {
  const mango = { ...product, id: 13, sku: 'MANGO-HQ-HONG-TIM-279' };
  const plan = planIntroduction(mango, ['[Ảnh sản phẩm 13:image-1]', PROMOTION_MESSAGE]);
  assert.deepEqual(plan.messages, [SIZE_QUESTION]);
});
