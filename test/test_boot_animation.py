from pathlib import Path
import struct
import sys
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
from boot_animation import load_boot_animation


class BootAnimationTests(unittest.TestCase):
    def test_both_connections_use_windows_and_preserve_all_gif_frames(self):
        for connection, brand in (('usb', 'windows'), ('wireless', 'windows')):
            packed, metadata = load_boot_animation(ROOT, connection)
            self.assertEqual(metadata['brand'], brand)
            count = struct.unpack('<H', packed[:2])[0]
            self.assertEqual(count, 36)
            durations = struct.unpack('<' + 'H' * count, packed[2:2 + count * 2])
            self.assertEqual(durations, (60,) * 36)
            self.assertEqual(metadata['durationMs'], 2160)
            self.assertEqual(len(packed), 2 + count * 2 + count * 6656)
            with Image.open(ROOT / 'assets' / 'boot' / f'{brand}.gif') as animation:
                for index in range(count):
                    animation.seek(index)
                    start = 2 + count * 2 + index * 6656
                    data = packed[start:start + 6656]
                    decoded = bytes(pixel for byte in data for pixel in (byte & 15, byte >> 4))
                    self.assertEqual(decoded, bytes(pixel >> 4 for pixel in animation.convert('L').tobytes()))

    def test_unsupported_connection_is_not_misidentified_as_an_operating_system(self):
        with self.assertRaises(ValueError):
            load_boot_animation(ROOT, 'bluetooth')


if __name__ == '__main__':
    unittest.main()
