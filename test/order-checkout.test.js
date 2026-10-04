import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCheckout, hasExplicitPurchaseIntent, normalizePhone, validateCheckout } from '../server/order-checkout.js';

const empty = () => ({ action:'none',action_source:null, address_complete:false,multiple_items:false,
  ...Object.fromEntries(['customer_name','phone','address','size','color','quantity'].map(k=>[k,{value:null,source:null}])) });
const field = value => ({value,source:value});
const conversation = {id:'conversation',external_user_id:'123',facebook_name:'Nguyễn Mai'};
const context = {product:{id:7,name:'Váy hoa',sku:'VH',price:289000},history:[]};
const run = (extraction,text,previous={},extra={}) => advanceCheckout({extraction,text,previous,conversation,context,newId:()=> '12345678-1234-4234-8234-123456789012',...extra});

test('chỉ hỏi phần thiếu, nhớ qua nhiều lượt, dùng tên Facebook và tạo đúng một đơn',()=>{
  let result=run({...empty(),action:'confirm',action_source:'chốt',size:field('M')},'chốt size M');
  assert.equal(result.state.customer_name,'Nguyễn Mai');assert.equal(result.order,null);assert.match(result.reply,/số điện thoại/);
  result=run({...empty(),phone:field('0901234567')},'0901234567',result.state);
  assert.equal(result.order,null);assert.match(result.reply,/địa chỉ/);assert.doesNotMatch(result.reply,/số điện thoại/);
  const address='12 Nguyễn Trãi, phường Bến Thành, TP Hồ Chí Minh';
  result=run({...empty(),address:field(address),address_complete:true},address,result.state);
  assert.equal(result.order.name_source,'facebook');assert.equal(result.order.phone,'0901234567');assert.equal(result.order.size,'M');
  const repeat=run({...empty(),action:'confirm',action_source:'chốt'},'chốt nhé',result.state);
  assert.equal(repeat.order,null);assert.match(repeat.reply,/không tạo thêm/);
});
test('khách chỉ hỏi giá/size hoặc chốt có phủ định không tạo đơn',()=>{
  for(const text of ['chưa chốt nhé','không mua nữa','nếu chốt thì sao']) {
    const result=run({...empty(),action:'confirm',action_source:'chốt'},text);
    assert.ok(!result.state.confirmed);assert.equal(result.order,null);
  }
  assert.equal(run(empty(),'mẫu này bao nhiêu tiền').order,null);
});
test('không lấy size từ câu bot tư vấn hoặc số đo khách',()=>{
  const result=run({...empty(),action:'confirm',action_source:'chốt',size:{value:'M',source:'em tư vấn size M'}},'chốt nhé',{},
    {context:{...context,history:[{direction:'outbound',text:'em tư vấn size M'}]}});
  assert.equal(result.state.size,undefined);
  assert.equal(run({...empty(),size:field('M')},'em 53kg').state.size,undefined);
});
test('không có Facebook name thì hỏi tên, có tên khách thì ưu tiên tên khách',()=>{
  const first=run({...empty(),action:'confirm',action_source:'lấy'},'lấy nhé',{}, {conversation:{...conversation,facebook_name:null}});
  assert.match(first.reply,/tên người nhận/);
  const result=run({...empty(),customer_name:field('Lan')},'gửi cho Lan',first.state);
  assert.equal(result.state.customer_name,'Lan');assert.equal(result.state.name_source,'customer');
});
test('địa chỉ thiếu được bổ sung, không tự đoán địa phương',()=>{
  const prev={confirmed:true,checkout_id:'id',customer_name:'Mai',phone:'0901234567',size:'M'};
  const first=run({...empty(),address:field('12 Nguyễn Trãi')},'12 Nguyễn Trãi',prev);
  assert.equal(first.order,null);assert.match(first.reply,/địa chỉ/);
  const part='phường Bến Thành, TP Hồ Chí Minh';
  const second=run({...empty(),address:field(part),address_complete:true},part,first.state);
  assert.equal(second.order.address,'12 Nguyễn Trãi, '+part);
});
test('SĐT chuẩn hóa, số sai phải hỏi lại; không dùng thông tin bịa',()=>{
  assert.equal(normalizePhone('+84 901 234 567'),'0901234567');
  assert.equal(normalizePhone('1234567'),null);
  const result=run({...empty(),action:'confirm',action_source:'chốt',phone:field('1234567')},'chốt 1234567');
  assert.match(result.reply,/số điện thoại/);
  assert.equal(run({...empty(),phone:field('0901234567')},'xin chào').state.phone,undefined);
});
test('thông tin cũ không ghi đè phần khách đã sửa',()=>{
  const previous={phone:'0911234567',customer_name:'Lan'};
  const result=run({...empty(),phone:field('0901234567'),customer_name:field('Mai')},'cảm ơn',previous,
    {context:{...context,history:[{direction:'inbound',text:'Mai 0901234567'}]}});
  assert.equal(result.state.phone,'0911234567');assert.equal(result.state.customer_name,'Lan');
});
test('nhiều mẫu không tự bỏ món, hủy trước tạo dừng thu thập',()=>{
  const result=run({...empty(),action:'confirm',action_source:'lấy',multiple_items:true},'lấy hai mẫu');
  assert.equal(result.state.needs_review,true);assert.equal(result.order,null);
  const cancel=run({...empty(),action:'cancel',action_source:'hủy'},'hủy nhé',result.state);
  assert.equal(cancel.state.cancelled,true);assert.ok(!cancel.state.confirmed);
});
test('đơn mới rõ ràng không dùng lại thông tin nhận hàng của đơn cũ',()=>{
  const result=run({...empty(),action:'new_order',action_source:'thêm một đơn riêng'},'mua thêm một đơn riêng',
    {order_id:'old',order_code:'DH-OLD',phone:'0901234567',address:'Địa chỉ cũ',size:'L'});
  assert.equal(result.state.phone,undefined);assert.equal(result.state.size,undefined);assert.equal(result.order,null);
});
test('yêu cầu sửa/hủy đơn đã tạo được gắn cờ, không tạo đơn mới',()=>{
  const result=run({...empty(),action:'amend',action_source:'đổi size'},'đổi size L', {order_id:'old',order_code:'DH-OLD'});
  assert.equal(result.review_request,'đổi size L');assert.equal(result.order,null);
});
test('không có sản phẩm thì hỏi mẫu trước khi tạo; malformed extraction bị chặn',()=>{
  const result=run({...empty(),action:'confirm',action_source:'chốt'},'chốt',
    {customer_name:'Mai',phone:'0901234567',address:'12 Nguyễn Trãi, phường Bến Thành, TP Hồ Chí Minh',address_complete:true}, {context:{history:[],product:null}});
  assert.match(result.reply,/sản phẩm nào/);assert.equal(result.order,null);
  assert.throws(()=>validateCheckout({action:'confirm'}),/không hợp lệ/);
});
test('đang thiếu dữ liệu nhưng khách hỏi vấn đề khác thì không nhắc câu hỏi cũ',()=>{
  const first=run({...empty(),action:'confirm',action_source:'chốt',size:field('M')},'chốt M');
  const result=run(empty(),'vải có co giãn không',first.state,{context:{...context,intent:'product_info'}});
  assert.equal(result.order,null);assert.equal(result.reply,null);
  assert.ok(result.state.missing.includes('phone'));
});
test('nhận diện ý định mua gần nhất trong lịch sử và tôn trọng lời hủy sau đó',()=>{
  assert.equal(hasExplicitPurchaseIntent([{direction:'inbound',text:'Mình mua 1 cái váy'}]),true);
  assert.equal(hasExplicitPurchaseIntent([
    {direction:'inbound',text:'chốt màu đỏ'},
    {direction:'inbound',text:'thôi không mua nữa'}
  ]),false);
  assert.equal(hasExplicitPurchaseIntent([{direction:'inbound',text:'nếu mua thì bao nhiêu tiền'}]),false);
});
test('checkout khôi phục từ lịch sử được cấp ID ổn định để tiếp tục thu thập',()=>{
  const result=run({...empty(),phone:field('0901234567')},'0901234567',{confirmed:true,recovered_from_history:true});
  assert.equal(result.state.checkout_id,'12345678-1234-4234-8234-123456789012');
  assert.equal(result.state.phone,'0901234567');
  assert.equal(result.order,null);
});
