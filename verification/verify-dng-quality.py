#!/usr/bin/env python3
"""Opt-in DNG/PDF visual QA with independent decoders; never alters inputs.

Requires Python 3.10+, exiftool and QA-only Python packages: numpy, Pillow, rawpy, PyMuPDF.
Usage: python3 verification/verify-dng-quality.py INPUT.dng OUTPUT.pdf
Optional --reference supplies a matching camera JPEG. ICC profiles are converted
into sRGB. Otherwise LibRaw decodes the sensor, with a full-sized embedded JPEG
fallback explicitly reported for unsupported RAW codecs. JSON omits paths, GPS,
capture times and image content. --evidence-dir writes PRIVATE image evidence.
This is a local diagnostic, not a CI gate or a guarantee of camera colorimetry.
"""

import argparse
import io
import itertools
import json
import re
import subprocess
from pathlib import Path

import numpy as np
import pymupdf
import rawpy
from PIL import Image, ImageCms, ImageOps

TRANSFORMS = {
    "identity": None,
    "mirror-horizontal": Image.Transpose.FLIP_LEFT_RIGHT,
    "rotate-180": Image.Transpose.ROTATE_180,
    "mirror-vertical": Image.Transpose.FLIP_TOP_BOTTOM,
    "transpose": Image.Transpose.TRANSPOSE,
    "rotate-90-CW": Image.Transpose.ROTATE_270,
    "transverse": Image.Transpose.TRANSVERSE,
    "rotate-90-CCW": Image.Transpose.ROTATE_90,
}
ORIENTATIONS = dict(zip(range(1, 9), TRANSFORMS.values()))


def metadata(path: Path) -> dict:
    """Read only geometry/camera tags, excluding private provenance and GPS."""
    tags = [
        "Make",
        "Model",
        "UniqueCameraModel",
        "PhotometricInterpretation",
        "ImageWidth",
        "ImageHeight",
        "ActiveArea",
        "DefaultCropOrigin",
        "DefaultCropSize",
        "Orientation",
        "PreviewImageStart",
        "PreviewImageLength",
        "Compression",
        "BitsPerSample",
        "SamplesPerPixel",
        "DNGVersion",
        "CFARepeatPatternDim",
        "CFAPattern",
    ]
    result = subprocess.run(
        ["exiftool", "-j", "-G1", "-a", "-n", *["-" + tag for tag in tags], str(path)],
        check=True,
        capture_output=True,
    )
    parsed = json.loads(result.stdout)[0]
    parsed.pop("SourceFile", None)
    return parsed


def pair(value) -> tuple[int, int]:
    """Parse ExifTool's two-value geometry representation."""
    values = str(value).split()
    return int(float(values[0])), int(float(values[1]))


def raw_geometry(tags: dict) -> tuple[tuple[int, int], tuple[int, int], int]:
    """Resolve sensor/crop geometry from the RAW IFD rather than its preview."""
    groups = [
        key.split(":")[0]
        for key, value in tags.items()
        if key.endswith(":PhotometricInterpretation") and value in (32803, 34892)
    ]
    if len(groups) != 1:
        raise ValueError("Expected one CFA or Linear Raw IFD")
    group = groups[0] + ":"
    sensor = (int(tags[group + "ImageWidth"]), int(tags[group + "ImageHeight"]))
    crop = (
        pair(tags[group + "DefaultCropSize"])
        if group + "DefaultCropSize" in tags
        else sensor
    )
    orientation = int(tags.get("IFD0:Orientation", 1))
    if orientation not in ORIENTATIONS:
        raise ValueError("Invalid EXIF orientation")
    return sensor, crop, orientation


def srgb(image: Image.Image) -> Image.Image:
    """Interpret an embedded ICC profile before comparing visible RGB values."""
    profile = image.info.get("icc_profile")
    if profile:
        return ImageCms.profileToProfile(
            image.convert("RGB"),
            ImageCms.ImageCmsProfile(io.BytesIO(profile)),
            ImageCms.createProfile("sRGB"),
            outputMode="RGB",
        )
    return image.convert("RGB")


def reference_image(
    path: Path, external: Path | None, orientation: int, crop: tuple[int, int]
) -> tuple[Image.Image, dict]:
    """Use a camera JPEG, LibRaw sensor decode, or explicitly limited full preview."""
    if external:
        with Image.open(external) as original:
            image = srgb(ImageOps.exif_transpose(original))
        return image, {
            "kind": "external-camera-image",
            "decoder": "Pillow/libjpeg",
            "icc_to_srgb": True,
        }
    try:
        with rawpy.imread(str(path)) as raw:
            sizes = raw.sizes
            decoded = raw.postprocess(use_camera_wb=True, user_flip=0, output_bps=8)
            image = Image.fromarray(decoded)
            if sizes.crop_width and sizes.crop_height:
                left = sizes.crop_left_margin - sizes.left_margin
                top = sizes.crop_top_margin - sizes.top_margin
                image = image.crop(
                    (left, top, left + sizes.crop_width, top + sizes.crop_height)
                )
            transform = ORIENTATIONS[orientation]
            if transform is not None:
                image = image.transpose(transform)
        return image, {
            "kind": "sensor-decode",
            "decoder": "LibRaw",
            "version": ".".join(map(str, rawpy.libraw_version)),
            "white_balance": "camera",
            "auto_brightness": True,
        }
    except rawpy.LibRawError as error:
        raw_error = type(error).__name__
    preview = subprocess.run(
        ["exiftool", "-b", "-PreviewImage", str(path)], check=True, capture_output=True
    ).stdout
    if not preview:
        raise ValueError("LibRaw cannot decode and no full embedded reference exists")
    with Image.open(io.BytesIO(preview)) as original:
        preview_size = original.size
        if min(preview_size) < min(crop) * 0.95 or max(preview_size) < max(crop) * 0.95:
            raise ValueError(
                "Embedded preview is thumbnail-sized; full sensor QA unavailable"
            )
        own_orientation = original.getexif().get(274)
        image = srgb(ImageOps.exif_transpose(original))
        if own_orientation is None and ORIENTATIONS[orientation] is not None:
            image = image.transpose(ORIENTATIONS[orientation])
    return image, {
        "kind": "full-embedded-preview-only",
        "decoder": "Pillow/libjpeg",
        "sensor_decode_unavailable": raw_error,
        "limitation": "Preview comparison alone does not prove RAW pixel decoding",
    }


def pdf_image(path: Path, expected: tuple[int, int]) -> tuple[Image.Image, dict]:
    """Inspect full PDF image dimensions and independently render its visible page."""
    with pymupdf.open(str(path)) as pdf:
        if len(pdf) != 1:
            raise ValueError("Expected exactly one PDF page")
        page = pdf[0]
        images = [
            {"width": item[2], "height": item[3], "bits": item[4]}
            for item in page.get_images(full=True)
        ]
        if not images:
            raise ValueError("No embedded raster image in PDF")
        largest = max(images, key=lambda image: image["width"] * image["height"])
        if (largest["width"], largest["height"]) != expected:
            raise ValueError(
                "PDF raster dimensions must exactly match the oriented active RAW crop"
            )
        xref = max(page.get_images(full=True), key=lambda image: image[2] * image[3])[0]
        placements = page.get_image_rects(xref, transform=True)
        if len(placements) != 1:
            raise ValueError("Expected exactly one placement of the full RAW image")
        bounds, matrix = placements[0]
        if (
            any(abs(left - right) > 0.001 for left, right in zip(bounds, page.rect))
            or abs(matrix.b) > 0.001
            or abs(matrix.c) > 0.001
        ):
            raise ValueError(
                "PDF image is cropped, padded, rotated or skewed within the page"
            )
        color_kind, color_value = pdf.xref_get_key(xref, "ColorSpace")
        color_object = (
            pdf.xref_object(int(color_value.split()[0]))
            if color_kind == "xref"
            else color_value
        )
        match = re.search(r"/ICCBased\s+(\d+)\s+0\s+R", color_object)
        if not match:
            raise ValueError("PDF raster must embed an ICC RGB profile")
        profile = ImageCms.ImageCmsProfile(
            io.BytesIO(pdf.xref_stream(int(match.group(1))))
        )
        levels = np.linspace(0, 255, 17).astype("uint8")
        grid = np.array(
            list(itertools.product(levels, repeat=3)), dtype="uint8"
        ).reshape((1, -1, 3))
        interpreted = np.asarray(
            ImageCms.profileToProfile(
                Image.fromarray(grid),
                profile,
                ImageCms.createProfile("sRGB"),
                outputMode="RGB",
            ),
            dtype=int,
        )
        profile_error = int(np.max(np.abs(interpreted - grid.astype(int))))
        if profile_error > 3:
            raise ValueError(
                "Embedded PDF profile does not behave as sRGB on the 17-cube RGB grid"
            )
        ratio_error = abs(
            (page.rect.width / page.rect.height) / (expected[0] / expected[1]) - 1
        )
        if ratio_error > 0.005:
            raise ValueError(
                "PDF page aspect ratio differs from oriented crop by over 0.5%"
            )
        scale = 768 / max(page.rect.width, page.rect.height)
        pixmap = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False
        )
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        return image, {
            "pages": 1,
            "embedded_images": images,
            "page_points": [page.rect.width, page.rect.height],
            "image_fills_page": True,
            "icc_description": ImageCms.getProfileDescription(profile).strip(),
            "icc_srgb_grid_max_error_8bit": profile_error,
            "oriented_crop_pixels": list(expected),
            "aspect_ratio_error": ratio_error,
        }


def array(image: Image.Image, size: tuple[int, int]) -> np.ndarray:
    """Downsample consistently for reproducible structural and color diagnostics."""
    return np.asarray(image.resize(size, Image.Resampling.LANCZOS), dtype=float) / 255


def correlation(left: np.ndarray, right: np.ndarray) -> float:
    """Return centered correlation, rejecting featureless references as ambiguous."""
    left = left.reshape(-1) - left.mean()
    right = right.reshape(-1) - right.mean()
    denominator = np.linalg.norm(left) * np.linalg.norm(right)
    return float(np.dot(left, right) / denominator) if denominator > 1e-12 else 0.0


def diagnostics(reference: Image.Image, target: Image.Image) -> dict:
    """Compare all eight planar orientations and all six RGB channel mappings."""
    size = (384, max(1, round(384 * reference.height / reference.width)))
    ref = array(reference, size)
    coefficients = np.array([0.2126, 0.7152, 0.0722])
    ref_gray = ref @ coefficients
    scores = {}
    for name, transform in TRANSFORMS.items():
        candidate = target if transform is None else target.transpose(transform)
        observed = array(candidate, size) @ coefficients
        scores[name] = correlation(ref_gray, observed)
    observed = array(target, size)
    permutations = {}
    for permutation in itertools.permutations(range(3)):
        name = "".join("RGB"[index] for index in permutation)
        permutations[name] = float(
            np.mean(
                [
                    correlation(
                        ref[:, :, channel], observed[:, :, permutation[channel]]
                    )
                    for channel in range(3)
                ]
            )
        )
    residuals = []
    gains = []
    for channel in range(3):
        x = observed[:, :, channel].ravel()
        y = ref[:, :, channel].ravel()
        slope, offset = np.linalg.lstsq(
            np.stack([x, np.ones_like(x)], axis=1), y, rcond=None
        )[0]
        gains.append(float(slope))
        residuals.append(float(np.sqrt(np.mean((x * slope + offset - y) ** 2))))
    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    channel_order = sorted(permutations.items(), key=lambda item: item[1], reverse=True)
    color_status = (
        "verified-RGB"
        if channel_order[0][0] == "RGB"
        and channel_order[0][1] - channel_order[1][1] > 0.015
        else "unverified-ambiguous-chroma"
    )
    if (
        channel_order[0][0] != "RGB"
        and channel_order[0][1] - permutations["RGB"] > 0.015
    ):
        color_status = "fail-channel-permutation"
    ref_means, observed_means = ref.mean(axis=(0, 1)), observed.mean(axis=(0, 1))
    return {
        "orientation_correlation": scores,
        "best_orientation": ordered[0][0],
        "orientation_margin": ordered[0][1] - ordered[1][1],
        "channel_mapping_correlation": permutations,
        "best_channel_mapping": channel_order[0][0],
        "channel_identity_status": color_status,
        "channel_affine_rmse_0_to_1": residuals,
        "channel_affine_slopes": gains,
        "reference_mean_rgb": ref_means.tolist(),
        "pdf_mean_rgb": observed_means.tolist(),
        "mean_rgb_difference": (observed_means - ref_means).tolist(),
        "limitation": "Tone, exposure, WB, local processing and gamut differ between decoders; color values inform visual review, not pixel equality",
    }


def assert_orientation(result: dict) -> None:
    """Reject wrong orientation or a clearly swapped RGB mapping, allowing tone changes."""
    if (
        result["best_orientation"] != "identity"
        or result["orientation_correlation"]["identity"] < 0.65
    ):
        raise ValueError(
            "Orientation/structure check failed: identity must win with correlation >= 0.65"
        )
    if result["channel_identity_status"] == "fail-channel-permutation":
        raise ValueError(
            "RGB channel identity failed: a swapped mapping exceeds RGB correlation by >0.015"
        )


def self_test(reference: Image.Image) -> list[str]:
    """Prove orientation assertions reject plausible transformed-image mutations."""
    caught = []
    assert_orientation(diagnostics(reference, reference))
    for name in list(TRANSFORMS)[1:]:
        result = diagnostics(reference, reference.transpose(TRANSFORMS[name]))
        try:
            assert_orientation(result)
        except ValueError:
            caught.append(name)
    if len(caught) != 7:
        raise ValueError("Scene is too symmetric to reject all orientation mutations")
    swapped = Image.fromarray(np.asarray(reference)[:, :, ::-1])
    swapped_result = diagnostics(reference, swapped)
    if swapped_result["best_channel_mapping"] != "BGR":
        raise ValueError(
            "Scene has insufficient chroma to identify an RGB/BGR mutation"
        )
    try:
        assert_orientation(swapped_result)
    except ValueError:
        pass
    else:
        raise ValueError(
            "RGB/BGR mutation did not trip the channel assertion; chroma is insufficient"
        )
    return caught + ["RGB/BGR channel assertion"]


def main() -> None:
    """Read user-selected private inputs and emit only sanitized verification facts."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    tags = metadata(args.input)
    sensor, crop, orientation = raw_geometry(tags)
    expected = crop[::-1] if orientation >= 5 else crop
    reference, reference_info = reference_image(
        args.input, args.reference, orientation, crop
    )
    target, pdf_info = pdf_image(args.pdf, expected)
    result = diagnostics(reference, target)
    report = {
        "metadata": tags,
        "sensor_pixels": list(sensor),
        "active_crop_pixels": list(crop),
        "reference": reference_info,
        "pdf": pdf_info,
        "comparison": result,
        "tolerances": {
            "pdf_dimensions": "exact oriented active crop",
            "maximum_aspect_error": 0.005,
            "channel_permutation_correlation_margin": 0.015,
            "icc_srgb_grid_max_error_8bit": 3,
            "minimum_identity_luminance_correlation": 0.65,
            "warning": "Small orientation margins or weak chroma require human review",
        },
    }
    if args.self_test:
        report["detected_mutations"] = self_test(reference)
    if args.evidence_dir:
        args.evidence_dir.mkdir(parents=True, exist_ok=True)
        reference.thumbnail((768, 768))
        reference.save(args.evidence_dir / "reference.png")
        target.save(args.evidence_dir / "pdf-render.png")
    print(json.dumps(report, indent=2))
    assert_orientation(result)


if __name__ == "__main__":
    main()
