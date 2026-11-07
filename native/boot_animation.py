"""Encode the approved startup GIFs for the M701's 208x64 grayscale decoder."""
from functools import lru_cache
from pathlib import Path
import struct
from PIL import Image


@lru_cache(maxsize=4)
def load_boot_animation(root, connection):
    if connection not in ('usb', 'wireless'):
        raise ValueError('Boot animation requires a supported connection')
    brand = 'windows'
    filename = Path(root) / 'assets' / 'boot' / f'{brand}.gif'
    frames, durations = [], []
    with Image.open(filename) as animation:
        for index in range(animation.n_frames):
            animation.seek(index)
            if animation.size != (208, 64):
                raise ValueError('Boot animation must be 208x64')
            duration = int(animation.info.get('duration', 100))
            if not 1 <= duration <= 65535:
                raise ValueError('Invalid boot animation frame duration')
            pixels = animation.convert('L').tobytes()
            frames.append(bytes((pixels[i] >> 4) | ((pixels[i + 1] >> 4) << 4) for i in range(0, len(pixels), 2)))
            durations.append(duration)
    if not 1 <= len(frames) <= 64:
        raise ValueError('Unsupported boot animation frame count')
    packed = struct.pack('<H', len(frames)) + struct.pack('<' + 'H' * len(frames), *durations) + b''.join(frames)
    return packed, {'brand': brand, 'frames': len(frames), 'durationMs': sum(durations)}
