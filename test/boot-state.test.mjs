import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BootState } from '../src/boot-state.mjs';

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'azoth-boot-state-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('azoth-boot-state-'));
    await rm(directory, { recursive: true, force: true });
  });
  const local = path.join(directory, 'local');
  const root = path.join(directory, 'gear');
  await mkdir(local); await mkdir(root);
  return { state: new BootState(local), local, root };
}

test('boot cache is reused only for the same asset, keyboard, profile and connection', async t => {
  const { state, local } = await setup(t);
  const animation = { brand: 'windows', key: 'test-asset', durationMs: 2160 };
  const identity = { sn: 'TEST_KEYBOARD' };
  assert.equal(await state.matches(animation, identity, '1', 'usb'), false);
  await state.commit(animation, identity, 1, 'usb');
  assert.equal(await state.matches(animation, identity, '1', 'usb'), true);
  assert.equal(await state.matches(animation, identity, '1', 'wireless'), false);
  assert.equal(await state.matches(animation, identity, '2', 'usb'), false);
  assert.equal(await state.matches(animation, { sn: 'OTHER_KEYBOARD' }, '1', 'usb'), false);
  assert.equal(await state.matches({ ...animation, key: 'new-asset' }, identity, '1', 'usb'), false);
  await writeFile(path.join(local, 'boot-state.json'), '{');
  assert.equal(await state.matches(animation, identity, '1', 'usb'), false);
});

test('runtime image invalidation retains the hardware file needed after cancelled shutdown', async t => {
  const { state, local, root } = await setup(t);
  const hardwarePath = path.join(root, 'HWInfo_Setting.txt');
  await writeFile(hardwarePath, '{"on_off":"1"}');
  await state.rememberHardware({ hardwarePath, hardwareOriginalText: '{"on_off":"1"}' }, root);
  await writeFile(hardwarePath, '{"on_off":"0"}');
  await state.invalidate();
  assert.equal(JSON.parse(await readFile(path.join(local, 'boot-state.json'), 'utf8')).slot, 'runtime');
  await state.restoreHardwareFile(root);
  assert.equal(await readFile(hardwarePath, 'utf8'), '{"on_off":"1"}');
  await assert.rejects(readFile(path.join(local, 'boot-hardware.json')), { code: 'ENOENT' });
});

test('pending restoration cannot overwrite files outside the keyboard settings root', async t => {
  const { state, local, root } = await setup(t);
  await writeFile(path.join(local, 'boot-hardware.json'), JSON.stringify({ path: path.join(local, 'HWInfo_Setting.txt'), text: 'invalid' }));
  await assert.rejects(state.restoreHardwareFile(root), /Invalid pending hardware settings path/);
});
