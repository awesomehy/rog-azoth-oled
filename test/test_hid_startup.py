"""Validate initialization bytes against the M701 image decoder contract."""
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from hid_bridge import Keyboard


class StartupFrameTests(unittest.TestCase):
    def test_initialization_uploads_one_valid_208x64_frame_without_power_commands(self):
        keyboard = Keyboard.__new__(Keyboard)
        keyboard.image_ready_at = 0
        keyboard.data_chunk_size = 60
        packets = []
        keyboard.query = lambda packet: packets.append(packet)
        self.assertTrue(keyboard.initialize_display())
        self.assertEqual(packets[0][:4], [0x61, 1, 0, 0])
        count = struct.unpack('<I', bytes(packets[0][4:]))[0]
        chunks = packets[1:-1]
        self.assertEqual(count, 111)
        self.assertEqual(len(chunks), count)
        packed = bytearray()
        for index, packet in enumerate(chunks):
            self.assertEqual(packet[:2], [0x61, 2])
            self.assertEqual(packet[2] | packet[3] << 8, count - index - 1)
            self.assertEqual(len(packet), 64)
            packed.extend(packet[4:])
        self.assertEqual(struct.unpack('<HH', packed[:4]), (1, 1000))
        self.assertEqual(len(packed[4:]), 208 * 64 // 2)
        self.assertEqual(set(packed[4:]), {0})
        self.assertEqual(packets[-1], [0x61, 3, 0, 0])


if __name__ == '__main__':
    unittest.main()
