import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listJavaScriptFiles(fullPath) : entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

test('Vercel Hobby chỉ deploy bốn API entrypoint, không biến module nội bộ thành function', () => {
  const apiDirectory = fileURLToPath(new URL('../api/', import.meta.url));
  const functions = listJavaScriptFiles(apiDirectory).map((file) => path.basename(file)).sort();
  assert.deepEqual(functions, ['facebook-ads.js', 'lab.js', 'products.js', 'webhook.js']);
  assert.ok(functions.length <= 12);
});
