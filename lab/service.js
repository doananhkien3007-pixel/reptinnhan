import { randomUUID } from 'node:crypto';
import { generateBrain, validateModel, versions } from './brain.js';
import { applyMemory, validateBrain } from './schema.js';
import { now } from './store.js';
function check(condition,message){if(!condition)throw Object.assign(new Error(message),{status:400});}
export function text(value,label,max=4000){check(typeof value==='string' && value.trim() && value.length<=max,`${label} không hợp lệ (tối đa ${max} ký tự)`);return value.trim();}
export function validateInput(input) {
  check(input && typeof input==='object','Thiếu input');
  check(input.catalog?.products?.length>0 && input.catalog.products.length<=50,'Catalog không hợp lệ');
  check(input.catalog.products.every(p=>typeof p.id==='string'&&p.id.startsWith('LAB-')),'Chỉ chấp nhận catalog LAB');
  check(Array.isArray(input.history)&&input.history.length<=160,'History không hợp lệ hoặc quá dài');
  check(Array.isArray(input.messages)&&input.messages.length>0&&input.messages.length<=30,'Messages không hợp lệ');
  check(Array.isArray(input.memory)&&input.memory.length<=100,'Memory không hợp lệ');
  const ids=new Set();
  for(const m of [...input.history,...input.messages]) {
    text(m.id,'Message ID',120);text(m.text,'Message',4000);check(['user','assistant'].includes(m.role),'Role không hợp lệ');check(!ids.has(m.id),'Message ID bị trùng');ids.add(m.id);
  }
  check(input.messages.every(m=>m.role==='user'),'Tin mới phải là role user');
  check(input.customer && typeof input.customer==='object','Thiếu customer');
  check(JSON.stringify(input).length<180000,'Context quá lớn');
  return input;
}
export class LabService {
  constructor(store,catalog,config,brain=generateBrain){Object.assign(this,{store,catalog,config,brain});this.busy=new Set();}
  require(name,id){const value=this.store.get(name,id);if(!value)throw Object.assign(new Error('Không tìm thấy dữ liệu Lab'),{status:404});return value;}
  entry(entry) {
    const ad = entry.ad_id ? this.catalog.ads.find(a=>a.id===entry.ad_id) : null;
    check(!entry.ad_id||ad,'Ads không có trong Lab');
    const product_id=ad?.product_id || entry.product_id || null;
    check(!product_id||this.catalog.products.some(p=>p.id===product_id),'Product không có trong Lab');
    return {product_id,ad_id:ad?.id||null};
  }
  create(body){return this.store.conversation(this.require('customers',body.customer_id),this.entry(body.entry||{}));}
  async locked(id,fn){if(this.busy.has(id))throw Object.assign(new Error('Hội thoại đang xử lý. Vui lòng chờ lượt hiện tại.'),{status:409});this.busy.add(id);try{return await fn();}finally{this.busy.delete(id);}}
  async turn(id,body){
    return this.locked(id,async()=>{
      const conversation=this.require('conversations',id);
      check(Array.isArray(body.messages)&&body.messages.length>0&&body.messages.length<=30,'Gửi từ 1 đến 30 tin');
      check(conversation.history.length+body.messages.length+1<=this.config.max_history_messages,'Hội thoại quá dài; lưu case rồi mở New Conversation để tiếp tục. Không âm thầm cắt context.');
      const input=validateInput({catalog:this.catalog,customer:conversation.customer,entry:conversation.entry,history:conversation.history,memory:conversation.memory,messages:body.messages.map(message=>({id:randomUUID(),role:'user',text:text(message,'Tin nhắn')}))});
      const run=await this.run(input,body.model,{conversation_id:id});
      const updated={...conversation,history:[...conversation.history,...input.messages,{id:randomUUID(),role:'assistant',text:run.output.suggested_reply,run_id:run.id}],memory:applyMemory(conversation.memory,run.output.memory_updates),run_ids:[...conversation.run_ids,run.id],revision:conversation.revision+1,updated_at:now()};
      this.store.atomic(()=>{this.store.put('runs',run);this.store.put('conversations',updated);});
      return {conversation:updated,run};
    });
  }
  async run(input,model,metadata={}){
    validateInput(input);validateModel(model);
    const started=Date.now();
    const result=await this.brain(input,model,this.config);
    validateBrain(result.output,input);
    return {id:randomUUID(),...metadata,input,model,...result,versions:result.versions||versions,created_at:now(),duration_ms:Date.now()-started,memory_after:applyMemory(input.memory,result.output.memory_updates)};
  }
  async reset(id){return this.locked(id,()=>{const c=this.require('conversations',id);return this.store.put('conversations',{...c,history:[],memory:[],run_ids:[],revision:c.revision+1,updated_at:now()});});}
  async context(id,body){return this.locked(id,()=>{const c=this.require('conversations',id);return this.store.put('conversations',{...c,entry:this.entry(body.entry||{}),updated_at:now()});});}
  saveCase(body){
    const run=body.run_id?this.require('runs',body.run_id):null;
    const input=run?.input||validateInput(body.input);
    return this.store.put('cases',{id:randomUUID(),title:text(body.title,'Tên case',200),expectation:body.expectation?text(body.expectation,'Kỳ vọng',4000):'',input,source:run?'run':'import',source_run_id:run?.id||null,created_at:now()});
  }
  feedback(body){
    const run=this.require('runs',body.run_id);check(['GOOD','EDIT','BAD'].includes(body.rating),'Rating không hợp lệ');
    const note=body.note?text(body.note,'Nhận xét',4000):'';
    const corrected_reply=body.rating==='EDIT'?text(body.corrected_reply,'Câu sale thật'):'';
    return this.store.atomic(()=>{
      const feedback=this.store.put('feedback',{id:randomUUID(),run_id:run.id,rating:body.rating,corrected_reply,note,input:run.input,output:run.output,model:run.model,actual_model:run.actual_model,versions:run.versions,created_at:now()});
      if(body.rating!=='GOOD') feedback.case=this.saveCase({run_id:run.id,title:`${body.rating} · ${run.input.messages.map(m=>m.text).join(' / ').slice(0,160)}`,expectation:corrected_reply||note||'Cần đánh giá và cải thiện câu trả lời.'});
      return feedback;
    });
  }
  async replay(id,body){const c=this.require('cases',id);const run=await this.run(c.input,body.model,{case_id:id,expectation:c.expectation});this.store.put('runs',run);return run;}
}
