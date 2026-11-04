# DNG verification evidence

Local opt-in checks, recorded 2026-11-04 on macOS 26.6.2. These are two supported specimens, not a compatibility claim for all Android phones or DNG versions. No private images, capture metadata, original filenames, GPS, or machine paths are included here.

## Inputs and independent references

| Specimen | Sensor / active crop | Type and orientation | Independent reference |
| --- | --- | --- | --- |
| Samsung Galaxy Z Fold7 | 4000×3000 / 4000×3000 | DNG 1.7; 16-bit three-channel Linear Raw; JPEG XL; EXIF 6 (90° CW) | Matching full-size camera JPEG, EXIF-transposed and converted from its embedded DCI-P3 profile to sRGB using Pillow/lcms. Its full-size embedded JPEG was also available. |
| Google Pixel 4 XL | 3700×2774 / 3684×2758, crop origin (8,8) | 16-bit CFA, 2×2 RGGB; EXIF 1 | Independent LibRaw sensor decode with camera WB; crop applied before orientation. The embedded preview is only 672×502 and cannot qualify as a full-size reference. |

The public Pixel specimen is [raw.pixls.us repository entry 3502](https://raw.pixls.us/) ([repository JSON](https://raw.pixls.us/json/getrepository.php), [direct DNG](https://raw.pixls.us/getfile.php/3502/nice/Google%20-%20Pixel%204%20XL%20-%2016bit%20%284%3A3%29.dng)). Its downloaded SHA-256 was independently checked:

```text
0c03a6c93b4b8593cd0e4426166e6389710007238b82eb23861ef191322f0c54
```

LibRaw 0.22.2/rawpy 0.28.0 cannot decode the Samsung JPEG XL Linear Raw stream; its metadata can still be read. The matching camera JPEG supplies an independent practical reference, not a second independent sensor decode. The RAW/preview mutations below separately prove that the converter reads the RAW pixels.

## Reproduce without installing QA dependencies into the converter

Create an isolated Python 3.10+ environment outside this repository and install `numpy Pillow rawpy PyMuPDF` there. `exiftool` must also be available. Conversion itself does not require these packages.

```sh
./convert.sh --no-dialog -- INPUT.dng
python3 verification/verify-dng-quality.py INPUT.dng INPUT.pdf --self-test
# For a shot-paired camera JPEG (especially a RAW codec unsupported by LibRaw):
python3 verification/verify-dng-quality.py INPUT.dng INPUT.pdf --reference CAMERA.jpg --self-test
```

Use a fresh destination: the converter preserves an existing PDF. The verifier does not create or alter the input or PDF. JSON goes to stdout and omits paths, location, and timestamps. `--evidence-dir PRIVATE_DIRECTORY` explicitly opts into writing private reference/render images; never commit or upload those images without permission.

## Observed PDF and orientation results

Both PDFs contain exactly one full-page, 8-bit RGB raster at the exact oriented active crop: Samsung **3000×4000**, Pixel **3684×2758**. Their MediaBoxes match those dimensions in points, with no padding, image clipping, or skew. Both raster color spaces embed the **sRGB IEC61966-2.1** ICC profile; an independent lcms transform of a 17×17×17 RGB grid to sRGB differs by at most **1/255** in any channel. Merely finding three color channels is not the ICC check.

The verifier renders the visible PDF page with MuPDF, downsamples reference and page using Lanczos to a common width of 384 pixels, and computes centered Pearson luminance correlations for all eight planar rotations/reflections. The reference is oriented once from its own EXIF or RAW metadata.

| Reference | Correct orientation | Best incorrect orientation | Margin |
| --- | ---: | ---: | ---: |
| Samsung camera JPEG | 0.99683 | 0.98890 (vertical reflection) | 0.00793 |
| Pixel LibRaw | 0.92646 | 0.50250 (horizontal reflection) | 0.42396 |

The Samsung dark scene is nearly symmetric, so its small orientation margin is explicitly weak evidence. It still selects the correct orientation; the less symmetric Pixel scene provides much stronger discrimination. Seven reflected/rotated-image mutations and an RGB/BGR mutation were rejected for both references.

## Color findings and limits

All RGB values below are normalized to 0–1. Per-channel affine residuals allow different brightness/WB scales and offsets; they do not erase the reported unadjusted color bias.

| Comparison | Reference mean R/G/B | PDF mean R/G/B | PDF minus reference R/G/B | Affine-fit RMSE R/G/B |
| --- | --- | --- | --- | --- |
| Samsung camera JPEG | .08952 / .07732 / .04978 | .07612 / .06827 / .04220 | −.01340 / −.00904 / −.00757 | .01052 / .00786 / .01065 |
| Pixel LibRaw | .43998 / .46124 / .45155 | .58473 / .59226 / .55445 | +.14475 / +.13101 / +.10289 | .06920 / .06610 / .06270 |

For Pixel, the mean corresponding-channel correlation is **0.93088** for RGB, **0.90645** for the next mapping, and **0.85011** for BGR. RGB identity is distinguishable. Samsung's best mapping is also RGB (**0.99462**), but the next mapping scores **0.99147**: its weak chroma leaves channel identity **unverified/ambiguous** under the default margin. The checker reports that limitation explicitly.

Visual comparison confirms matching framing and natural sky/vegetation/road colors in Pixel. Apple's RAW rendering is substantially brighter and somewhat warmer than this LibRaw setup. Samsung's PDF is slightly darker than the paired camera JPEG. These are observed WB/tone/exposure differences, not proof that either rendering has absolutely correct color. Neither scene includes a calibrated neutral/color target; no absolute color accuracy, neutral WB, camera-JPEG identity, or identical local tone mapping is claimed.

## RAW decoding and negative controls

Disposable copies of the Samsung DNG were changed without modifying TIFF directory entries or any bytes outside the selected image payload:

- Zeroing the entire full-size JPEG preview payload still succeeds. The resulting 3000×4000 PDF raster has the **same decoded pixel SHA-256** as the original conversion.
- Zeroing the main JPEG XL RAW payload, leaving that preview intact, fails with a RAW decoder error and creates no PDF.

This rules out accepting the same-resolution embedded JPEG as the successful Samsung conversion. A corrupt RAW with a readable preview is rejected.

Separate disposable Pixel PDFs were mutated to reduce raster width, remove the ICC profile, swap RGB/BGR payload channels, reflect the page image, or inset/shrink its placement. Every mutation made the verifier exit nonzero on the corresponding geometry, profile, channel, orientation, or framing assertion.

Default assertions require exact oriented crop raster dimensions; correct full-page placement; an embedded ICC profile behaving as sRGB within 3/255 over the test grid; a page aspect error at most 0.5%; and the expected orientation to win with luminance correlation at least 0.65. A non-RGB mapping that beats RGB by more than 0.015 fails. Weak separation is explicitly marked unverified; it is not upgraded to a color-accuracy pass. Thresholds are practical diagnostics tested against these mutations, not universal scientific error bounds.

The optional embedded-reference fallback rejects thumbnail-sized references and labels a full-sized preview comparison as limited. It cannot alone establish that the converter decoded sensor pixels. Unknown cameras/codecs, featureless or symmetric scenes, unusual crops, and extensive local tone processing need further investigation and visual review.
