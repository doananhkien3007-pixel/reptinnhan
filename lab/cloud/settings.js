import { readFileSync } from 'node:fs';

export const catalog = JSON.parse(readFileSync(new URL('../catalog.json', import.meta.url), 'utf8'));
export const settings = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
export const defaultModel = () => process.env.EMI_LAB_MODEL || process.env.OPENAI_MODEL || settings.default_model;
export const now = () => new Date().toISOString();
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function checkedText(value, label, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} không hợp lệ (tối đa ${max} ký tự).`);
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail(400, 'ID không hợp lệ.');
  return value;
}
