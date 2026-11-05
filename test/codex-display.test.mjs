import test from 'node:test';
import assert from 'node:assert/strict';
import { codexModel } from '../src/codex-display.mjs';

test('weekly display selects by duration and formats the reset in Shanghai time', () => {
  const value = codexModel([{ id: 'codex', windows: [
    { durationMinutes: 300, remainingPercent: 80 },
    { durationMinutes: 10080, remainingPercent: 4, resetsAt: Date.parse('2026-11-05T14:24:00Z') / 1000 },
  ] }]);
  assert.deepEqual(value, { remaining: 4, resetDate: '11/05', resetTime: '22:24', footer: '北京时间' });
});
test('missing weekly quota does not display a different window as weekly quota', () => {
  assert.equal(codexModel([{ id: 'codex', windows: [{ durationMinutes: 300, remainingPercent: 80 }] }]).remaining, null);
  assert.equal(codexModel(null, { code: 'UNAUTHORIZED' }).footer, '需要密钥');
});
