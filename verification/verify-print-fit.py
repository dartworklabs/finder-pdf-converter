#!/usr/bin/env python3
"""Exercise native print-to-PDF geometry against the currently selected printer.

Run on macOS with PyMuPDF installed: python3 verification/verify-print-fit.py
An optional first argument selects a renderer, for regression mutation checks.
No physical print job is submitted.
"""
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parent.parent
RENDERER = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'print-fit.js'
COLORS = ((1, 0, 0), (0, 0.7, 0), (0, 0, 1), (0, 0, 0))


def printer_geometry():
    """Read native paper and imageable bounds independently of the renderer."""
    script = '''ObjC.import("AppKit"); function run() { let p=$.NSPrintInfo.sharedPrintInfo; return JSON.stringify({paper:ObjC.deepUnwrap(p.paperSize), area:ObjC.deepUnwrap(p.imageablePageBounds)}); }'''
    result = subprocess.check_output(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], text=True)
    return json.loads(result)


def fixtures(directory):
    """Create ordered pages with distinct corner marks, rotations, and offset CropBoxes."""
    cases = [(300, 400, 0), (1100, 1500, 0), (1500, 1100, 0), (1100, 1500, 90), (300, 400, 270)]
    paths = []
    for group, entries in enumerate((cases[:2], cases[2:])):
        doc = fitz.open()
        for width, height, rotation in entries:
            page = doc.new_page(width=width + 140, height=height + 180)
            crop = fitz.Rect(50, 70, 50 + width, 70 + height)
            marker = 16
            for (x, y), color in zip(((crop.x0, crop.y0), (crop.x1-marker, crop.y0),
                                      (crop.x0, crop.y1-marker), (crop.x1-marker, crop.y1-marker)), COLORS):
                page.draw_rect(fitz.Rect(x, y, x + marker, y + marker), color=color, fill=color)
            page.set_cropbox(crop)
            page.set_rotation(rotation)
        path = directory / f'input-{group}.pdf'
        doc.save(path)
        paths.append(path)
    return paths


def markers(page):
    """Locate each uniquely colored corner in the page raster, in top-left coordinates."""
    pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False, colorspace=fitz.csRGB)
    positions = [[] for _ in COLORS]
    samples = pix.samples
    for y in range(pix.height):
        for x in range(pix.width):
            i = (y * pix.width + x) * 3
            r, g, b = samples[i:i+3]
            if r > 180 and g < 80 and b < 80:
                positions[0].append((x, y))
            elif g > 90 and r < 80 and b < 80:
                positions[1].append((x, y))
            elif b > 180 and r < 80 and g < 80:
                positions[2].append((x, y))
            elif max(r, g, b) < 50:
                positions[3].append((x, y))
    assert all(positions), 'a corner marker was lost'
    return [((sum(x for x, _ in pos) / len(pos), sum(y for _, y in pos) / len(pos)),
             (min(x for x, _ in pos), min(y for _, y in pos), max(x for x, _ in pos), max(y for _, y in pos)))
            for pos in positions]


def check_geometry(paths, output, geometry):
    """Compare rendered marker positions with independent fit and rotation calculations."""
    paper, area = geometry['paper'], geometry['area']
    pw, ph = paper['width'], paper['height']
    ax, ay = area['origin']['x'], area['origin']['y']
    aw, ah = area['size']['width'], area['size']['height']
    assert 0 <= ax and 0 <= ay and aw > 0 and ah > 0
    sources = [fitz.open(path) for path in paths]
    pages = [page for doc in sources for page in doc]
    result = fitz.open(output)
    assert len(result) == len(pages), 'batch lost or added pages'
    for index, (source, actual) in enumerate(zip(pages, result)):
        assert abs(actual.rect.width-pw) < 0.1 and abs(actual.rect.height-ph) < 0.1
        sw, sh = source.rect.width, source.rect.height
        plain = min(1, aw/sw, ah/sh)
        turned = min(1, aw/sh, ah/sw)
        rotate = turned > plain + 1e-9
        scale = turned if rotate else plain
        width, height = ((sh, sw) if rotate else (sw, sh))
        # fitz reports from the top; NSPrintInfo reports from the bottom.
        left = ax + (aw-width*scale)/2
        top = ph - (ay + ah/2) - height*scale/2
        for (source_point, _), (actual_point, bbox) in zip(markers(source), markers(actual)):
            sx, sy = source_point
            tx, ty = (sy, sw-sx) if rotate else (sx, sy)
            expected = (left + tx*scale, top + ty*scale)
            assert math.dist(expected, actual_point) < 3, (index, expected, actual_point, scale, rotate)
            assert ax - 1 <= bbox[0] and bbox[2] <= ax + aw + 1
            assert ph-ay-ah-1 <= bbox[1] and bbox[3] <= ph-ay+1
    for doc in sources:
        doc.close()
    result.close()


def main():
    """Print synthetic PDFs to a private proof and verify all marker placements."""
    geometry = printer_geometry()
    with tempfile.TemporaryDirectory(prefix='print-fit-test-') as tmp:
        directory = Path(tmp)
        paths = fixtures(directory)
        proof = directory / 'proof.pdf'
        subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(RENDERER), '--proof', str(proof), '--',
                        *(str(path) for path in paths)], check=True)
        check_geometry(paths, proof, geometry)
    print('PASS: all pages match paper, printable area, shrink-only fit, rotation and input order')
    print('Printer geometry:', json.dumps(geometry))


if __name__ == '__main__':
    main()
