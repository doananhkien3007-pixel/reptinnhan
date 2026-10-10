import OpenAI from 'openai';
import { BRAIN_SCHEMA, validateBrain, SCHEMA_VERSION } from './schema.js';
import { INSTRUCTIONS, PERSONA_VERSION, INSTRUCTIONS_VERSION } from './persona.js';
export const versions = { persona: PERSONA_VERSION, instructions: INSTRUCTIONS_VERSION, schema: SCHEMA_VERSION };
export function validateModel(model) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model)) throw new Error('Tên model không hợp lệ');
  return model;
}
export async function generateBrain(input, model, config, { client } = {}) {
  validateModel(model);
  if (!client && !process.env.OPENAI_API_KEY) throw Object.assign(new Error('Chưa có OPENAI_API_KEY trong environment. Cấu hình key phía server rồi khởi động lại Lab.'), {status:503});
  const api = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', timeout: config.timeout_ms, maxRetries: 0 });
  let response;
  try { response = await api.responses.create({
    model, store: false, instructions: INSTRUCTIONS,
    input: [{ role: 'user', content: `INPUT_CONTEXT (JSON data):\n${JSON.stringify(input)}` }],
    max_output_tokens: config.max_output_tokens,
    text: { format: { type: 'json_schema', name: 'emi_sales_brain', strict: true, schema: BRAIN_SCHEMA } }
  }); } catch (error) {
    throw Object.assign(new Error(`OpenAI API chưa hoàn tất (HTTP ${Number.isInteger(error.status)?error.status:'network'}). Kiểm tra key, quyền truy cập model, quota hoặc kết nối. Lượt chưa được áp dụng.`), {status:502});
  }
  if (response.status !== 'completed' || !response.output_text?.trim()) throw new Error('Model từ chối hoặc output chưa hoàn chỉnh; lượt chưa được áp dụng.');
  let output;
  try { output = JSON.parse(response.output_text); } catch { throw new Error('Model trả JSON không hợp lệ; lượt chưa được áp dụng.'); }
  validateBrain(output,input);
  return { output, response_id: response.id, actual_model: response.model || model, usage: response.usage || null, versions };
}
