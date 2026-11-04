ObjC.import('AppKit');
ObjC.import('CoreImage');
ObjC.import('ImageIO');
ObjC.import('Quartz');

/** Inspect bounded classic-TIFF IFDs without decoding any embedded preview.
 * Requires DNGVersion and a full-resolution CFA/LinearRaw IFD whose strip/tile
 * payload ranges exist. Core Image remains responsible for RAW decompression
 * and DNG processing; inputs above 512 MiB/210 MP, BigTIFF, and ambiguous
 * RAW planes are rejected. IFD traversal is capped at 128 nodes.
 */
function checkDNG(data) {
    const size = Number(data.length);
    if (size < 8 || size > 536870912) throw new Error('지원하지 않거나 불완전한 DNG 파일입니다.');
    /** Read only a checked range, preserving each byte in a Latin-1 string. */
    function bytes(offset, length) {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
            offset < 0 || length < 0 || offset + length > size) {
            throw new Error('끝이 잘렸거나 잘못된 DNG 데이터입니다.');
        }
        return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(
            data.subdataWithRange($.NSMakeRange(offset, length)), $.NSISOLatin1StringEncoding));
    }
    const header = bytes(0, 8);
    const little = header.slice(0, 2) === 'II';
    if (!little && header.slice(0, 2) !== 'MM') throw new Error('DNG TIFF 헤더를 읽을 수 없습니다.');
    /** Decode a 16/32-bit TIFF unsigned integer from an already checked range. */
    function uint(value, offset, width) {
        let result = 0;
        for (let index = 0; index < width; index++) {
            result = result * 256 + value.charCodeAt(offset + (little ? width - index - 1 : index));
        }
        return result;
    }
    if (uint(header, 2, 2) !== 42) throw new Error('일반 TIFF 기반 DNG만 지원합니다.');
    const pending = [uint(header, 4, 4)];
    const visited = {};
    let versionSeen = false;
    let rawPlanes = 0;
    const typeWidths = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4};
    while (pending.length) {
        const offset = pending.pop();
        if (!offset) continue;
        if (visited[offset] || Object.keys(visited).length >= 128) throw new Error('DNG 이미지 구조가 순환하거나 너무 복잡합니다.');
        visited[offset] = true;
        const count = uint(bytes(offset, 2), 0, 2);
        if (count > 4096) throw new Error('DNG 이미지 항목이 너무 많습니다.');
        const table = bytes(offset + 2, count * 12 + 4);
        const tags = {};
        for (let index = 0; index < count; index++) {
            const entry = index * 12;
            const tag = uint(table, entry, 2);
            if (tags[tag]) throw new Error('DNG 이미지 항목이 중복되어 있습니다.');
            const type = uint(table, entry + 2, 2);
            const elements = uint(table, entry + 4, 4);
            const width = typeWidths[type];
            if (!width || elements > 1048576) throw new Error('지원하지 않는 DNG 이미지 항목입니다.');
            const length = elements * width;
            const start = length > 4 ? uint(table, entry + 8, 4) : offset + 2 + entry + 8;
            if (start + length > size) throw new Error('끝이 잘린 DNG 이미지 항목입니다.');
            tags[tag] = {type: type, count: elements, start: start, width: width};
        }
        /** Read a TIFF BYTE/SHORT/LONG value list used for structural checks. */
        function values(tag) {
            const item = tags[tag];
            if (!item) return [];
            if ([1, 3, 4, 13].indexOf(item.type) < 0) throw new Error('잘못된 DNG 이미지 항목 형식입니다.');
            const value = bytes(item.start, item.count * item.width);
            const result = [];
            for (let index = 0; index < item.count; index++) result.push(uint(value, index * item.width, item.width));
            return result;
        }
        const version = values(50706);
        if (version.length) {
            if (version.length !== 4 || version[0] !== 1) throw new Error('지원하지 않는 DNG 버전입니다.');
            versionSeen = true;
        }
        const photometric = values(262)[0];
        const subfile = values(254)[0] || 0;
        if ((photometric === 32803 || photometric === 34892) && subfile === 0) {
            const width = values(256)[0];
            const height = values(257)[0];
            if (!(width > 0 && height > 0 && width * height <= 210000000)) throw new Error('잘못되거나 너무 큰 DNG RAW 크기입니다.');
            const tiled = !!tags[324];
            const offsets = values(tiled ? 324 : 273);
            const lengths = values(tiled ? 325 : 279);
            if (!offsets.length || offsets.length !== lengths.length) throw new Error('DNG RAW 픽셀 데이터가 없습니다.');
            for (let index = 0; index < offsets.length; index++) {
                if (!(offsets[index] > 0 && lengths[index] > 0 && offsets[index] + lengths[index] <= size)) {
                    throw new Error('끝이 잘린 DNG RAW 픽셀 데이터입니다.');
                }
            }
            rawPlanes++;
        }
        if (tags[330] && tags[330].count > 128) throw new Error('DNG 하위 이미지가 너무 많습니다.');
        const children = values(330);
        if (pending.length + children.length + Object.keys(visited).length > 128) {
            throw new Error('DNG 하위 이미지가 너무 많습니다.');
        }
        for (let index = 0; index < children.length; index++) pending.push(children[index]);
        pending.push(uint(table, count * 12, 4));
    }
    if (!versionSeen || rawPlanes !== 1) throw new Error('단일 RAW 원본을 포함한 DNG 파일이 아닙니다.');
}

/** Render one full-resolution RAW-derived sRGB raster to one PDF page.
 * Uses native effective crop dimensions as points (one point per pixel), with
 * EXIF orientation applied exactly once. No source metadata is copied to PDF.
 * Caller owns private output staging and publication; failures throw.
 */
function run(argv) {
    if (argv.length !== 2 || argv[0][0] !== '/' || argv[1][0] !== '/') {
        throw new Error('DNG 변환에는 절대 입력·출력 경로가 필요합니다.');
    }
    const inputPath = ObjC.unwrap($(argv[0]).stringByResolvingSymlinksInPath);
    const outputPath = ObjC.unwrap($(argv[1]).stringByResolvingSymlinksInPath);
    if (inputPath === outputPath) throw new Error('DNG 원본을 출력 파일로 덮어쓸 수 없습니다.');
    const files = $.NSFileManager.defaultManager;
    const attributes = files.attributesOfItemAtPathError(inputPath, Ref());
    if (!ObjC.unwrap(attributes) || ObjC.unwrap(attributes.objectForKey($.NSFileType)) !== 'NSFileTypeRegular') {
        throw new Error('일반 DNG 파일만 변환할 수 있습니다.');
    }
    const sourceSize = Number(ObjC.unwrap(attributes.objectForKey($.NSFileSize)));
    if (!(sourceSize >= 8 && sourceSize <= 536870912)) throw new Error('DNG 파일은 512 MiB 이하여야 합니다.');
    if (ObjC.unwrap(files.attributesOfItemAtPathError(outputPath, Ref()))) throw new Error('DNG PDF 출력 파일이 이미 존재합니다.');
    // A bounded immutable copy keeps metadata checks and RAW decoding on the
    // same bytes even if another application changes the original path.
    const data = $.NSData.dataWithContentsOfFile(inputPath);
    if (!data) throw new Error('DNG 파일을 읽을 수 없습니다.');
    checkDNG(data);
    // ImageIO is used solely for type identification, never for image/preview
    // decoding. CIRAWFilter receives these same validated immutable bytes.
    const source = $.CGImageSourceCreateWithData(data, null);
    if (!source || ObjC.unwrap(ObjC.castRefToObject($.CGImageSourceGetType(source))) !== 'com.adobe.raw-image') {
        throw new Error('DNG RAW 형식으로 인식되지 않는 파일입니다.');
    }
    const raw = $.CIRAWFilter.filterWithImageDataIdentifierHint(data, 'com.adobe.raw-image');
    if (!raw) throw new Error('이 DNG의 RAW 원본은 현재 macOS에서 지원하지 않습니다.');
    const decoder = ObjC.unwrap(raw.decoderVersion);
    const versions = ObjC.deepUnwrap(raw.supportedDecoderVersions);
    if (!decoder || decoder === 'none' || !versions || versions.indexOf(decoder) < 0) {
        throw new Error('DNG RAW 디코더를 사용할 수 없습니다.');
    }
    raw.scaleFactor = 1;
    raw.draftModeEnabled = false;
    raw.extendedDynamicRangeAmount = 0;
    const orientation = Number(raw.orientation);
    if (!(orientation >= 1 && orientation <= 8)) throw new Error('잘못된 DNG 이미지 방향입니다.');
    // CIRAWFilter normally applies EXIF itself. Neutralize that transform and
    // apply its original orientation once after full-resolution RAW processing.
    raw.orientation = 1;
    const native = raw.nativeSize;
    const unrotated = raw.outputImage;
    if (!unrotated) throw new Error('DNG RAW 원본을 처리할 수 없습니다.');
    const unrotatedBounds = unrotated.extent;
    if (!(native.width > 0 && native.height > 0 && native.width * native.height <= 210000000) ||
        unrotatedBounds.size.width !== native.width || unrotatedBounds.size.height !== native.height) {
        throw new Error('DNG RAW 원본의 전체 유효 해상도를 확인할 수 없습니다.');
    }
    const image = unrotated.imageByApplyingOrientation(orientation);
    const bounds = image.extent;
    const width = Number(bounds.size.width);
    const height = Number(bounds.size.height);
    const swapped = orientation >= 5;
    if (width !== (swapped ? native.height : native.width) || height !== (swapped ? native.width : native.height)) {
        throw new Error('DNG RAW 이미지 방향과 해상도가 일치하지 않습니다.');
    }
    const srgb = $.CGColorSpaceCreateWithName($.kCGColorSpaceSRGB);
    const linear = $.CGColorSpaceCreateWithName($.kCGColorSpaceExtendedLinearSRGB);
    const options = $.NSMutableDictionary.dictionary;
    options.setObjectForKey(ObjC.castRefToObject(linear), $.kCIContextWorkingColorSpace);
    options.setObjectForKey(ObjC.castRefToObject(srgb), $.kCIContextOutputColorSpace);
    const context = $.CIContext.contextWithOptions(options);
    // This call forces RAW decompression/demosaicing and explicit color-managed
    // conversion. No createCGImage/thumbnail ImageIO fallback is allowed.
    const raster = context.createCGImageFromRectFormatColorSpace(image, bounds, $.kCIFormatRGBA8, srgb);
    if (!raster || Number($.CGImageGetWidth(raster)) !== width || Number($.CGImageGetHeight(raster)) !== height) {
        throw new Error('DNG RAW 원본 전체를 sRGB 이미지로 변환할 수 없습니다.');
    }
    const rasterColor = ObjC.unwrap(ObjC.castRefToObject($.CGColorSpaceCopyName($.CGImageGetColorSpace(raster))));
    if (rasterColor !== 'kCGColorSpaceSRGB') throw new Error('DNG 출력의 sRGB 색 공간을 확인할 수 없습니다.');
    const pageRect = $.CGRectMake(0, 0, width, height);
    // JXA cannot pass CGRect* directly here. NSValue writes its native CGRect
    // bytes into the CFData form required by kCGPDFContextMediaBox instead.
    const media = $.NSMutableData.dataWithLength(32);
    $.NSValue.valueWithRect(pageRect).getValue(media.mutableBytes);
    const pageInfo = $.NSMutableDictionary.dictionary;
    pageInfo.setObjectForKey(media, 'MediaBox');
    const outputURL = $.NSURL.fileURLWithPath(outputPath);
    const pdf = $.CGPDFContextCreateWithURL(outputURL, null, null);
    if (!pdf) throw new Error('DNG PDF 출력 파일을 만들 수 없습니다.');
    try {
        $.CGPDFContextBeginPage(pdf, pageInfo);
        $.CGContextDrawImage(pdf, pageRect, raster);
        $.CGPDFContextEndPage(pdf);
    } finally {
        $.CGPDFContextClose(pdf);
    }
    const result = $.PDFDocument.alloc.initWithURL(outputURL);
    if (!result || Number(result.pageCount) !== 1) throw new Error('DNG PDF의 단일 페이지를 확인할 수 없습니다.');
    const box = result.pageAtIndex(0).boundsForBox(0);
    if (box.size.width !== width || box.size.height !== height) throw new Error('DNG PDF 페이지 크기가 일치하지 않습니다.');
    return argv[1];
}
