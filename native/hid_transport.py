"""M701 endpoint selection, including its keyboard channel on an OMNI receiver."""
import time

VID = 0x0B05
PRODUCTS = {6787: 'usb', 6789: 'wireless', 6791: 'bluetooth'}
OMNI_PRODUCTS = (6862,)


def report_ids(descriptor):
    """Read HID Report ID global items without inspecting keyboard reports."""
    result = set()
    offset = 0
    while offset < len(descriptor):
        prefix = descriptor[offset]
        offset += 1
        if prefix == 0xFE:
            if offset + 2 > len(descriptor):
                break
            offset += descriptor[offset] + 2
            continue
        size = (0, 1, 2, 4)[prefix & 3]
        if offset + size > len(descriptor):
            break
        if prefix == 0x85 and size == 1:
            result.add(descriptor[offset])
        offset += size
    return result or {0}


def paired_channels(device):
    # Read-only receiver query researched in Gear Link's GetPairingInfo class.
    device.write(bytes([1, 0xA0, 0] + [0] * 61))
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        reply = device.read(65, 100)
        if reply[:3] == [1, 0xA0, 0] and len(reply) >= 13:
            return [(reply[i] | reply[i + 1] << 8, reply[i + 2], reply[i + 3]) for i in (5, 9)]
    raise TimeoutError('OMNI receiver did not return its paired keyboard channel')


class HidTransport:
    def __init__(self, control, events, product_id, physical_id, control_report=0, event_report=None):
        self.control = control
        self.events = events
        self.control_report = control_report
        self.event_report = event_report
        self.payload_size = 63 if control_report else 64
        self.metadata = {
            'kind': PRODUCTS[product_id], 'productId': product_id,
            'physicalProductId': physical_id, 'controlReportId': control_report,
            'eventReportId': event_report,
        }

    def write(self, payload):
        if len(payload) > self.payload_size:
            raise ValueError('Payload exceeds the selected HID report size')
        self.control.write(bytes([self.control_report] + list(payload) + [0] * (self.payload_size - len(payload))))

    def read(self, timeout=100):
        reply = self.control.read(65, timeout)
        if self.control_report:
            return reply[1:] if reply and reply[0] == self.control_report else []
        return reply


def open_transport(hid, product_id=None):
    if product_id is not None and product_id not in PRODUCTS:
        raise ValueError('Unsupported keyboard product ID')
    devices = hid.enumerate(VID, 0)
    for pid in ([product_id] if product_id else PRODUCTS):
        controls = [d for d in devices if d['product_id'] == pid and d.get('usage_page') == 0xFF00]
        events = [d for d in devices if d['product_id'] == pid and d.get('usage_page') == 0xFFC0]
        if controls and events:
            control_info = controls[0]
            matches = [d for d in events if d.get('serial_number') == control_info.get('serial_number')]
            if len(matches) != 1:
                raise RuntimeError('Ambiguous M701 event interface')
            control, event = hid.device(), hid.device()
            try:
                control.open_path(control_info['path'])
                event.open_path(matches[0]['path'])
                ids = report_ids(control.get_report_descriptor())
                if len(ids) != 1:
                    raise RuntimeError('Ambiguous M701 control report')
                return HidTransport(control, event, pid, pid, next(iter(ids)))
            except Exception:
                control.close()
                event.close()
                raise
        if pid != 6789:
            continue
        managers = [d for d in devices if d['product_id'] in OMNI_PRODUCTS and d.get('usage_page') == 0xFF02]
        for manager in managers:
            management = hid.device()
            try:
                management.open_path(manager['path'])
                channels = paired_channels(management)
            finally:
                management.close()
            keyboard = next((item for item in channels if item[0] == pid), None)
            if keyboard is None:
                continue
            _, control_id, event_id = keyboard
            serial = manager.get('serial_number')
            if not serial and len(managers) != 1:
                raise RuntimeError('Ambiguous OMNI receiver; no unique serial number')
            peers = [d for d in devices if d['product_id'] == manager['product_id']
                     and (not serial or d.get('serial_number') == serial)]
            control, event = None, None
            try:
                for page, report, is_control in ((0xFF00, control_id, True), (0xFFC0, event_id, False)):
                    candidates = [d for d in peers if d.get('usage_page') == page]
                    for candidate in candidates:
                        handle = hid.device()
                        handle.open_path(candidate['path'])
                        if report in report_ids(handle.get_report_descriptor()):
                            if is_control:
                                control = handle
                            else:
                                event = handle
                            break
                        handle.close()
                if control is None or event is None:
                    raise RuntimeError('Paired M701 receiver interfaces not found')
                return HidTransport(control, event, pid, manager['product_id'], control_id, event_id)
            except Exception:
                if control:
                    control.close()
                if event:
                    event.close()
                raise
    if product_id == 6791 or any(d['product_id'] == 6791 for d in devices):
        raise RuntimeError('M701 Bluetooth exposes no supported OLED control/event interface')
    raise RuntimeError('Connected M701 USB or paired 2.4GHz control interface not found')
