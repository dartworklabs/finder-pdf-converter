#!/usr/bin/env python3
"""Verify a synthetic native spool PDF's order, shrink-only fit and visible marks.

Requires test-only PyMuPDF (``import pymupdf``). Example:
  python verify-captured-print.py capture.pdf order.pdf edge.pdf \
      --expected-labels Order2,Edge3,Edge1
Optional --imageable X Y WIDTH HEIGHT supplies independent selected-printer
bounds in PDF top-left coordinates; without it, exact driver margins are not
claimed. Inputs must be synthetic fixtures from print-capture.py, not private
documents: each page has one unique label and four colored square markers.
"""

import argparse
from contextlib import ExitStack
import json
import math
from pathlib import Path

import pymupdf as fitz

__all__ = ["verify_capture", "main"]
COLORS = ((1, 0, 0), (0, .7, 0), (0, 0, 1), (0, 0, 0))


def marker_rectangles(page):
    """Recognize exactly one vector corner rectangle for each fixture color."""
    result = {}
    for drawing in page.get_drawings():
        fill = drawing.get("fill")
        if fill is None:
            continue
        for index, color in enumerate(COLORS):
            if math.dist(fill, color) < .015:
                assert index not in result, "Duplicate colored marker"
                result[index] = drawing["rect"]
    assert len(result) == 4, "A colored marker is missing"
    return [result[index] for index in range(4)]


def visible_markers(page, rectangles):
    """Require marker interiors to appear in the final raster, detecting clips."""
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False, colorspace=fitz.csRGB)
    for rectangle, color in zip(rectangles, COLORS):
        assert page.rect.contains(rectangle), "A marker crosses the output page edge"
        # Sample away from antialiased edges; vector presence alone misses clipping.
        for x_fraction in (.15, .3, .5, .7, .85):
            for y_fraction in (.15, .3, .5, .7, .85):
                x = int((rectangle.x0 + rectangle.width * x_fraction) * 2)
                y = int((rectangle.y0 + rectangle.height * y_fraction) * 2)
                actual = tuple(value / 255 for value in pixmap.pixel(x, y))
                assert math.dist(actual, color) < .15, "A colored marker is clipped or obscured"


def fit_geometry(source, output, source_marks, output_marks, imageable):
    """Compare marker-derived uniform scale and position with source page bounds."""
    ratios = [target.width / original.width
              for original, target in zip(source_marks, output_marks)]
    ratios += [target.height / original.height
               for original, target in zip(source_marks, output_marks)]
    scale = sum(ratios) / len(ratios)
    assert min(ratios) > 0 and max(ratios) - min(ratios) < .001, "Nonuniform scaling"
    assert scale <= 1.001, "Source page was enlarged"
    sw, sh = source.rect.width, source.rect.height
    pw, ph = output.rect.width, output.rect.height
    if imageable is None:
        area = output.rect
    else:
        x, y, width, height = imageable
        area = fitz.Rect(x, y, x + width, y + height)
        assert width > 0 and height > 0 and output.rect.contains(area), "Invalid imageable bounds"
    cx, cy = (area.x0 + area.x1) / 2, (area.y0 + area.y1) / 2
    errors = []
    for rotate in (False, True):
        differences = []
        for original, target in zip(source_marks, output_marks):
            sx, sy = (original.x0 + original.x1) / 2, (original.y0 + original.y1) / 2
            dx, dy = sx - sw / 2, sy - sh / 2
            if rotate:
                dx, dy = dy, -dx
            expected = (cx + dx * scale, cy + dy * scale)
            actual = ((target.x0 + target.x1) / 2, (target.y0 + target.y1) / 2)
            differences.append(math.dist(expected, actual))
        errors.append(max(differences))
    rotate = errors[1] < errors[0]
    assert min(errors) < .5, "Page corners are not centered with source geometry preserved"
    width, height = (sh, sw) if rotate else (sw, sh)
    assert width * scale <= area.width + .5 and height * scale <= area.height + .5, "Source does not fit"
    # A fixture comfortably smaller than either orientation of the paper must stay 1:1.
    if sw < area.width / 2 and sh < area.height / 2:
        assert abs(scale - 1) < .001, "Small source was rescaled"
    if imageable is not None:
        normal = min(1, area.width / sw, area.height / sh)
        turned = min(1, area.width / sh, area.height / sw)
        assert abs(scale - max(normal, turned)) < .001, "Scale differs from independent fit calculation"
        assert rotate == (turned > normal + 1e-9), "Rotation did not choose the better fit"
        assert all(area.contains(rectangle) for rectangle in output_marks), "Marker exceeds imageable bounds"
    return {"scale": scale, "rotated": rotate,
            "source_size": [sw, sh], "paper_size": [pw, ph],
            "marker_bounds": [list(rectangle) for rectangle in output_marks]}


def verify_capture(capture, fixtures, expected_labels=None, imageable=None):
    """Verify selected synthetic output; return evidence without changing any PDF."""
    with ExitStack() as stack:
        sources = [stack.enter_context(fitz.open(path)) for path in fixtures]
        pages = {}
        for document in sources:
            for page in document:
                label = page.get_text().strip()
                assert label and label not in pages, "Fixture labels must be unique and nonempty"
                pages[label] = page
        expected_labels = list(pages) if expected_labels is None else expected_labels
        assert expected_labels and len(set(expected_labels)) == len(expected_labels), "Invalid expected labels"
        output = stack.enter_context(fitz.open(capture))
        actual = [page.get_text().strip() for page in output]
        assert actual == expected_labels, "Page order/count differs: {} != {}".format(actual, expected_labels)
        evidence = []
        for page, label in zip(output, expected_labels):
            assert label in pages, "Expected label is absent from source fixtures"
            source = pages[label]
            source_marks = marker_rectangles(source)
            output_marks = marker_rectangles(page)
            visible_markers(page, output_marks)
            result = fit_geometry(source, page, source_marks, output_marks, imageable)
            evidence.append({"label": label, **result})
        return {"passed": True, "pages": evidence,
                "exact_imageable_fit_checked": imageable is not None}


def main():
    """Expose the reusable offline verifier with explicit fixture/order inputs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture", type=Path)
    parser.add_argument("fixtures", type=Path, nargs="+")
    parser.add_argument("--expected-labels", help="Comma-separated accepted review order")
    parser.add_argument("--imageable", type=float, nargs=4, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    args = parser.parse_args()
    labels = args.expected_labels.split(",") if args.expected_labels else None
    print(json.dumps(verify_capture(args.capture, args.fixtures, labels, args.imageable), indent=2))


if __name__ == "__main__":
    main()
