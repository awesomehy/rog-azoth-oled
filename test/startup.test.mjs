import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// Run the actual application with a cold-device simulator: hardware packets
// receive ACKs but stay invisible until a full image initializes the renderer.
async function startApp(t, defaultPage, offline = false, savedState, wireless = false, boot = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'azoth-startup-'));
  const local = path.join(directory, '.local');
  await mkdir(local);
  if (savedState !== undefined) await writeFile(path.join(local, 'page-state.json'), savedState);
  await cp(new URL('../src/', import.meta.url), path.join(directory, 'src'), { recursive: true });
  await mkdir(path.join(directory, 'gear', 'ROG AZOTH', 'TEST_DEVICE', 'OLED', 'Profile 1'), { recursive: true });
  await writeFile(path.join(directory, 'gear', 'ROG AZOTH', 'TEST_DEVICE', 'OLED', 'Profile 1', 'HWInfo_Setting.txt'), '{"on_off":"1"}');
  await writeFile(path.join(directory, 'config.json'), JSON.stringify({
    pages: ['temperature', 'utilization', 'codex'], defaultPage, bootAnimation: boot,
    adjustmentTimeoutMs: 5000, hardwareRefreshMs: 1000,
    codexRefreshMs: 1000, codexCacheMs: 1000, codexDisplayMode: 'image',
    codexUsage: { baseUrl: 'http://usage-server.example' },
  }));
  await writeFile(path.join(directory, 'src', 'gearlink.mjs'), `
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    export async function findKeyboard() {
      return {
        root: fileURLToPath(new URL('../gear/', import.meta.url)), identity: { sn: 'TEST_DEVICE' },
        profiles: { data: [{ value: '1', oled: { defaultAnimation: 0 }, lever: { leverInfo: {
          leverUp: { function: 'Default' }, leverMid: { function: 'Default' }, leverDown: { function: 'Default' },
          state: { '0': { enable: true }, '7': { enable: false } },
        } } }] },
        client: { request: async classId => {
          if (${wireless} && classId === '50070001') throw new Error('Legacy USB banner writer cannot be used over OMNI');
          return { result: '0', profile_index: '1' };
        }, close() {} },
      };
    }
  `);
  await writeFile(path.join(directory, 'src', 'hardware.mjs'), `
    export async function readHardware() { return { temperature: { cpu: 60, gpu: 32 } }; }
    export function hardwarePacket(page) { return [0x66, 0, page === 'temperature' ? 1 : 0]; }
  `);
  await writeFile(path.join(directory, 'src', 'usage-api.mjs'), `
    export async function readCodexUsage() {
      ${offline ? 'return await new Promise(() => {});' : `return {
        fetchedAt: '2026-01-01T00:00:00Z', limits: [{ id: 'codex', windows: [
          { durationMinutes: 10080, remainingPercent: 75, resetsAt: 1800000000 },
        ] }],
      };`}
    }
  `);
  await writeFile(path.join(directory, 'src', 'native.mjs'), `
    import { EventEmitter } from 'node:events';
    import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
    const trace = { initialized: 0, frames: 0, beforeInitialization: 0, page: null, bootUploads: 0 };
    const slotFile = new URL('../.local/device-slot.json', import.meta.url);
    const save = () => writeFileSync(new URL('../.local/device.json', import.meta.url), JSON.stringify(trace));
    export class NativeBridge extends EventEmitter {
      ready = Promise.resolve();
      connection = { kind: '${wireless ? 'wireless' : 'usb'}' };
      constructor() {
        super();
        const eventFile = new URL('../.local/device-event.json', import.meta.url);
        this.events = setInterval(() => {
          if (!existsSync(eventFile)) return;
          const event = JSON.parse(readFileSync(eventFile, 'utf8'));
          unlinkSync(eventFile); this.emit(event.event, event);
        }, 50);
      }
      async initializeDisplay() { trace.initialized++; trace.page = null; save(); }
      async prepareBootAnimation() {
        const brand = 'windows';
        return { brand, key: 'test-boot-' + brand, frames: 36, durationMs: 60 };
      }
      async showBootAnimation() {
        const animation = await this.prepareBootAnimation();
        trace.initialized++; trace.bootUploads++; trace.bootBrand = animation.brand;
        writeFileSync(slotFile, JSON.stringify({ slot: 'boot', ...animation })); save();
        return animation;
      }
      async prepareCodex(model) { return JSON.stringify(model); }
      async showFrame() {
        writeFileSync(slotFile, JSON.stringify({ slot: 'runtime' }));
        trace.frames++;
        if (!trace.initialized) trace.beforeInitialization++;
        trace.page = 'codex'; save();
      }
      async query(packet) {
        if (packet[0] === 0x61 && packet[1] === 3 && existsSync(slotFile)) {
          const slot = JSON.parse(readFileSync(slotFile, 'utf8'));
          if (slot.slot === 'boot') { trace.initialized++; trace.bootBrand = slot.brand; save(); }
        }
        if (packet[0] === 0x66 && trace.initialized) {
          trace.page = packet[2] ? 'temperature' : 'utilization'; save();
        }
        return Object.assign(Array(65).fill(0), { 10: 1 });
      }
      async mode() { return 7; }
      async enable() {} async bind() {} close() { clearInterval(this.events); }
    }
  `);
  let child, ended, output;
  function launch() {
    output = '';
    child = spawn(process.execPath, [path.join(directory, 'src', 'app.mjs')], { windowsHide: true });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    ended = new Promise(resolve => child.once('exit', resolve));
  }
  async function stop(abrupt = false) {
    if (child.exitCode === null) {
      if (abrupt) child.kill();
      else await writeFile(path.join(local, 'stop'), 'stop');
      await Promise.race([ended, delay(2000)]);
      if (child.exitCode === null) { child.kill(); await ended; }
    }
  }
  launch();
  t.after(async () => {
    await stop();
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('azoth-startup-'));
    await rm(directory, { recursive: true, force: true });
  });
  async function waitFor(predicate, file = 'device.json') {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      try {
        const state = JSON.parse(await readFile(path.join(local, file), 'utf8'));
        // A successful session preparation may exit before the next poll.
        // Read its final state before treating process termination as failure.
        if (predicate(state) && /(?:^|\n)\S+ ready\r?\n/.test(output)) return state;
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (child.exitCode !== null) assert.fail(output);
      await delay(40);
    }
    assert.fail('Application did not display the expected page: ' + output);
  }
  return { local, waitFor, restart: async (abrupt = false) => {
    await stop(abrupt);
    // The tray supervisor removes a stale process lock during recovery.
    await rm(path.join(local, 'app.lock'), { force: true });
    launch();
  } };
}

test('cold startup displays temperature without keyboard input or a quota response', async t => {
  const app = await startApp(t, 'temperature', true);
  const state = await app.waitFor(state => state.page === 'temperature');
  assert.equal(state.initialized, 1);
  assert.equal(state.beforeInitialization, 0);
  await writeFile(path.join(app.local, 'command.json'), JSON.stringify({ page: 'utilization' }));
  assert.equal((await app.waitFor(state => state.page === 'utilization')).initialized, 1);
});

test('a fast quota response waits for initialization and unchanged polls do not flash', async t => {
  const app = await startApp(t, 'codex');
  const first = await app.waitFor(state => state.page === 'codex');
  assert.equal(first.initialized, 1);
  assert.equal(first.beforeInitialization, 0);
  assert.equal(first.frames, 1);
  await delay(2200);
  const latest = await app.waitFor(state => state.page === 'codex');
  assert.equal(latest.initialized, 1);
  assert.equal(latest.frames, 1);
});

test('the last information page survives a clean restart and termination during volume adjustment', async t => {
  const app = await startApp(t, 'temperature');
  await app.waitFor(state => state.page === 'temperature');
  await writeFile(path.join(app.local, 'command.json'), JSON.stringify({ page: 'codex' }));
  await app.waitFor(state => state.page === 'codex');
  await app.restart();
  await app.waitFor(state => state.page === 'codex');
  await writeFile(path.join(app.local, 'device-event.json'), JSON.stringify({ event: 'button', mode: 0 }));
  await app.waitFor(state => state.state === 'adjusting' && state.control === 'VOLUME', 'status.json');
  assert.deepEqual(JSON.parse(await readFile(path.join(app.local, 'page-state.json'), 'utf8')), { page: 'codex' });
  await app.restart(true);
  await app.waitFor(state => state.page === 'codex');
  const status = await app.waitFor(state => state.state === 'browsing', 'status.json');
  assert.equal(status.control, null);
  assert.equal(status.page, 'codex');
});

test('a removed information page falls back to the configured startup page', async t => {
  const app = await startApp(t, 'utilization', false, '{"page":"removed-page"}');
  await app.waitFor(state => state.page === 'utilization');
  assert.deepEqual(JSON.parse(await readFile(path.join(app.local, 'page-state.json'), 'utf8')), { page: 'utilization' });
});

test('wireless controls use the native adjustment screen and retain the remembered information page', async t => {
  const app = await startApp(t, 'codex', false, undefined, true);
  await app.waitFor(state => state.page === 'codex');
  await writeFile(path.join(app.local, 'device-event.json'), JSON.stringify({ event: 'button', mode: 0 }));
  const status = await app.waitFor(state => state.state === 'adjusting' && state.control === 'VOLUME', 'status.json');
  assert.equal(status.lastDisplayCause, 'native-control');
  assert.equal(status.connection.kind, 'wireless');
  assert.deepEqual(JSON.parse(await readFile(path.join(app.local, 'page-state.json'), 'utf8')), { page: 'codex' });
});

test('wireless session preparation prewrites Windows and cancelled shutdown resumes the last page', async t => {
  const app = await startApp(t, 'codex', false, undefined, true, true);
  await app.waitFor(state => state.page === 'codex');
  await writeFile(path.join(app.local, 'session-end'), 'prepare');
  const stopped = await app.waitFor(state => state.state === 'stopped' && state.bootReady, 'status.json');
  assert.equal(stopped.restored, true);
  assert.equal(stopped.bootAnimation.brand, 'windows');
  const bootCache = JSON.parse(await readFile(path.join(app.local, 'boot-state.json'), 'utf8'));
  assert.equal(bootCache.slot, 'boot');
  assert.equal(bootCache.brand, 'windows');
  await app.restart();
  const resumed = await app.waitFor(state => state.page === 'codex');
  assert.equal(resumed.bootUploads, 0);
  const original = await readFile(path.join(app.local, '..', 'gear', 'ROG AZOTH', 'TEST_DEVICE', 'OLED', 'Profile 1', 'HWInfo_Setting.txt'), 'utf8');
  assert.equal(JSON.parse(original).on_off, '1');
});
