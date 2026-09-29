import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ZBRIDGE_HOME = mkdtempSync(path.join(os.tmpdir(), 'zbridge-home-'));

const r = await import('../domain/registry.js');

test('add, resolve by id / latest / sessId, unknown throws', () => {
  const a = r.add({ sessId: 'sess_a', title: 'first chat', owner: 'cli' });
  const b = r.add({ sessId: 'sess_b', title: 'second chat', owner: 'mcp' });
  assert.equal(a.id, 'c1');
  assert.equal(b.id, 'c2');
  assert.equal(r.resolve('c1').sessId, 'sess_a');
  assert.equal(r.resolve('sess_b').id, 'c2');
  assert.equal(r.resolve().title, 'second chat');
  assert.throws(() => r.resolve('nope'), /unknown/);
  assert.equal(r.knownSessionIds().size, 2);
});
