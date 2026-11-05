"""M701-only HID transport. Emits lever events, never ordinary keyboard input."""
import json
import os
from pathlib import Path
import sys
import threading
import time
import hashlib
import struct

for stream in (sys.stdin, sys.stdout, sys.stderr):
    if stream is not None and hasattr(stream, 'reconfigure'):
        stream.reconfigure(encoding='utf-8')

root = Path(sys.executable).resolve().parents[2] if getattr(sys, 'frozen', False) else Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / '.tools' / 'python'))
import hid
from codex_frame import render_codex

output_lock = threading.Lock()
stop = threading.Event()


def emit(value):
    with output_lock:
        print(json.dumps(value), flush=True)


class Keyboard:
    def __init__(self):
        devices = hid.enumerate(0x0B05, 0x1A83)
        control = next(d for d in devices if d['usage_page'] == 0xFF00)
        event = next(d for d in devices if d['usage_page'] == 0xFFC0)
        self.control = hid.device()
        self.events = hid.device()
        self.control.open_path(control['path'])
        self.events.open_path(event['path'])
        self.frames = {}
        self.image_ready_at = 0

    def query(self, payload):
        if not payload or len(payload) > 64:
            raise ValueError('Invalid M701 payload length')
        # Only commands researched for this device; no flash, reset or profile-save.
        if payload[0] not in (0x12, 0x22, 0x25, 0x51, 0x61, 0x62, 0x66, 0x68, 0x69, 0x71):
            raise ValueError('Command outside OLED/lever adapter scope')
        self.control.write(bytes([0] + payload + [0] * (64 - len(payload))))
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            reply = self.control.read(65, 100)
            if reply[:2] == [255, 170]:
                raise RuntimeError(f'M701 firmware rejected command {bytes(payload[:4]).hex()}; reply {bytes(reply[:8]).hex()}')
            match = 4 if payload[:2] in ([0x62, 1], [0x61, 2]) else 2
            if reply[:match] == payload[:match]:
                return reply
        raise TimeoutError('M701 did not acknowledge command')

    def enable_mode(self, mode, enabled):
        return self.query([0x71, 0, 0, 0, mode, int(enabled)])

    def bind(self, key, target):
        return self.query([0x71, 1, 0, 0, 7, key & 255, key >> 8, target & 255, target >> 8])

    def prepare_frame(self, model, display_mode='banner'):
        image, packed = render_codex(model, root, display_mode)
        key = hashlib.sha256(display_mode.encode() + packed).hexdigest()[:16]
        if len(self.frames) >= 8:
            self.frames.pop(next(iter(self.frames)))
        self.frames[key] = (display_mode, packed)
        preview = root / '.local' / 'codex-preview.png'
        preview.parent.mkdir(exist_ok=True)
        image.save(preview)
        return key

    def show_frame(self, key):
        display_mode, packed = self.frames[key]
        packets = (len(packed) + 59) // 60
        if display_mode == 'image':
            # The firmware acknowledges SHOW before the image buffer has settled.
            # A second upload immediately afterwards fails partway through.
            time.sleep(max(0, self.image_ready_at - time.monotonic()))
            self.query([0x61, 1, 0, 0] + list(struct.pack('<I', packets)))
            for index in range(packets):
                remaining = packets - index - 1
                self.query([0x61, 2, remaining & 255, remaining >> 8] + list(packed[index * 60:(index + 1) * 60]))
            self.query([0x61, 3, 0, 0])
            self.image_ready_at = time.monotonic() + 1.2
            return True
        self.query([0x62, 0, 0, 0, 0, 0, 208, 0, 46, 0, packets, 0])
        for index in range(packets):
            remaining = packets - index - 1
            self.query([0x62, 1, remaining & 255, remaining >> 8] + list(packed[index * 60:(index + 1) * 60]))
        self.query([0x62, 2, 0, 0])
        return True

    def close(self):
        stop.set()
        self.events.close()
        self.control.close()


def event_loop(keyboard):
    try:
        previous = 0
        while not stop.is_set():
            data = keyboard.events.read(65, 150)
            if len(data) < 5:
                continue
            if data[1] == 0x91:
                emit({'event': 'button', 'mode': data[4]})
            elif data[1] == 0x72:
                flags = data[2] & 7
                for mask, name in ((1, 'up'), (4, 'down'), (2, 'press')):
                    if flags & mask and not previous & mask:
                        emit({'event': 'lever', 'direction': name})
                previous = flags
    except Exception as error:
        if not stop.is_set():
            emit({'event': 'disconnected', 'error': str(error)})


def test_single_mode(keyboard):
    """Temporary 60-second capability check, with unconditional mapping restoration."""
    profile_path = Path(os.environ['LOCALAPPDATA']) / 'ASUS/Gear Link/KB/HTML/M701'
    import base64
    profiles_file = next(profile_path.glob('*/m701-PROFILES-DATA'))
    profiles = json.loads(base64.b64decode(profiles_file.read_text()))
    active = keyboard.query([0x12, 0])[10]
    original = next(p for p in profiles['data'] if int(p['value']) == active)
    state = original['lever']['leverInfo']['state']
    if any(original['lever']['leverInfo'][key].get('function') != 'Default'
           for key in ('leverUp', 'leverMid', 'leverDown')):
        raise RuntimeError('Custom lever mapping exists: automatic test refused')
    backup = root / '.local' / 'single-mode-backup.json'
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps({'profile': active, 'state': state}), encoding='utf-8')
    try:
        keyboard.enable_mode(7, True)
        for mode in range(7):
            if state[str(mode)]['enable']:
                keyboard.enable_mode(mode, False)
        for key in (164, 165, 166):
            keyboard.bind(key, 0)
        emit({'event': 'single-mode-ready', 'duration': 60})
        time.sleep(60)
    finally:
        for key in (164, 165, 166):
            keyboard.bind(key, 255)
        for mode in range(8):
            if state[str(mode)]['enable'] or mode == 7:
                keyboard.enable_mode(mode, state[str(mode)]['enable'])
        emit({'event': 'single-mode-restored'})


if __name__ == '__main__':
    keyboard = Keyboard()
    threading.Thread(target=event_loop, args=(keyboard,), daemon=True).start()
    try:
        if '--test-single-mode' in sys.argv:
            test_single_mode(keyboard)
        else:
            emit({'event': 'ready'})
            for line in sys.stdin:
                message = json.loads(line)
                try:
                    if message.get('op') == 'prepare-codex':
                        result = keyboard.prepare_frame(message['model'], message.get('displayMode', 'banner'))
                    elif message.get('op') == 'show-frame':
                        result = keyboard.show_frame(message['key'])
                    else:
                        result = keyboard.query(message['payload'])
                    emit({'id': message['id'], 'result': result})
                except Exception as error:
                    emit({'id': message['id'], 'error': str(error)})
    finally:
        keyboard.close()
