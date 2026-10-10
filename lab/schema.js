const str = { type: 'string' };
const nullable = { type: ['string', 'null'] };
const en = (...values) => ({ type: 'string', enum: values });
const arr = items => ({ type: 'array', items });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const MEMORY_KEYS = ['weight_kg','height_cm','buying_for','interested_product','interested_color','recommended_size','selected_size','concern','considered_option','confirmed_choice','unresolved_reference'];
const observation = { subject: str, key: en(...MEMORY_KEYS), value: str, kind: en('fact','inference'), evidence_message_id: str, evidence: str };
export const SCHEMA_VERSION = 'emi-schema-1.1.0';
export const BRAIN_SCHEMA = obj({
  understanding: str,
  current_product_id: nullable,
  referenced_products: arr(obj({ product_id: nullable, reference: str, relation: str, candidates: arr(str), certainty: en('certain','uncertain') })),
  new_facts: arr(obj(observation)),
  memory_updates: arr(obj({ op: en('upsert','remove'), ...observation })),
  concerns: arr(str),
  purchase_intent: obj({ description: str, confirmed: { type: 'boolean' }, transactions: arr(obj({ action: en('ask','consider','select','buy','add','remove','exchange','return','hold','revise','confirm','unconfirmed'), source_product_id: nullable, target_product_id: nullable, quantity: { type: ['integer','null'] }, confirmation: en('confirmed','unconfirmed'), description: str })) }),
  next_best_action: str,
  missing_information: arr(str),
  uncertainties: arr(str),
  human_needed: obj({ needed: { type: 'boolean' }, reason: str }),
  media_ids: arr(str),
  suggested_reply: str
});

// Independent runtime validation: no business intent detection or reply rewriting.
export function validateSchema(value, schema = BRAIN_SCHEMA, path = 'output') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(actual) && !(actual === 'number' && types.includes('integer') && Number.isInteger(value))) throw new Error(`${path}: sai kiểu dữ liệu`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}: giá trị không hợp lệ`);
  if (actual === 'object') {
    for (const key of schema.required) if (!Object.hasOwn(value,key)) throw new Error(`${path}.${key}: thiếu trường`);
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) throw new Error(`${path}.${key}: trường không cho phép`);
      validateSchema(value[key], schema.properties[key], `${path}.${key}`);
    }
  }
  if (actual === 'array') value.forEach((v,i) => validateSchema(v,schema.items,`${path}[${i}]`));
  if (actual === 'string' && value.length > 4000) throw new Error(`${path}: quá dài`);
  if (actual === 'array' && value.length > 100) throw new Error(`${path}: quá nhiều mục`);
  return value;
}

export function validateBrain(output, input) {
  validateSchema(output);
  if (!output.suggested_reply.trim()) throw new Error('Suggested Reply trống');
  const ids = new Set(input.catalog.products.map(p=>p.id));
  const mediaIds = new Map();
  for (const product of input.catalog.products) {
    for (const media of product.media || []) {
      if (!media || typeof media.id !== 'string' || !media.id || !['image','video'].includes(media.type) || typeof media.url !== 'string' || !media.url) throw new Error('Catalog media không hợp lệ');
      if (mediaIds.has(media.id)) throw new Error('Catalog media ID bị trùng');
      mediaIds.set(media.id, media);
    }
  }
  if (output.media_ids.length > 5 || new Set(output.media_ids).size !== output.media_ids.length) throw new Error('Danh sách media không hợp lệ');
  const selectedMedia = output.media_ids.map(id=>{const media=mediaIds.get(id);if(!media)throw new Error('Model chọn media không có trong Lab');return media;});
  if (selectedMedia.filter(m=>m.type==='image').length > 4 || selectedMedia.filter(m=>m.type==='video').length > 1) throw new Error('Số lượng media vượt giới hạn');
  const validId = id => { if (id !== null && !ids.has(id)) throw new Error('Model tham chiếu sản phẩm không có trong Lab'); };
  validId(output.current_product_id);
  output.referenced_products.forEach(p=>{validId(p.product_id);p.candidates.forEach(validId);});
  output.purchase_intent.transactions.forEach(t=>{validId(t.source_product_id);validId(t.target_product_id);if(t.quantity !== null && t.quantity < 1) throw new Error('Số lượng không hợp lệ');});
  const sources = new Map([...input.history,...input.messages].map(m=>[m.id,m.text]));
  sources.set('customer_profile', JSON.stringify(input.customer));
  for (const fact of [...output.new_facts,...output.memory_updates]) {
    if (!/^(customer|recipient:[\w-]+|product:LAB-[\w-]+)$/.test(fact.subject)) throw new Error('Memory subject không hợp lệ');
    if (fact.subject.startsWith('product:')) validId(fact.subject.slice(8));
    if (!fact.evidence.trim() || !sources.get(fact.evidence_message_id)?.includes(fact.evidence)) throw new Error('Memory evidence không khớp nguồn hội thoại');
    if (fact.kind === 'fact' && !['customer_profile', ...input.history.filter(m=>m.role==='user').map(m=>m.id), ...input.messages.map(m=>m.id)].includes(fact.evidence_message_id)) throw new Error('Lời assistant không phải fact của khách');
  }
  return output;
}
export function applyMemory(memory, updates) {
  const entries = new Map(memory.map(m=>[`${m.subject}:${m.key}:${m.kind}`,m]));
  for (const {op,...entry} of updates) {
    const key = `${entry.subject}:${entry.key}:${entry.kind}`;
    if (op === 'remove') entries.delete(key);
    else entries.set(key,entry);
  }
  return [...entries.values()];
}
