import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabStore } from '../lab/store.js';
import { LabService } from '../lab/service.js';
import { createLabServer,config,catalog } from '../lab/server.js';
import { generateBrain, versions } from '../lab/brain.js';
import { validateBrain,applyMemory } from '../lab/schema.js';
import { evaluateCriticalCase } from '../lab/evaluation.js';
import { SEED_CASES } from '../lab/fixtures.js';
const input=()=>structuredClone(SEED_CASES.find(c=>c.id==='seed-mother').input);
const output=()=>({understanding:'Khách mua cho mẹ 60kg.',current_product_id:'LAB-A',referenced_products:[],new_facts:[],memory_updates:[],concerns:[],purchase_intent:{description:'Đang tư vấn cho mẹ, chưa chọn mua.',confirmed:false,transactions:[]},next_best_action:'Tư vấn theo người mặc.',missing_information:[],uncertainties:[],human_needed:{needed:false,reason:''},suggested_reply:'Dạ mẹ 60kg thì theo bảng mẫu này mình tham khảo L ạ.'});
const brain=async()=>({output:output(),response_id:'mock',actual_model:'test-model',versions});
const memory=()=>({subject:'recipient:mother',key:'weight_kg',value:'60',kind:'fact',evidence_message_id:'message-0',evidence:'mẹ 60kg'});
function setup(customBrain=brain){const store=new LabStore(':memory:');return {store,service:new LabService(store,catalog,config,customBrain)};}

test('schema và memory reject malformed output, invented IDs and invented evidence',()=>{
 assert.doesNotThrow(()=>validateBrain(output(),input()));
 const facts=output();facts.new_facts=[memory()];facts.memory_updates=[{op:'upsert',...memory()}];assert.doesNotThrow(()=>validateBrain(facts,input()));
 for(const mutate of [o=>delete o.understanding,o=>o.chain_of_thought='hidden',o=>o.current_product_id='real-product',o=>o.suggested_reply='',o=>o.human_needed.needed='yes',o=>o.purchase_intent.transactions=[{action:'buy',source_product_id:null,target_product_id:'LAB-A',quantity:0,confirmation:'confirmed',description:'x'}],o=>o.new_facts=[{...memory(),evidence:'khách 60kg'}],o=>o.new_facts=[{...memory(),kind:'confirmed'}]]){const o=output();mutate(o);assert.throws(()=>validateBrain(o,input()));}
 const other=input();other.history=[{id:'bot1',role:'assistant',text:'chị nặng 60kg'}];const o=output();o.new_facts=[{...memory(),evidence_message_id:'bot1',evidence:'60kg'}];assert.throws(()=>validateBrain(o,other),/assistant/);
});

test('memory phân biệt người nhận, fact/inference và size tư vấn/chọn; replace/remove',()=>{
 const recipient=memory(),customer={...recipient,subject:'customer',value:'53',evidence:'53'},recommended={...recipient,subject:'product:LAB-A',key:'recommended_size',value:'L',kind:'inference'},selected={...recommended,key:'selected_size',kind:'fact'};
 let saved=applyMemory([], [recipient,customer,recommended,selected].map(m=>({op:'upsert',...m})));
 assert.equal(saved.length,4);assert.equal(saved.find(m=>m.subject==='customer').value,'53');assert.equal(saved.find(m=>m.key==='recommended_size').kind,'inference');
 saved=applyMemory(saved,[{op:'upsert',...selected,value:'M'},{op:'remove',...recommended}]);assert.equal(saved.length,3);assert.equal(saved.find(m=>m.key==='selected_size').value,'M');
});

test('OpenAI request uses configurable model, strict schema, store:false, no tools and no chain of thought',async()=>{
 let request;const client={responses:{create:async p=>{request=p;return {status:'completed',id:'r',model:'configured-model',output_text:JSON.stringify(output()),usage:{total_tokens:30}};}}};
 const result=await generateBrain(input(),'configured-model',config,{client});
 assert.equal(request.model,'configured-model');assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.equal(request.text.format.schema.additionalProperties,false);assert.equal(request.tools,undefined);assert.equal(request.reasoning,undefined);assert.match(request.instructions,/không xuất chain-of-thought/);assert.deepEqual(result.output,output());
 assert.equal(JSON.parse(request.input[0].content.split('\n').slice(1).join('\n')).customer.id,'test-default');
 for(const response of [{status:'incomplete',output_text:JSON.stringify(output())},{status:'completed',output_text:''},{status:'completed',output_text:'invalid'}])await assert.rejects(generateBrain(input(),'model',config,{client:{responses:{create:async()=>response}}}));
});

test('multi-message turn persists input/output, reset only conversation memory, feedback saves replay case',async()=>{
 const {store,service}=setup();try{
 const c=service.create({customer_id:'test-default',entry:{ad_id:'LAB-ADS-A'}});
 const {conversation,run}=await service.turn(c.id,{messages:['chị mua','cho mẹ','60kg'],model:'test-model'});
 assert.equal(conversation.history.length,4);assert.equal(run.input.messages.length,3);assert.equal(run.input.entry.product_id,'LAB-A');assert.equal(store.get('runs',run.id).model,'test-model');
 const feedback=service.feedback({run_id:run.id,rating:'EDIT',corrected_reply:'Dạ mẹ mình 60kg, em tư vấn theo bảng L nhé chị.'});
 assert.deepEqual(feedback.input,run.input);assert.deepEqual(feedback.output,run.output);assert.ok(feedback.case.id);assert.deepEqual(store.get('cases',feedback.case.id).input,run.input);
 assert.throws(()=>service.feedback({run_id:run.id,rating:'EDIT',corrected_reply:''}));
 const replay=await service.replay(feedback.case.id,{model:'another-model'});assert.deepEqual(replay.input,run.input);assert.equal(replay.model,'another-model');
 await service.reset(c.id);assert.equal(store.get('conversations',c.id).history.length,0);assert.equal(store.get('conversations',c.id).memory.length,0);assert.ok(store.get('runs',run.id));assert.ok(store.get('cases',feedback.case.id));
 }finally{store.close();}
});

test('failed model and invalid memory never partially commit conversation or runs; concurrent/reset excluded',async()=>{
 let release;const {store,service}=setup(async()=>{await new Promise(resolve=>release=resolve);throw new Error('unavailable');});
 try{const c=service.create({customer_id:'test-default',entry:{product_id:'LAB-A'}});const pending=service.turn(c.id,{messages:['test'],model:'test-model'});await new Promise(resolve=>setImmediate(resolve));await assert.rejects(service.reset(c.id),/đang xử lý/);await assert.rejects(service.turn(c.id,{messages:['second'],model:'test-model'}),/đang xử lý/);release();await assert.rejects(pending,/unavailable/);assert.deepEqual(store.get('conversations',c.id),c);assert.equal(store.list('runs').length,0);
 service.brain=async()=>({output:{...output(),memory_updates:[{op:'upsert',...memory()}]}});await assert.rejects(service.turn(c.id,{messages:['test'],model:'test-model'}),/evidence/);assert.deepEqual(store.get('conversations',c.id),c);
 }finally{store.close();}
});

test('SQLite persists Lab data after reopen; only lab_ tables',()=>{
 const directory=mkdtempSync(join(tmpdir(),'emi-lab-'));try{let store=new LabStore(join(directory,'test.sqlite'));const c=store.customer('Test', 'Mẹ 60kg');store.close();store=new LabStore(join(directory,'test.sqlite'));assert.equal(store.get('customers',c.id).name,'Test');assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().every(row=>row.name.startsWith('lab_')));store.close();}finally{rmSync(directory,{recursive:true,force:true});}
});

test('22 fixtures cover required ambiguity and transactions; production modules cannot be imported',()=>{
 assert.equal(SEED_CASES.length,22);for(const c of SEED_CASES)assert.ok(c.input.messages.length);
 assert.equal(SEED_CASES.find(c=>c.id==='seed-exchange-add').input.messages[0].text,'c đổi c này lấy cái xanh hồi nãy nha ngực chật quá với lấy thêm c bông vàng');
 for(const file of readdirSync(new URL('../lab/',import.meta.url)).filter(f=>f.endsWith('.js'))){const code=readFileSync(new URL(`../lab/${file}`,import.meta.url),'utf8');assert.doesNotMatch(code,/from ['"](?:\.\.\/server\/|\.\.\/api\/|@supabase\/)/);assert.doesNotMatch(code,/graph\.facebook\.com|PAGE_ACCESS_TOKEN|SUPABASE_SECRET_KEY|\/me\/messages/);}
 assert.deepEqual(readdirSync(new URL('../api/',import.meta.url)).filter(f=>f.endsWith('.js')).sort(),['facebook-ads.js','products.js','webhook.js']);
});

test('HTTP end-to-end chat/feedback/replay/customer/import/export and local origin protection',async()=>{
 const store=new LabStore(':memory:');const {server}=createLabServer({store,brain});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,body,headers={})=>{const res=await fetch(base+path,body===undefined?{headers}:{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
 try{
 const boot=await call('/lab-api/bootstrap');assert.equal(boot.status,200);assert.equal(boot.body.cases.length,22);assert.equal(JSON.stringify(boot.body).includes('apiKey'),false);
 const page=await fetch(base);assert.match(await page.text(),/EMI SALES AGENT LAB/);
 const customer=await call('/lab-api/customers',{name:'Chị Mai',profile:'Mua cho mẹ'});assert.equal(customer.status,201);
 const conversation=await call('/lab-api/conversations',{customer_id:customer.body.id,entry:{ad_id:'LAB-ADS-A'}});assert.equal(conversation.status,201);
 const turn=await call(`/lab-api/conversations/${conversation.body.id}/turn`,{messages:['chị mua','cho mẹ 60kg'],model:'configured-model'});assert.equal(turn.status,200);assert.equal(turn.body.conversation.history.length,3);
 const feedback=await call('/lab-api/feedback',{run_id:turn.body.run.id,rating:'BAD',note:'Test concern'});assert.equal(feedback.status,201);assert.ok(feedback.body.case);
 const replay=await call(`/lab-api/cases/${feedback.body.case.id}/replay`,{model:'second-model'});assert.equal(replay.status,200);assert.deepEqual(replay.body.input,turn.body.run.input);
 const imported=await call('/lab-api/cases',{title:'Imported',input:input()});assert.equal(imported.status,201);
 const reset=await call(`/lab-api/conversations/${conversation.body.id}/reset`,{});assert.equal(reset.body.history.length,0);
 const exp=await call('/lab-api/export');assert.equal(exp.body.runs.length,2);assert.equal(exp.body.feedback.length,1);
 assert.equal((await call('/lab-api/conversations',{customer_id:'test-default'},{origin:'https://evil.example'})).status,403);
 const foreignHostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/lab-api/bootstrap',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(foreignHostStatus,403);
 assert.equal((await call('/api/webhook',{messages:['test']})).status,404);
 assert.equal((await call('/lab-api/conversations',{customer_id:'test-default',entry:{product_id:'production'}})).status,400);
 assert.equal((await call('/lab-api/cases',{title:'Bad import',input:{}})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});


test('critical evaluation catches exchange+add interpreted as three purchases and wrong recipient facts',()=>{
 const o=output();o.purchase_intent.transactions=[{action:'exchange',source_product_id:'LAB-A',target_product_id:'LAB-B',quantity:1,confirmation:'unconfirmed',description:'Đổi'},{action:'add',source_product_id:null,target_product_id:'LAB-C',quantity:1,confirmation:'unconfirmed',description:'Thêm'}];
 assert.equal(evaluateCriticalCase('seed-exchange-add',o).passed,true);
 o.purchase_intent.transactions.push({action:'buy',source_product_id:null,target_product_id:'LAB-A',quantity:1,confirmation:'unconfirmed',description:'Wrong third purchase'});assert.equal(evaluateCriticalCase('seed-exchange-add',o).passed,false);
 o.new_facts=[memory()];assert.equal(evaluateCriticalCase('seed-mother',o).passed,true);o.new_facts.push({...memory(),subject:'customer'});assert.equal(evaluateCriticalCase('seed-mother',o).passed,false);
});

test('OpenAI errors are sanitized without exposing credentials',async()=>{
 const client={responses:{create:async()=>{throw Object.assign(new Error('Secret key sk-example-DO-NOT-EXPOSE'),{status:401});}}};
 await assert.rejects(generateBrain(input(),'model',config,{client}),error=>error.status===502&&!error.message.includes('sk-example')&&error.message.includes('401'));
});
