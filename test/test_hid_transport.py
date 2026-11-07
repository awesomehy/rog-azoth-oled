"""Regression tests for keyboard routing and the OMNI report-size difference."""
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'native'))
from hid_transport import HidTransport, open_transport, report_ids
from hid_bridge import Keyboard


class FakeHandle:
    def __init__(self, owner):
        self.owner = owner
        self.path = None

    def open_path(self, path):
        self.path = path
        self.owner.opened.append(path)

    def get_report_descriptor(self):
        return self.owner.descriptors[self.path]

    def write(self, value):
        self.owner.writes.append((self.path, bytes(value)))

    def read(self, *_):
        return self.owner.responses[self.path].pop(0)

    def close(self):
        pass


class FakeHid:
    def __init__(self, devices, descriptors=None, responses=None):
        self.devices = devices
        self.descriptors = descriptors or {}
        self.responses = responses or {}
        self.opened = []
        self.writes = []

    def enumerate(self, *_):
        return self.devices

    def device(self):
        return FakeHandle(self)


def endpoint(pid, page, path, serial='TEST_RECEIVER'):
    return {'vendor_id': 2821, 'product_id': pid, 'usage_page': page,
            'path': path, 'serial_number': serial}


class HidTransportTests(unittest.TestCase):
    def test_usb_keeps_64_payload_bytes_and_does_not_open_standard_key_input(self):
        hid = FakeHid([endpoint(6787, 1, 'keys'), endpoint(6787, 0xFF00, 'control'),
                       endpoint(6787, 0xFFC0, 'events')], {'control': bytes([0x75, 8, 0x95, 64])})
        transport = open_transport(hid, 6787)
        transport.write([0x61, 2] + [0] * 62)
        self.assertEqual(len(hid.writes[-1][1]), 65)
        self.assertEqual(hid.writes[-1][1][0], 0)
        self.assertNotIn('keys', hid.opened)
        self.assertEqual(transport.metadata['kind'], 'usb')

    def test_omni_routes_only_to_the_paired_m701_keyboard_and_strips_report_id(self):
        pairing = [1, 0xA0, 0, 0, 0, 6789 & 255, 6789 >> 8, 2, 4, 6804 & 255, 6804 >> 8, 3, 5]
        hid = FakeHid([endpoint(6862, 0xFF02, 'manager'), endpoint(6862, 0xFF00, 'keyboard'),
                       endpoint(6862, 0xFFC0, 'events'), endpoint(6862, 0xFF01, 'mouse')],
                      {'keyboard': bytes([0x85, 2]), 'events': bytes([0x85, 4])},
                      {'manager': [pairing], 'keyboard': [[2, 0x22, 1, 0, 0, 7]]})
        transport = open_transport(hid, 6789)
        self.assertEqual(transport.metadata['physicalProductId'], 6862)
        self.assertEqual(transport.payload_size, 63)
        transport.write([0x22, 1])
        self.assertEqual(hid.writes[-1][0], 'keyboard')
        self.assertEqual(hid.writes[-1][1][:3], bytes([2, 0x22, 1]))
        self.assertEqual(len(hid.writes[-1][1]), 64)
        self.assertEqual(transport.read(), [0x22, 1, 0, 0, 7])
        self.assertNotIn('mouse', hid.opened)
        with self.assertRaises(ValueError):
            transport.write([0] * 64)

    def test_bluetooth_without_vendor_endpoints_is_reported_without_reading_typing(self):
        hid = FakeHid([endpoint(6791, 1, 'keys'), endpoint(6791, 12, 'consumer')])
        with self.assertRaisesRegex(RuntimeError, 'Bluetooth exposes no supported OLED'):
            open_transport(hid, 6791)
        self.assertEqual(hid.opened, [])
        self.assertEqual(hid.writes, [])

    def test_wireless_frame_reassembly_preserves_every_byte_at_59_bytes_per_chunk(self):
        packed = struct.pack('<HH', 1, 1000) + bytes(n % 256 for n in range(6656))
        for chunk_size, expected_count in ((60, 111), (59, 113)):
            keyboard = Keyboard.__new__(Keyboard)
            keyboard.data_chunk_size = chunk_size
            keyboard.image_ready_at = 0
            packets = []
            keyboard.query = lambda packet: packets.append(packet)
            keyboard.upload_image(packed)
            self.assertEqual(struct.unpack('<I', bytes(packets[0][4:]))[0], expected_count)
            chunks = packets[1:-1]
            self.assertEqual(len(chunks), expected_count)
            self.assertTrue(all(len(packet) <= chunk_size + 4 for packet in chunks))
            self.assertEqual(bytes(value for packet in chunks for value in packet[4:]), packed)
            self.assertEqual(packets[-1], [0x61, 3, 0, 0])

    def test_report_id_parser_does_not_confuse_data_bytes_with_global_items(self):
        self.assertEqual(report_ids(bytes([0x09, 0x85, 0x85, 2, 0x75, 8])), {2})
        self.assertEqual(report_ids(bytes([0x75, 8, 0x95, 64])), {0})


if __name__ == '__main__':
    unittest.main()
