import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

async function atomicJson(file, value) {
  await writeFile(`${file}.tmp`, JSON.stringify(value) + '\n');
  await rename(`${file}.tmp`, file);
}

function checkHardwarePath(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)
    || path.basename(file) !== 'HWInfo_Setting.txt') throw new Error('Invalid pending hardware settings path');
}

export class BootState {
  constructor(local) {
    this.file = path.join(local, 'boot-state.json');
    this.hardwareFile = path.join(local, 'boot-hardware.json');
  }

  async matches(animation, identity, profile, connection) {
    const state = await readJson(this.file);
    return state?.slot === 'boot' && state.key === animation.key && state.brand === animation.brand
      && state.sn === identity.sn && state.profile === String(profile) && state.connection === connection;
  }

  async commit(animation, identity, profile, connection) {
    await atomicJson(this.file, { slot: 'boot', ...animation, sn: identity.sn, profile: String(profile), connection });
  }

  async invalidate() { await atomicJson(this.file, { slot: 'runtime' }); }

  async rememberHardware(snapshot, root) {
    checkHardwarePath(snapshot.hardwarePath, root);
    await atomicJson(this.hardwareFile, { path: snapshot.hardwarePath, text: snapshot.hardwareOriginalText });
  }

  async restoreHardwareFile(root) {
    const pending = await readJson(this.hardwareFile);
    if (!pending) return;
    if (typeof pending.path !== 'string' || typeof pending.text !== 'string') throw new Error('Invalid pending hardware settings');
    checkHardwarePath(pending.path, root);
    await writeFile(pending.path, pending.text);
    await rm(this.hardwareFile, { force: true });
  }
}
