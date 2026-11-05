import test from 'node:test';
import assert from 'node:assert/strict';
import { hardwarePacket } from '../src/hardware.mjs';

test('cached sensor values form native dual-information packets with correct units', () => {
  const snapshot = { temperature: { cpu: 60, gpu: 32 }, utilization: { cpu: 17, gpu: 1 } };
  assert.deepEqual(hardwarePacket('temperature', snapshot), [0x66, 0, 1, 0, 1, 0, 60, 0, 17, 0, 32, 0]);
  assert.deepEqual(hardwarePacket('utilization', snapshot), [0x66, 0, 1, 0, 0, 0, 17, 0, 16, 0, 1, 0]);
});
test('unavailable sensors are not displayed as zero', () => {
  assert.equal(hardwarePacket('temperature', null), null);
  assert.equal(hardwarePacket('temperature', { temperature: { cpu: null, gpu: 30 } }), null);
});
