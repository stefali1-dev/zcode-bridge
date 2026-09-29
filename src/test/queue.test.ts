import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowQueue } from '../driver/queue.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('jobs run in submission order', async () => {
  const q = new WindowQueue();
  const order: string[] = [];
  await Promise.all([
    q.run(async () => {
      await sleep(30);
      order.push('a');
    }),
    q.run(async () => {
      order.push('b');
    }),
    q.run(async () => {
      order.push('c');
    }),
  ]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('a failing job does not block later jobs', async () => {
  const q = new WindowQueue();
  const order: string[] = [];
  const second = q.run(async () => {
    throw new Error('boom');
  });
  const third = q.run(async () => {
    order.push('c');
  });
  await assert.rejects(second, /boom/);
  await third;
  assert.deepEqual(order, ['c']);
});

test('timeout rejects the caller while the window is held', async () => {
  const q = new WindowQueue();
  const slow = q.run(() => sleep(200), 50);
  await assert.rejects(slow, /window busy/);
});
