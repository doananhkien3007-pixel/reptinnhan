import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('dashboard dùng fixed React Flow và tắt toàn bộ thao tác chỉnh graph', () => {
  const source = fs.readFileSync(new URL('../workflow-dashboard/components/workflow-dashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /nodesDraggable=\{false\}/);
  assert.match(source, /nodesConnectable=\{false\}/);
  assert.match(source, /elementsSelectable=\{false\}/);
  assert.match(source, /deleteKeyCode=\{null\}/);
  assert.match(source, /workflow_events/);
  assert.match(source, /workflow_executions/);
  assert.match(source, /edge_transfer/);
});

test('workflow cố định có đủ chín node theo đúng thứ tự', () => {
  const definition = fs.readFileSync(new URL('../workflow-dashboard/lib/workflow-definition.ts', import.meta.url), 'utf8');
  const expected = [
    'facebook_webhook', 'parse_message', 'detect_ad', 'find_product', 'check_auto_reply',
    'ai_agent', 'business_logic', 'send_messenger', 'completed'
  ];
  let cursor = -1;
  for (const node of expected) {
    const index = definition.indexOf(`id: '${node}'`);
    assert.ok(index > cursor, `${node} phải xuất hiện đúng thứ tự`);
    cursor = index;
  }
});

test('migration bật Realtime và chỉ cho dashboard đọc telemetry', () => {
  const sql = fs.readFileSync(new URL('../sql/workflow_realtime.sql', import.meta.url), 'utf8');
  for (const event of ['workflow_started', 'node_started', 'node_completed', 'edge_transfer', 'node_error', 'workflow_completed']) {
    assert.match(sql, new RegExp(event));
  }
  assert.match(sql, /alter publication supabase_realtime add table public\.workflow_executions/);
  assert.match(sql, /alter publication supabase_realtime add table public\.workflow_events/);
  assert.doesNotMatch(sql, /for (insert|update|delete)\s+to anon/i);
});
