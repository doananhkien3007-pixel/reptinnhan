import { createHash, timingSafeEqual } from 'node:crypto';
import { createSupabaseRemarketingStore, runRemarketingBatch } from '../server/remarketing-runner.js';

function authorized(req) {
  const expected = process.env.REMARKETING_CRON_SECRET;
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer /, '');
  if (!expected || expected.length < 32 || !supplied) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method không được hỗ trợ.' });
  if (!authorized(req)) return res.status(401).json({ error: 'Không được phép.' });
  try {
    const result = await runRemarketingBatch({ store: createSupabaseRemarketingStore() });
    return res.status(200).json(result);
  } catch (error) {
    console.error('Remarketing batch failed:', error?.message || error);
    return res.status(503).json({ error: 'Batch remarketing chưa hoàn tất.' });
  }
}
