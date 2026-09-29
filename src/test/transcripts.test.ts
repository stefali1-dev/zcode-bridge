import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(os.tmpdir(), 'zbridge-rollout-'));
process.env.ZBRIDGE_ROLLOUT_DIR = dir;

const line1 = {
  querySource: 'main_turn',
  request: { messages: [{ role: 'user', content: 'hi' }], headers: { 'x-title': 'Z Code@electron' } },
  response: { text: 'hello there', finishReason: 'stop' },
  model: { modelId: 'glm-5.3' },
  completedAt: '2026-09-29T10:00:01Z',
};
const line2 = {
  querySource: 'main_turn',
  request: {
    messages: [
      { role: 'user', content: '<system-reminder>injected context noise</system-reminder>' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
      { role: 'user', content: 'again' },
    ],
    headers: { 'x-title': 'Z Code@electron' },
  },
  response: { text: 'second answer', finishReason: 'stop' },
  model: { modelId: 'glm-5.3-flash' },
  completedAt: '2026-09-29T10:00:05Z',
};
const titleLine = {
  querySource: 'session_title',
  request: { messages: [], headers: { 'x-title': 'Z Code@electron' } },
  response: { text: '{"title":"My chat"}', finishReason: 'stop' },
  model: { modelId: 'glm-5.3-flash' },
  completedAt: '2026-09-29T10:00:06Z',
};
writeFileSync(path.join(dir, 'model-io-sess_t1.jsonl'), `${JSON.stringify(line1)}\n${JSON.stringify(line2)}\n${JSON.stringify(titleLine)}\n`);
writeFileSync(path.join(dir, 'model-io-no-session.jsonl'), `${JSON.stringify(line1)}\n`);

const inflight = {
  querySource: 'main_turn',
  request: { messages: [{ role: 'user', content: 'go' }], headers: { 'x-title': 'in flight' } },
  model: { modelId: 'glm-5.3' },
};
writeFileSync(path.join(dir, 'model-io-sess_t2.jsonl'), `${JSON.stringify(inflight)}\n`);

const errored = {
  querySource: 'main_turn',
  request: { messages: [{ role: 'user', content: 'go' }], headers: { 'x-title': 'err' } },
  error: { message: 'v4 session stopped' },
  completedAt: '2026-09-29T10:01:00Z',
};
const old = new Date(Date.now() - 120_000);
const t2 = path.join(dir, 'model-io-sess_t2.jsonl');
const t3 = path.join(dir, 'model-io-sess_t3.jsonl');
writeFileSync(t3, `${JSON.stringify(errored)}\n`);
utimesSync(t2, old, old);
utimesSync(t3, old, old);

const t = await import('../domain/transcripts.js');

test('listSessions finds session files', () => {
  const ids = t.listSessions().map((s) => s.sessId).sort();
  assert.deepEqual(ids, ['no-session', 'sess_t1', 'sess_t2', 'sess_t3']);
});

test('readChat merges history with the last reply and drops system-reminder noise', () => {
  const chat = t.readChat('sess_t1');
  assert.ok(chat);
  assert.equal(chat.title, 'My chat');
  assert.equal(chat.model, 'glm-5.3-flash');
  assert.deepEqual(
    chat.messages.map((m) => [m.role, m.content]),
    [
      ['user', 'hi'],
      ['assistant', 'hello there'],
      ['user', 'again'],
      ['assistant', 'second answer'],
    ],
  );
});

test('chatState: in-flight record is running, completed is done, failed is error', () => {
  assert.equal(t.chatState('sess_t2').state, 'running');
  const done = t.chatState('sess_t1');
  assert.equal(done.state, 'done');
  assert.ok(done.state === 'done' && done.reply === 'second answer');
  const err = t.chatState('sess_t3');
  assert.ok(err.state === 'error' && /stopped/.test(err.error));
  assert.equal(t.chatState('nope').state, 'none');
});

test('chatState: completed record ending in tool-calls is still running', () => {
  const midLoop = {
    querySource: 'main_turn',
    request: { messages: [{ role: 'user', content: 'go' }], messagesKind: 'full', headers: { 'x-title': 'mid' } },
    response: { text: '', finishReason: 'tool-calls' },
    model: { modelId: 'glm-5.3' },
    completedAt: '2026-09-29T10:02:00Z',
  };
  writeFileSync(path.join(dir, 'model-io-sess_t5.jsonl'), `${JSON.stringify(midLoop)}\n`);
  utimesSync(path.join(dir, 'model-io-sess_t5.jsonl'), old, old);
  assert.equal(t.chatState('sess_t5').state, 'running');
});

test('readChat folds delta records after the last full one', () => {
  const full = {
    querySource: 'main_turn',
    request: { messages: [{ role: 'user', content: 'first' }], messagesKind: 'full', headers: { 'x-title': 'd' } },
    response: { text: '', finishReason: 'tool-calls' },
    model: { modelId: 'glm-5.3' },
    completedAt: '2026-09-29T10:03:00Z',
  };
  const delta = {
    querySource: 'main_turn',
    request: { messages: [{ role: 'user', content: 'second' }], messagesKind: 'delta', headers: {} },
    response: { text: 'both seen', finishReason: 'stop' },
    model: { modelId: 'glm-5.3' },
    completedAt: '2026-09-29T10:03:05Z',
  };
  writeFileSync(path.join(dir, 'model-io-sess_t6.jsonl'), `${JSON.stringify(full)}\n${JSON.stringify(delta)}\n`);
  utimesSync(path.join(dir, 'model-io-sess_t6.jsonl'), old, old);
  const chat = t.readChat('sess_t6');
  assert.deepEqual(
    chat?.messages.map((m) => [m.role, m.content]),
    [
      ['user', 'first'],
      ['user', 'second'],
      ['assistant', 'both seen'],
    ],
  );
});

test('isIdle follows chatState; waitForDone resolves on done', async () => {
  assert.equal(t.isIdle('sess_t1'), true);
  assert.equal(t.isIdle('sess_t2'), false);
  const st = await t.waitForDone('sess_t1', 1000);
  assert.equal(st.state, 'done');
  await assert.rejects(() => t.waitForDone('sess_t2', 100), /still working/);
});

test('matchSession finds the chat whose last user message is the text', () => {
  writeFileSync(path.join(dir, 'model-io-sess_t4.jsonl'), `${JSON.stringify(line1)}\n`);
  assert.equal(t.matchSession('again', new Set()), 'sess_t1');
  assert.equal(t.matchSession('hi', new Set(['sess_t1'])), 'sess_t4');
  assert.equal(t.matchSession('nonexistent', new Set()), null);
});
