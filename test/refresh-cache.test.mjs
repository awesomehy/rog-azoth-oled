import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshCache } from '../src/refresh-cache.mjs';

test('a delayed HTTP response does not suppress the next 30-second polling tick', async () => {
  let clock = 0, calls = 0, finish;
  const cache = new RefreshCache(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { maxAgeMs: 30000, now: () => clock });
  const first = cache.read();
  await Promise.resolve();
  clock = 2000; finish('first'); await first;
  clock = 30000;
  assert.equal(await cache.read(), 'first');
  assert.equal(calls, 1);
  const poll = cache.read({ refresh: true });
  await Promise.resolve();
  assert.equal(calls, 2);
  clock = 32000; finish('second');
  assert.equal(await poll, 'second');
});

test('navigation shares an in-flight request and expires completed data after 30 seconds', async () => {
  let clock = 0, calls = 0, finish;
  const cache = new RefreshCache(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { maxAgeMs: 30000, now: () => clock });
  const first = cache.read();
  assert.equal(cache.read({ refresh: true }), first);
  await Promise.resolve(); finish('data'); await first;
  clock = 29999; assert.equal(await cache.read(), 'data'); assert.equal(calls, 1);
  clock = 30000;
  const next = cache.read();
  await Promise.resolve(); assert.equal(calls, 2); finish('updated'); await next;
});

test('failed requests are throttled too and a scheduled poll can retry without losing good data', async () => {
  let clock = 0, calls = 0;
  const cache = new RefreshCache(async () => {
    calls++;
    if (calls === 2) throw new Error('offline');
    return calls;
  }, { maxAgeMs: 30000, now: () => clock });
  assert.equal(await cache.read(), 1);
  await assert.rejects(cache.read({ refresh: true }), /offline/);
  assert.equal(cache.value, 1);
  clock = 1000; await assert.rejects(cache.read(), /offline/); assert.equal(calls, 2);
  assert.equal(await cache.read({ refresh: true }), 3);
});
