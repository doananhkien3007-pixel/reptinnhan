const $=id=>document.getElementById(id);
const state={data:null,conversation:null,run:null,pending:[],inflight:[],sending:false,caseRunning:false,rating:null};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
async function api(path,body){const response=await fetch(`/lab-api${path}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Lỗi Lab');return data;}
function options(items,selected){return items.map(([id,name])=>`<option value="${esc(id)}" ${id===selected?'selected':''}>${esc(name)}</option>`).join('');}
function entry(){const [kind,id]=$('entry').value.split(':');return kind==='ad'?{ad_id:id}:{product_id:id||null};}
function controls(){for(const id of ['new','reset','customer','entry','conversation-select'])$(id).disabled=state.sending;for(const id of ['replay','suite','case-select','import'])$(id).disabled=state.caseRunning;const preview=!!state.run?.case_id;$('message').disabled=preview;$('composer').querySelector('button').disabled=preview;if(preview){$('reset').disabled=true;$('entry').disabled=true;}}
async function refresh(){
 const oldCase=$('case-select').value,oldCustomer=$('customer').value,oldEntry=$('entry').value;
 state.data=await api('/bootstrap');
 $('customer').innerHTML=options(state.data.customers.map(c=>[c.id,c.name]),state.conversation?.customer.id||oldCustomer||'test-default');
 $('entry').innerHTML=options([...state.data.catalog.products.map(p=>[`product:${p.id}`,`${p.id} · ${p.name}`]),...state.data.catalog.ads.map(a=>[`ad:${a.id}`,a.name])],state.conversation?(state.conversation.entry.ad_id?`ad:${state.conversation.entry.ad_id}`:`product:${state.conversation.entry.product_id}`):oldEntry||'product:LAB-A');
 $('conversation-select').innerHTML='<option value="">Hội thoại đã lưu</option>'+options(state.data.conversations.map(c=>[c.id,`${c.customer.name} · ${new Date(c.updated_at).toLocaleString('vi-VN')} · ${c.history.length} tin`]),state.conversation?.id);
 $('case-select').innerHTML=options(state.data.cases.map(c=>[c.id,`${c.source==='fixture'?'TEST':'SAVED'} · ${c.title}`]),oldCase||'seed-exchange-add');
 renderRunSelect();renderCases();
}
function renderRunSelect(){const runs=state.conversation?state.data.runs.filter(r=>r.conversation_id===state.conversation.id):state.data.runs;$('run-select').innerHTML='<option value="">Chọn output</option>'+options(runs.map(r=>[r.id,`${r.model} · ${new Date(r.created_at).toLocaleTimeString('vi-VN')} · ${r.input.messages.map(m=>m.text).join(' / ').slice(0,45)}`]),state.run?.id);if(state.run&&!runs.some(r=>r.id===state.run.id))$('run-select').insertAdjacentHTML('beforeend',options([[state.run.id,`${state.run.model} · Replay case`]],state.run.id));}
function product(id){return state.run?.input.catalog.products.find(p=>p.id===id)?.name||state.data.catalog.products.find(p=>p.id===id)?.name||'Chưa xác định';}
function card(title,content,cls=''){return `<article class="brain-card ${cls}"><h3>${esc(title)}</h3>${content}</article>`;}
const list=values=>values.length?`<ul>${values.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`:'<p class="muted">Không có</p>';
function renderMemory(memory){$('memory').innerHTML=memory?.length?memory.map(m=>`<div class="memory-row"><span class="kind ${m.kind}">${esc(m.kind.toUpperCase())}</span><div><strong>${esc(m.subject)} · ${esc(m.key)}</strong>: ${esc(m.value)}<small>Nguồn ${esc(m.evidence_message_id)}: “${esc(m.evidence)}”</small></div></div>`).join(''):'<p class="muted">Chưa có memory.</p>';}
function renderBrain(){
 const run=state.run;$('evaluation').hidden=!run;
 if(!run){$('brain').innerHTML='<div class="empty"><span class="empty-mark">✧</span><h3>Mỗi câu trả lời có căn cứ</h3><p>Understanding, memory và bước tiếp theo sẽ xuất hiện khi Agent trả lời.</p></div>';renderMemory(state.conversation?.memory||[]);return;}
 const o=run.output;
 $('brain').innerHTML=card('Understanding',`<p>${esc(o.understanding)}</p>`,'wide')+
 card('Current Product / Referenced Products',`<p><strong>${esc(product(o.current_product_id))}</strong></p>`+list(o.referenced_products.map(p=>`${p.reference} → ${p.product_id||p.candidates.join(', ')||'?'} · ${p.relation} · ${p.certainty}`)))+
 card('New Facts',list(o.new_facts.map(f=>`${f.kind.toUpperCase()} · ${f.subject} · ${f.key}: ${f.value}`)))+
 card('Customer Concern / Objection',list(o.concerns))+
 card('Purchase Intent',`<p>${esc(o.purchase_intent.description)}</p>`+list(o.purchase_intent.transactions.map(t=>`${t.action}: ${t.source_product_id||'—'} → ${t.target_product_id||'?'} · ${t.quantity||'?'} món · ${t.confirmation} · ${t.description}`)))+
 card('Next Best Action',`<p>${esc(o.next_best_action)}</p>`)+card('Missing Information',list(o.missing_information))+
 card('Uncertainty',list(o.uncertainties),o.uncertainties.length?'alert':'')+
 card('Human Needed',`<p>${o.human_needed.needed?'Cần người thật':'Chưa cần'}${o.human_needed.reason?` · ${esc(o.human_needed.reason)}`:''}</p>`,o.human_needed.needed?'alert':'')+
 card('Suggested Reply',`<p>${esc(o.suggested_reply)}</p>`,'reply wide')+
 `<div class="run-meta"><span>${esc(run.actual_model||run.model)}</span><span>${(run.duration_ms/1000).toFixed(1)}s</span><span>${esc(run.versions.persona)}</span><span>${esc(run.versions.instructions)}</span><span>${run.usage?.total_tokens||'—'} tokens</span></div>`;
 renderMemory(run.memory_after||[]);
 const feedback=state.data.feedback.find(f=>f.run_id===run.id);$('feedback-status').textContent=feedback?`${feedback.rating} · ${feedback.corrected_reply||feedback.note||'Đã lưu đánh giá'}`:'';
}
function renderChat(){
 const preview=state.run?.case_id?state.run:null;const c=preview?{customer:preview.input.customer,id:preview.id,history:[...preview.input.history,...preview.input.messages,{role:'assistant',text:preview.output.suggested_reply,run_id:preview.id}]}:state.conversation,history=c?.history||[];
 $('chat-name').textContent=c?.customer.name||'Chị khách test';$('chat-mode').textContent=state.sending?'Agent đang xử lý…':preview?'Case snapshot · New Conversation để chat':c?`${history.length} tin · ${c.id.slice(0,8)}`:'Chưa có hội thoại';
 if(!history.length&&!state.pending.length&&!state.inflight.length){$('messages').innerHTML='<div class="empty"><span class="empty-mark">“</span><h3>Bắt đầu bằng lời của khách</h3><p>Viết tự nhiên, không dấu, sai chính tả,<br>hoặc gửi nhiều tin ngắn.</p></div>';return;}
 $('messages').innerHTML=history.map(m=>`<div class="bubble ${m.role==='user'?'user':'agent'} ${m.run_id===state.run?.id?'selected':''}" ${m.run_id?`data-run="${esc(m.run_id)}" tabindex="0" role="button" aria-label="Xem AI Brain của câu trả lời"`:''}><small>${m.role==='user'?'KHÁCH TEST':'EMI SALE'}</small>${esc(m.text)}</div>`).join('')+[...state.inflight,...state.pending].map(t=>`<div class="bubble user pending"><small>ĐANG CHỜ</small>${esc(t)}</div>`).join('');
 $('messages').scrollTop=$('messages').scrollHeight;
}
async function createConversation(){state.conversation=await api('/conversations',{customer_id:$('customer').value,entry:entry()});state.run=null;await refresh();renderChat();renderBrain();controls();renderCatalog();}
async function sendQueue(){
 if(state.sending||!state.pending.length)return;state.sending=true;controls();
 let batch=[];
 try{
   if(!state.conversation)await createConversation();
   while(state.pending.length){
     // Brief burst collection allows Messenger-like consecutive short messages.
     await new Promise(resolve=>setTimeout(resolve,650));batch=state.pending.splice(0,30);state.inflight=batch;renderChat();
     status(`Đang gửi ${batch.length} tin tới ${$('model').value}…`);
     const result=await api(`/conversations/${state.conversation.id}/turn`,{messages:batch,model:$('model').value});
     state.conversation=result.conversation;state.run=result.run;batch=[];state.inflight=[];await refresh();renderChat();renderBrain();status('Đã trả lời và cập nhật Sales Memory. Chọn GOOD / EDIT / BAD để đánh giá.');
   }
 }catch(error){state.pending.unshift(...batch);status(error.message,true);$('message').value=state.pending.join('\n');state.pending=[];state.inflight=[];}
 finally{state.sending=false;controls();renderChat();}
}
function renderCases(){
 const c=state.data.cases.find(c=>c.id===$('case-select').value);$('expectation').textContent=c?`Kỳ vọng: ${c.expectation||'Chưa có mô tả'}`:'';
 const runs=state.data.runs.filter(r=>r.case_id===c?.id||r.id===c?.source_run_id).slice(0,8);
 $('comparisons').innerHTML=runs.length?runs.map(r=>`<article class="comparison"><h3>${esc(r.actual_model||r.model)}${r.id===c.source_run_id?' · Original':''}</h3><small>${new Date(r.created_at).toLocaleString('vi-VN')} · ${(r.duration_ms/1000).toFixed(1)}s · ${esc(r.versions.persona)}</small><p>${esc(r.output.suggested_reply)}</p><p><strong>Understanding:</strong> ${esc(r.output.understanding)}</p><p><strong>Intent:</strong> ${esc(r.output.purchase_intent.description)}</p><p><strong>Uncertainty:</strong> ${esc(r.output.uncertainties.join('; ')||'Không có')}</p><button data-show-run="${esc(r.id)}">Xem AI Brain / đánh giá</button><details><summary>Input & structured output</summary><pre>${esc(JSON.stringify({input:r.input,output:r.output,memory_after:r.memory_after},null,2))}</pre></details></article>`).join(''):'<p class="muted">Chạy cùng case với model khác để so sánh cùng input/context.</p>';
}
function selectRun(id){state.run=state.data.runs.find(r=>r.id===id)||null;renderRunSelect();renderBrain();renderChat();controls();}
async function replay(){state.caseRunning=true;controls();try{status(`Đang chạy lại case với ${$('model').value}…`);state.run=await api(`/cases/${$('case-select').value}/replay`,{model:$('model').value});await refresh();renderBrain();renderChat();status('Đã chạy lại snapshot. Input/context giữ nguyên; xem so sánh bên dưới.');}finally{state.caseRunning=false;controls();}}
function guarded(fn){return async event=>{try{await fn(event);}catch(error){status(error.message,true);}};}
$('composer').addEventListener('submit',guarded(async event=>{event.preventDefault();const value=$('message').value.trim();if(!value)return;state.pending.push(value);$('message').value='';renderChat();await sendQueue();}));
$('message').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
$('new').onclick=guarded(createConversation);
$('reset').onclick=guarded(async()=>{if(state.conversation){state.conversation=await api(`/conversations/${state.conversation.id}/reset`,{});state.run=null;await refresh();renderChat();renderBrain();status('Đã reset hội thoại và memory; các run, feedback và case đã lưu vẫn còn.');}});
$('entry').onchange=guarded(async()=>{if(state.conversation)state.conversation=await api(`/conversations/${state.conversation.id}/context`,{entry:entry()});renderCatalog();status('Đã đổi context Product / Ads giả lập. Agent vẫn đối chiếu toàn bộ lịch sử.');});
$('customer').onchange=guarded(createConversation);
$('conversation-select').onchange=guarded(async()=>{state.conversation=state.data.conversations.find(c=>c.id===$('conversation-select').value)||null;state.run=state.data.runs.find(r=>r.id===state.conversation?.run_ids.at(-1))||null;await refresh();renderChat();renderBrain();renderCatalog();controls();});
$('run-select').onchange=()=>selectRun($('run-select').value);
$('messages').addEventListener('click',event=>{const el=event.target.closest('[data-run]');if(el)selectRun(el.dataset.run);});
$('messages').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.dataset.run){event.preventDefault();selectRun(event.target.dataset.run);}});
$('comparisons').onclick=event=>{const el=event.target.closest('[data-show-run]');if(el){selectRun(el.dataset.showRun);$('brain-title').scrollIntoView({behavior:'smooth'});}};
$('add-customer').onclick=()=>$('customer-dialog').showModal();
$('customer-form').onsubmit=guarded(async event=>{event.preventDefault();const customer=await api('/customers',{name:$('customer-name').value,profile:$('customer-profile').value});await refresh();$('customer').value=customer.id;await createConversation();$('customer-dialog').close();$('customer-form').reset();});
let feedbackRunId=null;
document.querySelectorAll('[data-rating]').forEach(button=>button.onclick=guarded(async()=>{state.rating=button.dataset.rating;feedbackRunId=state.run.id;if(state.rating==='GOOD'){await api('/feedback',{run_id:feedbackRunId,rating:'GOOD'});await refresh();renderBrain();status('Đã lưu GOOD.');return;}$('rating-title').textContent=`${state.rating} câu trả lời`;$('correction-field').hidden=state.rating!=='EDIT';$('correction').required=state.rating==='EDIT';$('correction').value=state.rating==='EDIT'?state.run.output.suggested_reply:'';$('feedback-note').value='';$('feedback-dialog').showModal();}));
$('feedback-form').onsubmit=guarded(async event=>{event.preventDefault();await api('/feedback',{run_id:feedbackRunId,rating:state.rating,corrected_reply:$('correction').value,note:$('feedback-note').value});$('feedback-dialog').close();await refresh();renderBrain();status('Đã lưu đánh giá và tự tạo evaluation case từ snapshot lỗi.');});
let caseRunId=null;
$('save-case').onclick=()=>{caseRunId=state.run.id;$('case-title').value=state.run.input.messages.map(m=>m.text).join(' / ').slice(0,200);$('case-expectation').value='';$('case-dialog').showModal();};
$('case-form').onsubmit=guarded(async event=>{event.preventDefault();const c=await api('/cases',{run_id:caseRunId,title:$('case-title').value,expectation:$('case-expectation').value});$('case-dialog').close();await refresh();$('case-select').value=c.id;renderCases();status('Đã lưu test case với toàn bộ input/context của lượt.');});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('replay').onclick=guarded(replay);$('case-select').onchange=renderCases;
$('suite').onclick=guarded(async()=>{state.caseRunning=true;controls();const cases=[...state.data.cases],model=$('model').value;let passed=0,failed=0;try{for(const c of cases){status(`Chạy ${passed+failed+1}/${cases.length} · ${c.title} · ${model}`);try{await api(`/cases/${c.id}/replay`,{model});passed++;}catch{failed++;}}await refresh();status(`Hoàn tất: ${passed} output hợp lệ, ${failed} lượt lỗi API/schema. Đây chưa phải chấm chất lượng sale tự động.`,failed>0);}finally{state.caseRunning=false;controls();}});
function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url);}
$('export').onclick=guarded(async()=>download('emi-sales-lab-export.json',await api('/export')));
$('import').onchange=guarded(async()=>{try{const file=$('import').files[0];if(!file)return;if(file.size>2000000)throw new Error('Import tối đa 2MB');const data=JSON.parse(await file.text()),cases=Array.isArray(data)?data:data.cases||[data];if(cases.length>100)throw new Error('Import tối đa 100 case mỗi lần');let count=0;for(const c of cases){await api('/cases',{title:c.title||file.name,expectation:c.expectation||'',input:c.input});count++;}await refresh();status(`Đã import ${count} case. Chỉ lưu vào database Lab.`);}finally{$('import').value='';}});
function renderCatalog(){const e=entry(),ad=state.data.catalog.ads.find(a=>a.id===e.ad_id),id=ad?.product_id||e.product_id;$('catalog').textContent=JSON.stringify({notice:state.data.catalog.notice,product:state.data.catalog.products.find(p=>p.id===id),policies:state.data.catalog.policies},null,2);}
(async()=>{try{await refresh();$('model').value=state.data.default_model;$('versions').textContent=`${state.data.versions.persona} / ${state.data.versions.schema}`;renderCatalog();status(state.data.key_available?'Lab sẵn sàng · OpenAI key đã cấu hình · dữ liệu giả lập.':'Chưa có OPENAI_API_KEY phía server. Có thể xem case và dữ liệu; cấu hình environment rồi restart để chat với OpenAI thật.',!state.data.key_available);}catch(error){status(error.message,true);}})();
