// Offline evaluation assertions only. These never choose a response or sales flow.
export function evaluateCriticalCase(caseId, output) {
  const checks=[];
  const add=(name,passed)=>checks.push({name,passed});
  const observations=[...output.new_facts,...output.memory_updates.filter(m=>m.op==='upsert')];
  const transactions=output.purchase_intent.transactions;
  if(caseId==='seed-mother') {
    add('60kg thuộc người mẹ',observations.some(m=>m.subject==='recipient:mother'&&m.key==='weight_kg'&&m.value==='60'&&m.kind==='fact'));
    add('Không gán 60kg cho khách',!observations.some(m=>m.subject==='customer'&&m.key==='weight_kg'&&m.value==='60'));
  }
  if(caseId==='seed-weight53') add('53 được hiểu là cân nặng',observations.some(m=>m.subject==='customer'&&m.key==='weight_kg'&&m.value==='53'&&m.kind==='fact'));
  if(caseId==='seed-height-shorthand') {
    add('54kg được hiểu là cân nặng',observations.some(m=>m.subject==='customer'&&m.key==='weight_kg'&&m.value==='54'&&m.kind==='fact'));
    add('m54 được hiểu là chiều cao 154cm',observations.some(m=>m.subject==='customer'&&m.key==='height_cm'&&m.value==='154'&&m.kind==='fact'));
    const reply=output.messages.join(' ').toLocaleLowerCase('vi-VN').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
    add('Không hỏi lại chiều cao',!/(cho em (biet|xin)|xin them)[^?.!]{0,40}(chieu cao|cao)|(chieu cao|cao)[^?.!]{0,20}(bao nhieu|la bao nhieu)/.test(reply));
  }
  if(caseId==='seed-ok-size'||caseId==='seed-like-not-select') add('Không tự xác nhận mua',!output.purchase_intent.confirmed&&!transactions.some(t=>['buy','confirm'].includes(t.action)&&t.confirmation==='confirmed'));
  if(caseId==='seed-ads-switch') add('Chuyển mẫu sang B',output.current_product_id==='LAB-B');
  if(['seed-exchange-add','seed-exchange-uncertain'].includes(caseId)) {
    const exchange=transactions.filter(t=>t.action==='exchange'), additions=transactions.filter(t=>t.action==='add'||t.action==='buy');
    add('Đúng một yêu cầu đổi',exchange.length===1&&exchange[0].source_product_id==='LAB-A'&&exchange[0].quantity===1);
    add('Chỉ thêm một mẫu bông vàng',additions.length===1&&additions[0].target_product_id==='LAB-C'&&additions[0].quantity===1);
    if(caseId==='seed-exchange-add') add('Đích đổi là B',exchange[0]?.target_product_id==='LAB-B');
    else add('Không đoán xanh; nêu uncertainty',exchange[0]?.target_product_id===null&&output.uncertainties.length>0&&output.missing_information.length>0);
  }
  return {checks,passed:checks.every(c=>c.passed),human_review_needed:true};
}
