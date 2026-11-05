"""Regression checks for the fixed-width M701 custom-image decoder."""
from pathlib import Path
import struct
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'native'))
from codex_frame import render_codex


class CodexFrameTests(unittest.TestCase):
    def test_animation_has_208_pixel_stride_and_native_frame_header(self):
        image, data = render_codex({'remaining': 98}, ROOT, 'image')
        self.assertEqual(image.size, (208, 64))
        self.assertEqual(struct.unpack('<HH', data[:4]), (1, 1000))
        self.assertEqual(len(data), 6660)
        self.assertEqual(len(data) // 60, 111)
        decoded = bytes(pixel for byte in data[4:] for pixel in (byte & 15, byte >> 4))
        self.assertEqual(decoded, bytes(value >> 4 for value in image.tobytes()))

    def test_full_image_preserves_approved_layout_and_clears_header_area(self):
        model = {'remaining': 100, 'resetDate': '11/12', 'resetTime': '22:24', 'footer': '北京时间'}
        banner, _ = render_codex(model, ROOT, 'banner')
        full, _ = render_codex(model, ROOT, 'image')
        self.assertEqual(full.crop((0, 9, 208, 55)).tobytes(), banner.tobytes())
        self.assertIsNone(full.crop((0, 0, 208, 9)).getbbox())
        self.assertIsNone(full.crop((0, 55, 208, 64)).getbbox())


if __name__ == '__main__':
    unittest.main()
