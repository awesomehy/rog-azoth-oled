import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigation } from '../src/navigation.mjs';
import { normalizeUsage } from '../src/usage-api.mjs';

const config = { pages: ['temperature', 'utilization', 'codex'], defaultPage: 'temperature', adjustmentTimeoutMs: 5000 };
test('idle lever input changes information pages without selecting a control', () => {
  const navigation = new Navigation(config);
  assert.deepEqual(navigation.lever('down'), { kind: 'display', page: 'utilization' });
  assert.equal(navigation.lever('down').page, 'codex');
  assert.equal(navigation.lever('down').page, 'temperature');
  assert.equal(navigation.lever('up').page, 'codex');
  assert.equal(navigation.browsing, true);
});
test('control adjustment requires a button event and returns to the previous page', () => {
  const navigation = new Navigation(config);
  navigation.lever('down', 0);
  navigation.button(0, 1000);
  assert.deepEqual(navigation.lever('up', 2000), { kind: 'native-control', mode: 0 });
  assert.equal(navigation.page, 'utilization');
  assert.equal(navigation.needsReturn(6999), false);
  assert.equal(navigation.needsReturn(7000), true);
  navigation.button(7, 7000);
  assert.equal(navigation.browsing, true);
  assert.equal(navigation.page, 'utilization');
});
test('usage uses reported windows and distinguishes missing data from zero remaining', () => {
  const result = normalizeUsage({ limits: [{ limitId: 'codex', primary: { remainingPercent: 8, usedPercent: 92, windowDurationMins: 10080, resetsAt: 123 }, secondary: null }] });
  assert.deepEqual(result[0].windows, [{ remainingPercent: 8, durationMinutes: 10080, resetsAt: 123 }]);
  assert.equal(normalizeUsage({ limits: [{ primary: { usedPercent: null, remainingPercent: null } }] })[0].windows[0].remainingPercent, null);
});
