import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function pythonExecutable() {
  if (process.env.AZOTH_PYTHON) return process.env.AZOTH_PYTHON;
  const bundled = path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  return existsSync(bundled) ? bundled : 'python';
}

export class NativeBridge extends EventEmitter {
  constructor() {
    super();
    this.nextId = 1;
    this.pending = new Map();
    this.queue = Promise.resolve();
    const packaged = path.join(root, 'runtime', 'azoth-hid', 'azoth-hid.exe');
    const executable = existsSync(packaged) ? packaged : pythonExecutable();
    const args = existsSync(packaged) ? [] : ['-u', path.join(root, 'native', 'hid_bridge.py')];
    this.child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('M701 HID adapter startup timed out')), 5000);
      this.once('ready', () => { clearTimeout(timer); resolve(); });
      this.child.once('error', () => { clearTimeout(timer); reject(new Error('Python HID adapter could not start')); });
      this.child.once('exit', () => { clearTimeout(timer); reject(new Error('Python HID adapter exited')); });
    });
    this.child.stdout.on('data', data => {
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.event) this.emit(message.event, message);
        else {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer); this.pending.delete(message.id);
          message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.result);
        }
      }
    });
    this.child.stderr.on('data', data => this.emit('diagnostic', data.toString()));
    this.child.on('exit', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('HID adapter exited')); }
      this.pending.clear();
      this.emit('disconnected', {});
    });
  }
  query(payload) {
    return this.request({ payload });
  }
  request(message) {
    const operation = this.queue.then(async () => {
      await this.ready;
      return await new Promise((resolve, reject) => {
        const id = this.nextId++;
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('HID request timed out')); }, 4000);
        this.pending.set(id, { resolve, reject, timer });
        this.child.stdin.write(JSON.stringify({ id, ...message }) + '\n');
      });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  prepareCodex(model, displayMode = 'banner') { return this.request({ op: 'prepare-codex', model, displayMode }); }
  showFrame(key) { return this.request({ op: 'show-frame', key }); }
  enable(mode, enabled) { return this.query([0x71, 0, 0, 0, mode, Number(enabled)]); }
  bind(key, target) { return this.query([0x71, 1, 0, 0, 7, key & 255, key >> 8, target & 255, target >> 8]); }
  async mode() { return (await this.query([0x22, 1]))[4]; }
  close() { this.child.stdin.end(); }
}
