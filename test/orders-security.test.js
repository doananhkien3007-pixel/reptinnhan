import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { authorizeOrders } from '../server/orders.js';
import { readWebhookBody } from '../server/webhook-body.js';
test('orders API không công khai dữ liệu, yêu cầu token quản trị đủ mạnh',()=>{
  const original=process.env.ORDERS_ADMIN_TOKEN;
  const res={setHeader(k,v){this[k]=v;},status(s){this.code=s;return this;},json(v){this.body=v;return this;}};
  try {
    delete process.env.ORDERS_ADMIN_TOKEN;
    assert.equal(authorizeOrders({headers:{}},res),false);assert.equal(res.code,503);
    process.env.ORDERS_ADMIN_TOKEN='a'.repeat(32);
    assert.equal(authorizeOrders({headers:{authorization:'Bearer wrong'}},res),false);assert.equal(res.code,401);
    assert.equal(authorizeOrders({headers:{authorization:'Bearer '+'a'.repeat(32)}},res),true);
    assert.equal(res['Cache-Control'],'no-store');
  }finally{if(original===undefined)delete process.env.ORDERS_ADMIN_TOKEN;else process.env.ORDERS_ADMIN_TOKEN=original;}
});
test('webhook tạo đơn chỉ chấp nhận chữ ký Facebook trên raw bytes',async()=>{
  const original=process.env.FB_APP_SECRET;process.env.FB_APP_SECRET='test-only-secret';
  try{
    const raw=Buffer.from('{"object":"page"}');
    const req=Readable.from([raw]);req.headers={'x-hub-signature-256':'sha256='+createHmac('sha256',process.env.FB_APP_SECRET).update(raw).digest('hex')};
    await readWebhookBody(req,true);assert.equal(req.body.object,'page');
    await assert.rejects(readWebhookBody({body:raw,headers:{}},true),/chữ ký/);
    await assert.rejects(readWebhookBody({body:Buffer.from('{}'),headers:req.headers},true),/Chữ ký/);
    delete process.env.FB_APP_SECRET;await assert.rejects(readWebhookBody({body:raw,headers:req.headers},true),/FB_APP_SECRET/);
  }finally{if(original===undefined)delete process.env.FB_APP_SECRET;else process.env.FB_APP_SECRET=original;}
});
