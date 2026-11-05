import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export class GearLink {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      let value;
      try { value = JSON.parse(data); } catch { return; }
      const responseId = String(value.class_id);
      const requestId = responseId === '10000' && this.pending.has('10010001') ? '10010001' : responseId;
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.resolve(value);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Gear Link connection closed'));
      }
      this.pending.clear();
    });
  }

  static async connect(port, timeout = 2000) {
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://localhost:${port}/`);
      const timer = setTimeout(() => { socket.close(); reject(new Error(`Gear Link port ${port} unavailable`)); }, timeout);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(new GearLink(socket)); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`Gear Link port ${port} unavailable`)); }, { once: true });
    });
  }

  async request(classId, args = {}, timeout = 15000) {
    const key = String(classId);
    if (this.pending.has(key)) throw new Error(`Duplicate pending Gear Link request ${key}`);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(key); reject(new Error(`Gear Link ${key} timed out`)); }, timeout);
      this.pending.set(key, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ ...args, class_id: key })); }
      catch (error) { clearTimeout(timer); this.pending.delete(key); reject(error); }
    });
  }

  close() { this.socket.close(); }
}

export async function findKeyboard() {
  const root = path.join(process.env.LOCALAPPDATA, 'ASUS', 'Gear Link', 'KB');
  const model = 'ROG AZOTH';
  const candidates = await readdir(path.join(root, model), { withFileTypes: true });
  for (const candidate of candidates.filter(item => item.isDirectory())) {
    const identity = { vid: '2821', pid: '6787', sn: candidate.name };
    let service;
    try {
      service = await GearLink.connect(8000);
      const info = await service.request('60010000', identity, 3000);
      if (!info.port || Number(info.port) < 0) continue;
      const client = await GearLink.connect(Number(info.port));
      const profilesPath = path.join(root, 'HTML', 'M701', candidate.name, 'm701-PROFILES-DATA');
      let profiles;
      try { profiles = JSON.parse(Buffer.from(await readFile(profilesPath, 'utf8'), 'base64').toString('utf8')); } catch {}
      return { client, identity, info, profiles, root };
    } finally { service?.close(); }
  }
  throw new Error('Connected ROG AZOTH M701 not found in Gear Link');
}
