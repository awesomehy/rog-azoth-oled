import { mkdir, readFile, writeFile, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { findKeyboard } from './gearlink.mjs';
import { NativeBridge } from './native.mjs';
import { Navigation } from './navigation.mjs';
import { readCodexUsage } from './usage-api.mjs';
import { readHardware, hardwarePacket } from './hardware.mjs';
import { codexModel } from './codex-display.mjs';
import { RefreshCache } from './refresh-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
let quotaRequests = 0, quotaLastRequestedAt = null;
const quotaCache = new RefreshCache(() => {
  quotaRequests++; quotaLastRequestedAt = new Date().toISOString();
  return readCodexUsage(config.codexUsage);
}, {
  maxAgeMs: config.codexCacheMs ?? config.codexRefreshMs,
});
const navigation = new Navigation(config);
const supportedPages = new Set(['temperature', 'utilization', 'codex']);
if (config.pages.some(page => !supportedPages.has(page))) throw new Error('Unknown display page in config.json');
await mkdir(local, { recursive: true });
const lock = await import('node:fs/promises').then(fs => fs.open(path.join(local, 'app.lock'), 'wx'));
await lock.writeFile(String(process.pid));
let keyboard, native, snapshot, interval, quotaInterval, hardwareInterval;
let closing = false, suppressButton = false, returnPending = false, queue = Promise.resolve(), version = 0;
let quota = null, quotaPending = null, lastHardwarePage = null;
let displayWrites = 0, lastDisplayAt = null, lastDisplayCause = null;
let quotaFetchedAt = null, quotaError = null;
let preparedCodex = null, storedCodexFrameKey = null;
let imageUploadedAt = 0, imageRefreshTimer;
const codexDisplayMode = config.codexDisplayMode ?? 'banner';
if (!['image', 'banner'].includes(codexDisplayMode)) throw new Error('Unknown codexDisplayMode in config.json');
const codexShowPacket = codexDisplayMode === 'image' ? [0x61, 3, 0, 0] : [0x62, 2, 0, 0];
let sensors = null, sensorsAt = 0, sensorPending = null, storedBannerText = null;
let lastRequestedAt = performance.now();
const log = value => console.log(new Date().toISOString(), value);
const schedule = task => {
  const operation = queue.then(task);
  queue = operation.catch(error => { log(`ERROR ${error.message}`); return shutdown(error.message); });
  return operation;
};
const controlLabels = { 0: 'VOLUME', 1: 'MEDIA', 2: 'KEY LIGHT', 3: 'OLED LIGHT', 4: 'LIGHT EFFECT' };

async function status(extra = {}) {
  await writeFile(path.join(local, 'status.json'), JSON.stringify({
    pid: process.pid, updatedAt: new Date().toISOString(),
    state: closing ? 'stopped' : navigation.browsing ? 'browsing' : 'adjusting',
    page: navigation.page, control: navigation.browsing ? null : controlLabels[navigation.mode] ?? navigation.mode,
    quota, quotaFetchedAt, quotaError, quotaSource: config.codexUsage.baseUrl,
    quotaRequests, quotaLastRequestedAt,
    displayWrites, lastDisplayAt, lastDisplayCause, ...extra,
  }, null, 2));
}

async function gear(classId, fields) {
  const response = await keyboard.client.request(classId, { ...keyboard.identity, profile_index: snapshot.profile, ...fields });
  if (response.result !== '0') throw new Error(`Gear Link ${classId} returned ${response.result ?? 'no result'}`);
  return response;
}

async function hardwarePage(page) {
  const packet = Date.now() - sensorsAt < 10000 ? hardwarePacket(page, sensors) : null;
  if (packet) await native.query(packet);
  else await banner(`${page === 'temperature' ? 'TEMPERATURE' : 'CPU / GPU USAGE'}\nWAITING FOR DATA`);
}

async function stopHardwarePage() {
  if (lastHardwarePage === null) return;
  await gear('50090001', { ...snapshot.hardware, on_off: '0' });
  lastHardwarePage = null;
}

async function banner(text) {
  if (storedBannerText === text) {
    await native.query([0x62, 2, 0, 0]);
    return;
  }
  await gear('50070001', {
    banner_type: '1', direction: '0', font_name: 'Consolas', font_style: '0', font_size: '14', font_content: text,
  });
  storedBannerText = text;
}

async function prepareCodex() {
  const model = codexModel(quota, quotaError);
  const signature = JSON.stringify([codexDisplayMode, model]);
  if (preparedCodex?.signature !== signature) preparedCodex = { signature, key: await native.prepareCodex(model, codexDisplayMode) };
  return preparedCodex.key;
}

async function refreshQuota(force = false) {
  if (quotaPending) return quotaPending;
  if (!force && quotaCache.fresh) return;
  quotaPending = (async () => {
    try {
      const result = await quotaCache.read({ refresh: force });
      quota = result.limits; quotaFetchedAt = result.fetchedAt; quotaError = null;
    }
    catch (error) {
      quotaError = { code: error.code ?? 'UNAVAILABLE', status: error.status ?? null };
      log(`Codex quota unavailable: ${quotaError.code}${quotaError.status ? ` HTTP ${quotaError.status}` : ''}`);
    }
    finally { quotaPending = null; }
    if (!closing && navigation.browsing && navigation.page === 'codex') {
      const expected = version;
      schedule(() => render(expected, 'data'));
    }
    if (!closing) await status();
  })();
  return quotaPending;
}

async function refreshHardware() {
  if (sensorPending || closing) return;
  sensorPending = (async () => {
    try { sensors = await readHardware(keyboard.identity); sensorsAt = Date.now(); }
    catch (error) { log(`Hardware data unavailable: ${error.message}`); }
    finally { sensorPending = null; }
    if (!closing && navigation.browsing && ['temperature', 'utilization'].includes(navigation.page)) {
      const expected = version;
      schedule(() => render(expected, 'data'));
    }
  })();
  return sensorPending;
}

async function render(expectedVersion = version, cause = 'navigation') {
  if (closing || expectedVersion !== version) return;
  const requestedAt = lastRequestedAt;
  const displayName = navigation.browsing ? navigation.page : `control ${navigation.mode}`;
  if (!navigation.browsing) {
    await banner(`${controlLabels[navigation.mode] ?? 'CONTROL'}\nUP / DOWN TO ADJUST`);
  } else if (navigation.page === 'codex') {
    void refreshQuota();
    const key = await prepareCodex();
    if (expectedVersion !== version) return;
    // SHOW restarts the OLED animation and visibly flashes, even for identical
    // pixels. A successful quota poll must not redisplay an unchanged frame.
    if (cause === 'data' && (codexDisplayMode === 'image'
      ? storedCodexFrameKey === key : storedBannerText === `frame:${key}`)) {
      await status();
      return;
    }
    if (codexDisplayMode === 'image') {
      if (storedCodexFrameKey === key) await native.query(codexShowPacket);
      else {
        const wait = imageUploadedAt + 1250 - Date.now();
        if (storedCodexFrameKey && wait > 0) {
          // Keep navigation responsive while the device finishes the previous
          // image. Only a changed picture waits; showing a cached page is immediate.
          if (cause !== 'data') await native.query(codexShowPacket);
          clearTimeout(imageRefreshTimer);
          imageRefreshTimer = setTimeout(() => {
            if (!closing && navigation.browsing && navigation.page === 'codex') {
              const expected = version;
              schedule(() => render(expected, 'data'));
            }
          }, wait);
        } else {
          clearTimeout(imageRefreshTimer);
          await native.showFrame(key);
          imageUploadedAt = Date.now(); storedCodexFrameKey = key;
        }
      }
    } else if (storedBannerText === `frame:${key}`) await native.query(codexShowPacket);
    else { await native.showFrame(key); storedBannerText = `frame:${key}`; }
  } else await hardwarePage(navigation.page);
  displayWrites++; lastDisplayAt = new Date().toISOString(); lastDisplayCause = cause;
  if (cause !== 'data') log(`display ${displayName} write-ack ${Math.round(performance.now() - requestedAt)}ms`);
  await status();
}

async function returnToBrowsing() {
  if (closing) return;
  suppressButton = true;
  try {
    // Old M701 firmware rejects 0x71/2. Disabling the selected mode makes it
    // move to the next enabled mode. Enable 7, temporarily disable controls,
    // verify 7, then restore controls without saving a firmware profile.
    await native.enable(7, true);
    for (const mode of snapshot.enabledControls) await native.enable(mode, false);
    if (await native.mode() !== 7) throw new Error('Could not enter information browsing mode');
    for (const mode of snapshot.enabledControls) await native.enable(mode, true);
    await delay(100);
    navigation.button(7);
  } finally { suppressButton = false; }
}

async function shutdown(reason = 'stopped') {
  if (closing) return;
  closing = true;
  clearInterval(interval); clearInterval(quotaInterval); clearInterval(hardwareInterval);
  clearTimeout(imageRefreshTimer);
  log(`stopping: ${reason}`);
  let restored = false;
  try {
    if (snapshot && native) {
      suppressButton = true;
      if ((await native.query([0x12, 0]))[10] !== Number(snapshot.profile)) throw new Error(`Switch back to keyboard profile ${snapshot.profile} and run recovery`);
      for (const key of [164, 165, 166]) await native.bind(key, 255);
      for (const mode of snapshot.enabledControls) await native.enable(mode, true);
      await native.enable(7, snapshot.browseOriginallyEnabled);
      if (Number.isInteger(snapshot.animationPreset)) await native.query([0x61, 0, 0, 0, snapshot.animationPreset]);
      if (keyboard) {
        await gear('50090001', snapshot.hardware);
        await writeFile(snapshot.hardwarePath, snapshot.hardwareOriginalText);
      }
      restored = true;
    }
  } catch (error) { log(`RESTORE REQUIRED: ${error.message}`); }
  finally {
    native?.close(); keyboard?.client.close();
    await status({ restored, reason }).catch(() => {});
    await lock.close();
    await rm(path.join(local, 'app.lock'), { force: true });
    await rm(path.join(local, 'stop'), { force: true });
    process.exitCode = restored || !snapshot ? 0 : 1;
  }
}

try {
  await rm(path.join(local, 'stop'), { force: true });
  keyboard = await findKeyboard();
  const device = await keyboard.client.request('10010001', keyboard.identity);
  const profile = keyboard.profiles?.data.find(item => item.value === device.profile_index);
  if (!profile || profile.value === '6') throw new Error('Select a writable Gear Link profile (1–5) first');
  const mapping = profile.lever.leverInfo;
  if ([mapping.leverUp, mapping.leverMid, mapping.leverDown].some(item => item.function !== 'Default')) throw new Error('Existing custom lever mapping must be preserved; automatic takeover stopped');
  const hardwarePath = path.join(keyboard.root, 'ROG AZOTH', keyboard.identity.sn, 'OLED', `Profile ${device.profile_index}`, 'HWInfo_Setting.txt');
  const hardwareOriginalText = await readFile(hardwarePath, 'utf8');
  const hardware = JSON.parse(hardwareOriginalText);
  const backupDirectory = path.join(local, `backup-${Date.now()}`);
  await mkdir(backupDirectory);
  await cp(path.dirname(hardwarePath), path.join(backupDirectory, 'OLED'), { recursive: true });
  snapshot = {
    profile: device.profile_index, hardware, hardwarePath, hardwareOriginalText,
    enabledControls: Object.entries(mapping.state).filter(([key, value]) => key !== '7' && value.enable).map(([key]) => Number(key)),
    browseOriginallyEnabled: mapping.state['7'].enable,
    state: mapping.state, identity: keyboard.identity,
    animationPreset: profile.oled.defaultAnimation ?? 0,
  };
  await writeFile(path.join(local, 'restore.json'), JSON.stringify(snapshot, null, 2));
  native = new NativeBridge();
  native.on('diagnostic', line => log(`HID: ${line.trim()}`));
  await native.ready;
  lastHardwarePage = 'temperature';
  await stopHardwarePage();
  sensors = await readHardware(keyboard.identity); sensorsAt = Date.now();
  void refreshQuota();
  await native.enable(7, true);
  for (const key of [164, 165, 166]) await native.bind(key, 0);
  await returnToBrowsing();
  native.on('button', ({ mode }) => {
    if (closing || suppressButton) return;
    navigation.button(mode);
    lastRequestedAt = performance.now();
    const expected = ++version;
    schedule(() => render(expected));
  });
  native.on('lever', ({ direction }) => {
    if (closing || suppressButton) return;
    const action = navigation.lever(direction);
    lastRequestedAt = performance.now();
    log(`lever ${direction} ${action.kind}`);
    if (action.kind === 'display') {
      const expected = ++version;
      schedule(() => render(expected));
    }
    status().catch(() => {});
  });
  native.on('disconnected', () => { if (!closing) shutdown('keyboard disconnected'); });
  await render();
  interval = setInterval(() => {
    access(path.join(local, 'stop')).then(() => schedule(() => shutdown())).catch(() => {});
    access(path.join(local, 'refresh-quota')).then(async () => {
      await rm(path.join(local, 'refresh-quota'), { force: true });
      void refreshQuota(true);
    }).catch(() => {});
    readFile(path.join(local, 'command.json'), 'utf8').then(async text => {
      await rm(path.join(local, 'command.json'), { force: true });
      const command = JSON.parse(text);
      if (!supportedPages.has(command.page) || !navigation.pages.includes(command.page)) return;
      const expected = ++version;
      lastRequestedAt = performance.now();
      schedule(async () => {
        if (!navigation.browsing) await returnToBrowsing();
        navigation.pageIndex = navigation.pages.indexOf(command.page);
        await render(expected);
      });
    }).catch(() => {});
    if (navigation.needsReturn() && !suppressButton && !closing && !returnPending) {
      returnPending = true;
      schedule(async () => {
        try {
          if (closing || !navigation.needsReturn()) return;
          await returnToBrowsing(); await render(++version);
        } finally { returnPending = false; }
      });
    }
  }, 250);
  quotaInterval = setInterval(() => {
    // A fixed polling tick must not be skipped merely because the previous
    // HTTP response completed a little later than its request started.
    void refreshQuota(true);
  }, config.codexRefreshMs);
  hardwareInterval = setInterval(() => { void refreshHardware(); }, config.hardwareRefreshMs);
  process.once('SIGINT', () => schedule(() => shutdown()));
  process.once('SIGTERM', () => schedule(() => shutdown()));
  log('ready');
} catch (error) { log(`startup failed: ${error.message}`); await shutdown(error.message); }
