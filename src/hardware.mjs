import net from 'node:net';

// The installed Gear Link agent returns a fresh sensor snapshot on this local
// socket. Reading it independently avoids restarting the OLED's 3-second timer.
export async function readHardware(identity, timeout = 1500) {
  return await new Promise((resolve, reject) => {
    let buffer = '';
    const socket = net.connect(8300, '127.0.0.1', () => {
      socket.write(JSON.stringify({ ...identity, class_id: '10080000' }));
    });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Hardware sensor read timed out')); }, timeout);
    socket.on('error', () => { clearTimeout(timer); reject(new Error('Gear Link sensor agent unavailable')); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 262144) { clearTimeout(timer); socket.destroy(); reject(new Error('Unexpected sensor response size')); return; }
      let value;
      try { value = JSON.parse(buffer); } catch { return; }
      clearTimeout(timer); socket.destroy();
      if (value.class_id !== '10080001') { reject(new Error('Unexpected sensor response')); return; }
      resolve({
        temperature: { cpu: sensor(value.cpu_temp_array), gpu: sensor(value.gpu_temp_array) },
        utilization: { cpu: sensor(value.cpu_usage_array), gpu: sensor(value.gpu_usage_array) },
      });
    });
  });
}

function sensor(values) {
  const raw = values?.[0];
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 65535 ? Math.round(value) : null;
}

export function hardwarePacket(page, snapshot) {
  if (!['temperature', 'utilization'].includes(page)) throw new Error('Unknown hardware page');
  const values = snapshot?.[page];
  if (!Number.isFinite(values?.cpu) || !Number.isFinite(values?.gpu)) return null;
  const type = page === 'temperature' ? 1 : 0;
  return [0x66, 0, 1, 0,
    type, 0, values.cpu & 255, values.cpu >> 8,
    type + 16, 0, values.gpu & 255, values.gpu >> 8,
  ];
}
