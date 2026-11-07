import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeBridge } from './native.mjs';
import { findKeyboard } from './gearlink.mjs';
import { BootState } from './boot-state.mjs';

const local = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.local');
const snapshot = JSON.parse(await readFile(path.join(local, 'restore.json'), 'utf8'));
let native, keyboard;
try {
  keyboard = await findKeyboard();
  await new BootState(local).restoreHardwareFile(keyboard.root);
  if (keyboard.identity.sn !== snapshot.identity.sn) throw new Error('Recovery keyboard does not match the saved device');
  native = new NativeBridge({ productId: Number(keyboard.identity.pid) }); await native.ready;
  const actualProfile = (await native.query([0x12, 0]))[10];
  if (actualProfile !== Number(snapshot.profile)) throw new Error(`请先切回键盘配置 ${snapshot.profile}，再恢复`);
  for (const key of [164, 165, 166]) await native.bind(key, 255);
  for (const mode of snapshot.enabledControls) await native.enable(mode, true);
  await native.enable(7, snapshot.browseOriginallyEnabled);
  if (Number.isInteger(snapshot.animationPreset)) await native.query([0x61, 0, 0, 0, snapshot.animationPreset]);
  const result = await keyboard.client.request('50090001', { ...keyboard.identity, ...snapshot.hardware });
  if (result.result !== '0') throw new Error(`温度页面恢复失败：${result.result}`);
  await writeFile(snapshot.hardwarePath, snapshot.hardwareOriginalText);
  await rm(path.join(local, 'app.lock'), { force: true });
  console.log('已恢复原来的温度页面和拨杆映射。');
} finally { native?.close(); keyboard?.client.close(); }
