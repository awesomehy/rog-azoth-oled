import { findKeyboard } from './gearlink.mjs';
import { readCodexUsage } from './usage-api.mjs';
import { readFile, writeFile, rename } from 'node:fs/promises';

const command = process.argv[2] ?? 'inspect';
try {
  if (command === 'quota') {
    const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify(await readCodexUsage(config.codexUsage), null, 2));
  } else if (command === 'show') {
    const page = process.argv[3];
    if (!['temperature', 'utilization', 'codex'].includes(page)) throw new Error('Use show temperature, show utilization or show codex');
    await writeFile(new URL('../.local/command.tmp', import.meta.url), JSON.stringify({ page }));
    await rename(new URL('../.local/command.tmp', import.meta.url), new URL('../.local/command.json', import.meta.url));
    console.log(`Requested display page: ${page}`);
  } else if (command === 'inspect') {
    const keyboard = await findKeyboard();
    try {
      const device = await keyboard.client.request('10010001', keyboard.identity);
      const mode = await keyboard.client.request('10020001', keyboard.identity);
      const kind = { '6787': 'USB', '6789': '2.4GHz', '6791': 'Bluetooth' }[keyboard.identity.pid];
      console.log(JSON.stringify({ device, mode, connection: { kind, gearLinkPort: keyboard.info.port } }, null, 2));
    } finally { keyboard.client.close(); }
  } else throw new Error('Use inspect or quota');
} catch (error) { console.error(error.message); process.exitCode = 1; }
