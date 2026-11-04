ObjC.import('AppKit');
ObjC.import('CoreImage');
ObjC.import('ImageIO');
/** Reject visibly incomplete input before the native image decoder runs.
 * JPEG permits trailing bytes after EOI. ImageIO supplies the format-specific
 * decoder; this check only detects the common missing-file-tail case.
 */
function checkStructure(path, format) {
    const data = $.NSData.dataWithContentsOfFile(path);
    if (!data) throw new Error('이미지 파일을 읽을 수 없습니다.');
    const size = Number(data.length);
    if (format === 'public.jpeg') {
        const eoi = $.NSData.alloc.initWithBase64EncodedStringOptions('/9k=', 0);
        const ending = data.rangeOfDataOptionsRange(eoi, $.NSDataSearchBackwards, $.NSMakeRange(0, size));
        if (size < 4 || Number(ending.length) !== 2) throw new Error('끝이 잘린 JPEG 이미지입니다.');
    } else if (format === 'public.png') {
        const tail = size >= 12 ? ObjC.unwrap(data.subdataWithRange($.NSMakeRange(size - 12, 12)).base64EncodedStringWithOptions(0)) : '';
        if (tail !== 'AAAAAElFTkSuQmCC') throw new Error('끝이 잘린 PNG 이미지입니다.');
    } else {
        // HEIF uses ISO BMFF boxes. Check their declared extents as ImageIO can
        // otherwise decode a primary image despite a truncated file tail.
        let offset = 0;
        let fileTypeSeen = false;
        while (offset < size) {
            if (size - offset < 8) throw new Error('끝이 잘린 HEIF 이미지입니다.');
            const header = readBytes(data, offset, Math.min(16, size - offset));
            let length = readUInt32(header, 0);
            let headerSize = 8;
            const type = header.slice(4, 8);
            if (length === 1) {
                if (header.length < 16) throw new Error('끝이 잘린 HEIF 이미지입니다.');
                length = readUInt32(header, 8) * 4294967296 + readUInt32(header, 12);
                headerSize = 16;
            } else if (length === 0) {
                length = size - offset;
            }
            if (!Number.isSafeInteger(length) || length < headerSize || length > size - offset) {
                throw new Error('잘못되었거나 끝이 잘린 HEIF 이미지입니다.');
            }
            if (type === 'ftyp') {
                if (fileTypeSeen || length < headerSize + 8 || length > 4096 || (length - headerSize) % 4 !== 0) {
                    throw new Error('잘못된 HEIF 형식 정보입니다.');
                }
                fileTypeSeen = true;
                const brands = readBytes(data, offset + headerSize, length - headerSize);
                for (let index = 0; index < brands.length; index += 4) {
                    if (index === 4) continue; // minor version, not a brand
                    if (['msf1', 'hevc', 'hevx', 'hevs', 'hevm'].indexOf(brands.slice(index, index + 4)) !== -1) {
                        throw new Error('연속 HEIF 이미지는 지원하지 않습니다.');
                    }
                }
            }
            offset += length;
        }
        if (!fileTypeSeen) throw new Error('HEIF 형식 정보를 읽을 수 없습니다.');
    }
}

/** Read a bounded byte range as a one-byte-per-character string. */
function readBytes(data, offset, length) {
    return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(
        data.subdataWithRange($.NSMakeRange(offset, length)), $.NSISOLatin1StringEncoding));
}

/** Interpret four checked header bytes as an unsigned big-endian integer. */
function readUInt32(bytes, offset) {
    return bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 +
        bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
}

/** Resolve a HEIF still's unique primary, preferring explicit item metadata.
 * ImageIO's index API can return zero for a .heif URL whose primary is not
 * zero, even when that item's PrimaryImage property is correct.
 */
function primaryImageIndex(source, count) {
    let primary = -1;
    for (let index = 0; index < count; index++) {
        const properties = ObjC.deepUnwrap(ObjC.castRefToObject($.CGImageSourceCopyPropertiesAtIndex(source, index, null)));
        if (properties && properties.PrimaryImage === true) {
            if (primary !== -1) throw new Error('HEIF 대표 이미지가 중복되어 있습니다.');
            primary = index;
        }
    }
    return primary === -1 ? Number($.CGImageSourceGetPrimaryImageIndex(source)) : primary;
}

/** Export one PNG/JPEG/HEIF still image as a PDF page at its oriented size.
 * Caller supplies absolute private paths and publishes the result separately.
 * Preserves EXIF orientation and pixel geometry, retains alpha transparency, and
 * rejects incomplete input. A HEIF collection exports its declared primary
 * image only (including ordinary iPhone auxiliary/depth items); sequences are
 * unsupported. No app document is opened or changed.
 */
function run(argv) {
    if (argv.length !== 2 || argv[0][0] !== '/' || argv[1][0] !== '/') {
        throw new Error('이미지 변환에는 절대 입력·출력 경로가 필요합니다.');
    }
    const input = $.NSURL.fileURLWithPath(argv[0]);
    const source = $.CGImageSourceCreateWithURL(input, null);
    if (!source) {
        throw new Error('이미지를 읽을 수 없습니다.');
    }
    const format = ObjC.unwrap(ObjC.castRefToObject($.CGImageSourceGetType(source)));
    if (format === 'public.heics') throw new Error('연속 HEIF 이미지는 지원하지 않습니다.');
    const isHEIF = format === 'public.heic' || format === 'public.heif';
    if (format !== 'public.png' && format !== 'public.jpeg' && !isHEIF) {
        throw new Error('지원하는 PNG, JPEG 또는 HEIF 정지 이미지가 아닙니다.');
    }
    const count = Number($.CGImageSourceGetCount(source));
    const imageIndex = isHEIF ? primaryImageIndex(source, count) : 0;
    if (count < 1 || (!isHEIF && count !== 1) || imageIndex < 0 || imageIndex >= count) {
        throw new Error('단일 이미지 또는 HEIF 대표 이미지를 읽을 수 없습니다.');
    }
    checkStructure(argv[0], format);
    // Force a complete decode rather than accepting a readable file header.
    const decoded = $.CGImageSourceCreateImageAtIndex(source, imageIndex, null);
    if (!decoded || Number($.CGImageSourceGetStatus(source)) !== 0 ||
        Number($.CGImageSourceGetStatusAtIndex(source, imageIndex)) !== 0) {
        throw new Error('손상되었거나 불완전한 이미지입니다.');
    }
    const properties = ObjC.deepUnwrap(ObjC.castRefToObject($.CGImageSourceCopyPropertiesAtIndex(source, imageIndex, null)));
    const orientation = Number(properties.Orientation || 1);
    if (orientation < 1 || orientation > 8) throw new Error('잘못된 이미지 방향입니다.');
    const image = $.CIImage.imageWithCGImage(decoded).imageByApplyingOrientation(orientation);
    const bounds = image.extent;
    const width = bounds.size.width;
    const height = bounds.size.height;
    if (!(width > 0 && height > 0)) throw new Error('이미지 크기를 읽을 수 없습니다.');
    const dpiX = Number(properties.DPIWidth) || 72;
    const dpiY = Number(properties.DPIHeight) || 72;
    const swapped = orientation >= 5;
    const pageWidth = width * 72 / (swapped ? dpiY : dpiX);
    const pageHeight = height * 72 / (swapped ? dpiX : dpiY);
    if (!(pageWidth > 0 && pageHeight > 0 && isFinite(pageWidth) && isFinite(pageHeight))) {
        throw new Error('잘못된 이미지 해상도입니다.');
    }
    const context = $.CIContext.contextWithOptions($.NSDictionary.dictionary);
    const raster = context.createCGImageFromRect(image, bounds);
    if (!raster) throw new Error('이미지를 변환할 수 없습니다.');
    const representation = $.NSBitmapImageRep.alloc.initWithCGImage(raster);
    const nativeImage = $.NSImage.alloc.initWithSize($.NSMakeSize(pageWidth, pageHeight));
    nativeImage.addRepresentation(representation);
    $.NSApplication.sharedApplication;
    const view = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, pageWidth, pageHeight));
    view.image = nativeImage;
    view.imageScaling = $.NSImageScaleAxesIndependently;
    view.imageAlignment = $.NSImageAlignCenter;
    // PDF transparency remains transparent; ordinary PDF viewers show white.
    const pdf = view.dataWithPDFInsideRect(view.bounds);
    if (!pdf || Number(pdf.length) === 0 || !pdf.writeToFileAtomically(argv[1], true)) {
        throw new Error('PDF를 저장할 수 없습니다.');
    }
    return argv[1];
}
