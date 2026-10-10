import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LabStore } from './store.js';
import { LabService, text } from './service.js';
import { versions } from './brain.js';
const root=dirname(fileURLToPath(import.meta.url));
export const config=JSON.parse(readFileSync(resolve(root,'config.json'),'utf8'));
export const catalog=JSON.parse(readFileSync(resolve(root,'catalog.json'),'utf8'));
export function createLabServer({store=new LabStore(resolve(root,'data/emi-sales-lab.sqlite')),brain,settings=config}={}) {
  const service=new LabService(store,catalog,settings,brain);
  const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  const server=createServer(async(req,res)=>{
    try {
      const host=req.headers.host;
      if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host||'')) return send(res,403,{error:'Lab chỉ truy cập qua localhost.'});
      if(req.headers.origin && req.headers.origin!==`http://${host}`) return send(res,403,{error:'Origin không hợp lệ'});
      const url=new URL(req.url,`http://${host}`);
      if(req.method==='GET' && ['/', '/lab.css','/lab.js'].includes(url.pathname)) {
        const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
        res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
        return res.end(readFileSync(resolve(root,'web',file)));
      }
      if(req.method==='GET') {
        if(url.pathname==='/lab-api/bootstrap')return send(res,200,{catalog,versions,default_model:process.env.EMI_LAB_MODEL||process.env.OPENAI_MODEL||settings.default_model,key_available:!!process.env.OPENAI_API_KEY,customers:store.list('customers'),conversations:store.list('conversations'),cases:store.list('cases'),runs:store.list('runs'),feedback:store.list('feedback')});
        if(url.pathname==='/lab-api/export')return send(res,200,{format:'emi-lab-export-1',catalog,versions,cases:store.list('cases'),runs:store.list('runs'),feedback:store.list('feedback'),conversations:store.list('conversations'),customers:store.list('customers')});
        return send(res,404,{error:'Route không có trong Lab'});
      }
      if(req.method!=='POST')return send(res,405,{error:'Method không hỗ trợ'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'Yêu cầu application/json'});
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>250000)return send(res,413,{error:'Body quá lớn'});}
      let body;try{body=JSON.parse(raw);}catch{return send(res,400,{error:'JSON không hợp lệ'});}
      if(!body||Array.isArray(body)||typeof body!=='object')return send(res,400,{error:'Body không hợp lệ'});
      const match=url.pathname.match(/^\/lab-api\/conversations\/([^/]+)\/(turn|reset|context)$/);
      if(match){const [,id,action]=match;return send(res,200,await service[action](id,body));}
      const replay=url.pathname.match(/^\/lab-api\/cases\/([^/]+)\/replay$/);
      if(replay)return send(res,200,await service.replay(replay[1],body));
      if(url.pathname==='/lab-api/conversations')return send(res,201,service.create(body));
      if(url.pathname==='/lab-api/customers')return send(res,201,store.customer(text(body.name,'Tên khách',100),body.profile?text(body.profile,'Hồ sơ',2000):''));
      if(url.pathname==='/lab-api/feedback')return send(res,201,service.feedback(body));
      if(url.pathname==='/lab-api/cases')return send(res,201,service.saveCase(body));
      return send(res,404,{error:'Route không có trong Lab'});
    }catch(error){const status=error.status||400;send(res,status,{error:error.message});}
  });
  server.requestTimeout=70000;
  return {server,store,service};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.EMI_LAB_PORT||config.port);
  const {server,store}=createLabServer();
  server.listen(port,'127.0.0.1',()=>console.log(`EMI SALES AGENT LAB · http://127.0.0.1:${port} · OpenAI key ${process.env.OPENAI_API_KEY?'ready':'missing'} · local test data only`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit(0);}));
}
