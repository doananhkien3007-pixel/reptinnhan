import { createLabServer,config } from './server.js';
import { evaluateCriticalCase } from './evaluation.js';
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
if(!process.env.OPENAI_API_KEY){console.error('Chưa có OPENAI_API_KEY. Cấu hình lab/.env.local trước khi chạy evaluation thật.');process.exit(1);}
const model=option('--model')||process.env.EMI_LAB_MODEL||process.env.OPENAI_MODEL||config.default_model;
const target=option('--case');
const {store,service}=createLabServer();
try {
 const cases=store.list('cases').filter(c=>!target||c.id===target);
 if(!cases.length)throw new Error('Không tìm thấy case');
 let errors=0,failed=0;
 for(const c of cases){
  try{const run=await service.replay(c.id,{model});const evaluation=evaluateCriticalCase(c.id,run.output);store.put('runs',{...run,evaluation});if(!evaluation.passed)failed++;console.log(JSON.stringify({case_id:c.id,title:c.title,model,run_id:run.id,output_valid:true,evaluation}));}
  catch(error){errors++;console.log(JSON.stringify({case_id:c.id,model,error:error.message}));}
 }
 console.log(JSON.stringify({total:cases.length,errors,critical_failures:failed,human_review:'Cần chấm GOOD/EDIT/BAD cho độ đúng, tự nhiên và shop facts của mọi output.'}));
 process.exitCode=errors||failed?1:0;
}finally{store.close();}
