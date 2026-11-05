"""Approved 208x46 monochrome Codex layout; pixels are packed as M701 expects."""
from functools import lru_cache
from pathlib import Path
import os
import struct
from PIL import Image, ImageDraw, ImageFont


@lru_cache(maxsize=12)
def font(size, numeric=False):
    filename = 'consola.ttf' if numeric else 'msyh.ttc'
    return ImageFont.truetype(str(Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Fonts' / filename), size)


def render_codex(model, root, display_mode='banner'):
    image = Image.new('L', (208, 46), 0)
    logo = Image.open(root / 'assets' / 'chatgpt.png').convert('RGBA')
    image.paste(255, (0, 7, 32, 39), logo.getchannel('A'))
    draw = ImageDraw.Draw(image)
    draw.line((39, 4, 39, 41), fill=85)
    def text(value, xy, size, numeric=False, fill=255):
        draw.text(xy, value, font=font(size, numeric), fill=fill)
    text('周剩余', (48, 0), 11, fill=204)
    value = '--%' if model.get('remaining') is None else str(model['remaining']) + '%'
    text(value, (47, 13), 26, True)
    text('下次重置', (116, 0), 11, fill=204)
    text(model.get('resetDate', '--/--'), (116, 17), 14, True)
    text(model.get('resetTime', '--:--'), (162, 17), 14, True)
    text(model.get('footer', '北京时间'), (116, 34), 10, fill=170)
    if display_mode == 'image':
        canvas = Image.new('L', (208, 64), 0)
        canvas.paste(image, (0, 9))
        image = canvas
    elif display_mode != 'banner':
        raise ValueError('Unsupported Codex display mode')
    # Original Gear Link conversion was checked byte-for-byte: the left pixel
    # occupies the low nibble, the right pixel the high nibble.
    pixels = image.tobytes()
    packed = bytes((pixels[i] >> 4) | ((pixels[i + 1] >> 4) << 4) for i in range(0, len(pixels), 2))
    if display_mode == 'image':
        packed = struct.pack('<HH', 1, 1000) + packed
    return image, packed
