import test from 'node:test';
import assert from 'node:assert/strict';
import { readCodexUsage } from '../src/usage-api.mjs';

const fetchedAt = '2026-11-05T14:00:00.000Z';
const sample = { ok: true, fetchedAt, limits: [{ limitId: 'codex', primary: { remainingPercent: 63, windowDurationMins: 10080, resetsAtIso: '2026-11-06T00:00:00.000Z' }, secondary: null }] };
// Example domain and fake key only; never use local credentials in fixtures.
const connection = { baseUrl: 'http://usage-server.example:58321', apiKey: 'TEST_KEY_DO_NOT_USE' };

test('LAN API uses the Authorization header, preserves fetchedAt and actual window', async () => {
  let request;
  const result = await readCodexUsage({ ...connection, fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return Response.json(sample);
  } });
  assert.equal(request.url, 'http://usage-server.example:58321/api/usage');
  assert.equal(request.options.headers.Authorization, 'Bearer TEST_KEY_DO_NOT_USE');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.url.includes(connection.apiKey), false);
  assert.equal(result.fetchedAt, fetchedAt);
  assert.deepEqual(result.limits[0].windows, [{ remainingPercent: 63, durationMinutes: 10080, resetsAt: 1793923200 }]);
});

test('authentication and upstream errors retain status/code without leaking response text', async () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [502, 'CODEX_QUERY_FAILED'], [503, 'CODEX_UNAVAILABLE'], [504, 'CODEX_TIMEOUT']]) {
    await assert.rejects(readCodexUsage({ ...connection, fetchImpl: async () => Response.json({ ok: false, error: { code, message: connection.apiKey } }, { status }) }), error => {
      assert.equal(error.code, code); assert.equal(error.status, status);
      assert.equal(error.message.includes(connection.apiKey), false);
      return true;
    });
  }
});

test('timeout, malformed data and credentials in URLs cannot become successful quota data', async () => {
  await assert.rejects(readCodexUsage({ ...connection, fetchImpl: async () => { throw new DOMException('private detail', 'TimeoutError'); } }), { code: 'TIMEOUT' });
  await assert.rejects(readCodexUsage({ ...connection, fetchImpl: async () => Response.json({ ok: true, limits: [] }) }), { code: 'INVALID_RESPONSE' });
  await assert.rejects(readCodexUsage({ ...connection, baseUrl: 'http://example.test/?key=test' }), { code: 'INVALID_API_URL' });
  await assert.rejects(readCodexUsage({ apiKey: connection.apiKey }), { code: 'INVALID_API_URL' });
});
