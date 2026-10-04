import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/products.js';
test('API đơn kiểm tra token, phân trang/lọc và chống ghi đè trạng thái cũ',async()=>{
  process.env.SUPABASE_URL='https://orders-test.supabase.co';process.env.SUPABASE_SECRET_KEY='test-secret';process.env.ORDERS_ADMIN_TOKEN='orders-test-token-longer-than-24';
  const original=globalThis.fetch;const requests=[];let stale=false;
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input);requests.push({url,init});
    let data=[];
    if(url.pathname.endsWith('/orders'))data=init.method==='PATCH'?(stale?null:{id:'11111111-1111-4111-8111-111111111111',status:'processing'}):[{id:'one',status:'new'}];
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Content-Range':'0-0/51'}});
  };
  const call=async(method,query,body,authorized=true)=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(value){this.value=value;return this;}};
    await handler({method,query,body,headers:authorized?{authorization:'Bearer '+process.env.ORDERS_ADMIN_TOKEN}:{}},res);return res;
  };
  try{
    assert.equal((await call('GET',{action:'orders_list'},{},false)).code,401);assert.equal(requests.length,0);
    const result=await call('GET',{action:'orders_list',page:'1',status:'new'});
    assert.equal(result.code,200);assert.equal(result.value.total,51);assert.equal(result.value.page,1);
    assert.equal(requests[0].url.searchParams.get('offset'),'50');assert.equal(requests[0].url.searchParams.get('status'),'eq.new');
    assert.equal(requests[1].url.searchParams.get('state->>order_id'),'is.null');
    assert.equal((await call('GET',{action:'orders_list',status:'bad'})).code,400);
    assert.equal((await call('POST',{action:'orders_status'},{id:'bad',status:'completed'})).code,400);
    const body={id:'11111111-1111-4111-8111-111111111111',status:'processing',updated_at:'2026-10-03T01:00:00Z'};
    assert.equal((await call('POST',{action:'orders_status'},body)).code,200);
    assert.equal(requests.at(-1).url.searchParams.get('updated_at'),'eq.'+body.updated_at);
    stale=true;assert.equal((await call('POST',{action:'orders_status'},body)).code,409);
  }finally{globalThis.fetch=original;}
});
