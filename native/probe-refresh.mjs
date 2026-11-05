import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeBridge } from '../src/native.mjs';
import { codexModel } from '../src/codex-display.mjs';

const root = new URL('../', import.meta.url);
const status = JSON.parse(await readFile(new URL('.local/status.json', root), 'utf8'));
const model = codexModel(status.quota, null);
const bridge = new NativeBridge();
await bridge.ready;
try {
  for (let i = 0; i < 3; i++) {
    const key = await bridge.prepareCodex({ ...model, footer: `显示测试${i + 1}` }, 'image');
    const start = performance.now();
    try { await bridge.showFrame(key); console.log(`upload ${i}: ${Math.round(performance.now() - start)}ms OK`); }
    catch (error) { console.log(`upload ${i}: ${error.message}`); }
    await delay(i === 0 ? 0 : 1200);
  }
  const key = await bridge.prepareCodex(model, 'image');
  await bridge.showFrame(key);
  for (let i = 0; i < 3; i++) {
    try { await bridge.query([0x61, 3, 0, 0]); console.log(`cached show ${i}: OK`); }
    catch (error) { console.log(`cached show ${i}: ${error.message}`); }
  }
} finally { bridge.close(); }
