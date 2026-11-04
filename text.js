/** Offline TXT/Markdown/CSV-to-PDF adapter for macOS JXA.
 * Public surface: run([absolutePrivateInput, absoluteNewOutput]). Markdown calls
 * trusted sibling markdown.js's parseMarkdown, concatenated by the caller.
 * Input text is never evaluated or passed to an HTML/web rendering engine.
 */
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('CoreFoundation');

var TEXT_MAX_BYTES = 16 * 1024 * 1024;
var TEXT_MAX_PAGES = 2000;
var TEXT_PAGE_WIDTH = 595.275590551;
var TEXT_PAGE_HEIGHT = 841.88976378;
var TEXT_MARGIN = 48;

/** Decode one supported encoding without substitution; reject invalid bytes.
 * UTF-8, BOM-marked UTF-16LE/BE, and roundtrip-safe Korean CP949/EUC-KR are
 * supported. UTF-32, embedded NUL, and binary control bytes are rejected.
 */
function readTextInput(path) {
    var attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
    if (!attributes || attributes.isNil()) throw new Error('텍스트 파일을 읽을 수 없습니다.');
    if (Number(attributes.objectForKey($.NSFileSize)) > TEXT_MAX_BYTES) throw new Error('텍스트 파일은 16 MiB까지만 변환할 수 있습니다.');
    var data = $.NSData.dataWithContentsOfFileOptionsError(path, $.NSDataReadingMappedIfSafe, null);
    if (!data || data.isNil()) throw new Error('텍스트 파일을 읽을 수 없습니다.');
    var size = Number(data.length);
    if (size > TEXT_MAX_BYTES) throw new Error('텍스트 파일은 16 MiB까지만 변환할 수 있습니다.');
    var head = size ? ObjC.unwrap(data.subdataWithRange($.NSMakeRange(0, Math.min(4, size))).base64EncodedStringWithOptions(0)) : '';
    var prefix = size ? ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data.subdataWithRange($.NSMakeRange(0, Math.min(4, size))), $.NSISOLatin1StringEncoding)) : '';
    var offset = 0;
    var encodings;
    if (head === '//4AAA==' || head === 'AAD+/w==') throw new Error('UTF-32는 지원하지 않습니다. UTF-8로 저장해 주세요.');
    if (prefix.charCodeAt(0) === 255 && prefix.charCodeAt(1) === 254) {
        offset = 2; encodings = [$.NSUTF16LittleEndianStringEncoding];
    } else if (prefix.charCodeAt(0) === 254 && prefix.charCodeAt(1) === 255) {
        offset = 2; encodings = [$.NSUTF16BigEndianStringEncoding];
    } else {
        if (prefix.slice(0, 3) === '\u00ef\u00bb\u00bf') offset = 3;
        encodings = offset ? [$.NSUTF8StringEncoding] : [$.NSUTF8StringEncoding,
            $.CFStringConvertEncodingToNSStringEncoding(0x0422),
            $.CFStringConvertEncodingToNSStringEncoding(0x0940)];
    }
    var payload = offset ? data.subdataWithRange($.NSMakeRange(offset, size - offset)) : data;
    var decoded = null;
    for (var index = 0; index < encodings.length; index++) {
        var native = $.NSString.alloc.initWithDataEncoding(payload, encodings[index]);
        if (!native || native.isNil()) continue;
        var roundtrip = native.dataUsingEncodingAllowLossyConversion(encodings[index], false);
        if (roundtrip && !roundtrip.isNil() && roundtrip.isEqualToData(payload)) { decoded = ObjC.unwrap(native); break; }
    }
    if (decoded === null) throw new Error('지원하는 텍스트 인코딩이 아니거나 바이트가 손상되었습니다. UTF-8 또는 BOM이 있는 UTF-16으로 저장해 주세요.');
    if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(decoded)) {
        throw new Error('텍스트에 지원하지 않는 제어 문자나 바이너리 데이터가 있습니다.');
    }
    return decoded.replace(/\r\n?/g, '\n').replace(/\f/g, '\n');
}

/** Return an installed font, using native fallback for Korean and emoji glyphs. */
function textFont(size, bold, italic, mono) {
    var font = mono ? $.NSFont.fontWithNameSize('Menlo-Regular', size) : $.NSFont.systemFontOfSize(size);
    if (!font || font.isNil()) font = $.NSFont.systemFontOfSize(size);
    var traits = (bold ? $.NSBoldFontMask : 0) | (italic ? $.NSItalicFontMask : 0);
    return traits ? $.NSFontManager.sharedFontManager.convertFontToHaveTrait(font, traits) : font;
}

/** Append styled text runs to a native attributed string, preserving plain text.
 * Only parser-produced display text and a closed set of style flags are read.
 */
function appendTextBlock(document, text, runs, options) {
    var start = Number(document.length);
    var value = String(text) + '\n';
    document.replaceCharactersInRangeWithString($.NSMakeRange(start, 0), value);
    var paragraph = $.NSMutableParagraphStyle.alloc.init;
    paragraph.lineBreakMode = $.NSLineBreakByWordWrapping;
    paragraph.lineSpacing = options.mono ? 3 : 4;
    paragraph.paragraphSpacing = options.after === undefined ? 7 : options.after;
    paragraph.paragraphSpacingBefore = options.before || 0;
    paragraph.headIndent = options.indent || 0;
    paragraph.firstLineHeadIndent = options.indent || 0;
    paragraph.defaultTabInterval = options.size * 2.4;
    if (options.tabPositions) {
        paragraph.tabStops = $(options.tabPositions.map(function (position) {
            return $.NSTextTab.alloc.initWithTextAlignmentLocationOptions($.NSTextAlignmentLeft, position, $({}));
        }));
    }
    var attrs = $.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey(textFont(options.size, options.bold, false, options.mono), $.NSFontAttributeName);
    attrs.setObjectForKey(paragraph, $.NSParagraphStyleAttributeName);
    attrs.setObjectForKey($.NSColor.colorWithCalibratedWhiteAlpha(options.quote ? 0.3 : 0.1, 1), $.NSForegroundColorAttributeName);
    if (options.mono) attrs.setObjectForKey($.NSColor.colorWithCalibratedWhiteAlpha(0.95, 1), $.NSBackgroundColorAttributeName);
    document.setAttributesRange(attrs, $.NSMakeRange(start, value.length));
    if (!runs) return;
    var cursor = start;
    for (var index = 0; index < runs.length; index++) {
        var run = runs[index];
        var length = String(run.text).length;
        if (cursor + length > start + text.length) throw new Error('Markdown 스타일 범위가 올바르지 않습니다.');
        var range = $.NSMakeRange(cursor, length);
        document.addAttributeValueRange($.NSFontAttributeName,
            textFont(options.size, !!options.bold || !!run.bold, !!run.italic, !!options.mono || !!run.code), range);
        if (run.strike) document.addAttributeValueRange($.NSStrikethroughStyleAttributeName, 1, range);
        if (run.code) document.addAttributeValueRange($.NSBackgroundColorAttributeName,
            $.NSColor.colorWithCalibratedWhiteAlpha(0.94, 1), range);
        cursor += length;
    }
    if (cursor !== start + text.length) throw new Error('Markdown 스타일과 본문 길이가 다릅니다.');
}

/** Approximate display width for fixed-width tables, treating CJK as two cells. */
function tableCharacterWidth(character) {
    var code = character.codePointAt(0);
    return (code >= 0x1100 && (code <= 0x115f || code >= 0x2e80)) ? 2 : 1;
}

/** Wrap a cell to a bounded display width; no text is discarded. */
function wrapTableCell(text, width) {
    var lines = [], line = '', used = 0;
    var characters = Array.from(String(text));
    for (var index = 0; index < characters.length; index++) {
        var character = characters[index];
        var amount = tableCharacterWidth(character);
        if (character === '\n' || (used + amount > width && line)) {
            lines.push({text: line, width: used}); line = ''; used = 0;
            if (character === '\n') continue;
        }
        line += character; used += amount;
    }
    lines.push({text: line, width: used});
    return lines;
}

/** Render a Markdown table as wrapped fixed-width columns with visible dividers.
 * Wide tables use stacked labelled cells so every cell remains readable.
 */
function appendTextTable(document, block) {
    var columns = block.headers.length;
    var rows = [block.headers].concat(block.rows);
    if (columns > 6) {
        appendTextBlock(document, block.headers.join(' | '), null, {size: 10.5, bold: true, after: 5});
        for (var row = 1; row < rows.length; row++) {
            for (var column = 0; column < columns; column++) {
                appendTextBlock(document, block.headers[column] + ': ' + String(rows[row][column] || ''), null,
                    {size: 10.5, after: 3, bold: false});
            }
            appendTextBlock(document, '', null, {size: 3, after: 3});
        }
        return;
    }
    var tabPositions = [];
    for (var tab = 1; tab < columns; tab++) tabPositions.push(tab * (TEXT_PAGE_WIDTH - 2 * TEXT_MARGIN) / columns);
    var cellWidth = Math.max(4, Math.floor((76 - (columns - 1) * 3) / columns));
    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        var cells = rows[rowIndex].map(function (cell) { return wrapTableCell(cell, cellWidth); });
        var height = cells.reduce(function (maximum, cell) { return Math.max(maximum, cell.length); }, 1);
        var lines = [];
        for (var line = 0; line < height; line++) {
            var pieces = [];
            for (var cell = 0; cell < columns; cell++) {
                var entry = cells[cell][line] || {text: '', width: 0};
                pieces.push(entry.text);
            }
            lines.push(pieces.join('\t│ ').replace(/ +$/, ''));
        }
        appendTextBlock(document, lines.join('\n'), null, {size: 9.7, mono: true, bold: rowIndex === 0, after: 3, tabPositions: tabPositions});
    }
}

/** Convert trusted-parser blocks or literal TXT into a styled native document. */
function buildTextDocument(source, markdown) {
    var document = $.NSMutableAttributedString.alloc.init;
    if (!markdown) {
        appendTextBlock(document, source, null, {size: 11.5, after: 0});
        return document;
    }
    if (typeof parseMarkdown !== 'function') throw new Error('Markdown 변환 도우미가 없습니다. 변환기를 다시 설치해 주세요.');
    var blocks = parseMarkdown(source);
    for (var index = 0; index < blocks.length; index++) {
        var block = blocks[index];
        switch (block.type) {
        case 'heading':
            appendTextBlock(document, block.text, block.runs, {size: [25, 21, 18, 15, 13, 12][block.level - 1], bold: true, before: 10, after: 10});
            break;
        case 'paragraph':
            appendTextBlock(document, block.text, block.runs, {size: 11.5}); break;
        case 'quote':
            appendTextBlock(document, block.text, block.runs, {size: 11.5, quote: true, indent: 16}); break;
        case 'code':
            appendTextBlock(document, block.text, null, {size: 10.2, mono: true, after: 10}); break;
        case 'list':
            for (var itemIndex = 0; itemIndex < block.items.length; itemIndex++) {
                var item = block.items[itemIndex];
                var ordered = item.ordered === undefined ? block.ordered : item.ordered;
                var marker = ordered ? String(item.ordinal === undefined || item.ordinal === null ? itemIndex + 1 : item.ordinal) + '. ' : '• ';
                var itemRuns = [{text: marker}].concat(item.runs || [{text: item.text}]);
                appendTextBlock(document, marker + item.text, itemRuns, {size: 11.5, indent: Math.min(8, item.depth || 0) * 14, after: 4});
            }
            break;
        case 'table': appendTextTable(document, block); break;
        case 'rule': appendTextBlock(document, '────────────────────────', null, {size: 10, quote: true, after: 10}); break;
        default: throw new Error('지원하지 않는 Markdown 블록입니다.');
        }
    }
    if (!Number(document.length)) appendTextBlock(document, '', null, {size: 11.5});
    return document;
}

/** Paginate the entire native text layout and draw every glyph into an A4 PDF.
 * Containers split huge paragraphs and code across pages. Layout must advance;
 * a 2,000-page limit bounds work before the caller can publish the result.
 */
function writeTextPDF(document, output) {
    var storage = $.NSTextStorage.alloc.init;
    storage.setAttributedString(document);
    var layout = $.NSLayoutManager.alloc.init;
    storage.addLayoutManager(layout);
    var pages = [], consumed = 0, total = Number(layout.numberOfGlyphs);
    while (consumed < total || pages.length === 0) {
        if (pages.length >= TEXT_MAX_PAGES) throw new Error('PDF가 2,000쪽을 넘어 변환을 중단했습니다. 파일을 나눠 주세요.');
        var container = $.NSTextContainer.alloc.initWithContainerSize(
            $.NSMakeSize(TEXT_PAGE_WIDTH - 2 * TEXT_MARGIN, TEXT_PAGE_HEIGHT - 2 * TEXT_MARGIN - 18));
        container.lineFragmentPadding = 0;
        layout.addTextContainer(container);
        var range = layout.glyphRangeForTextContainer(container);
        var next = Number(range.location) + Number(range.length);
        if (next <= consumed && consumed < total) throw new Error('텍스트 페이지를 나눌 수 없습니다.');
        pages.push(range); consumed = next;
    }
    // CGRect is four little-endian CGFloat doubles; using the documented page
    // MediaBox NSData avoids JXA's unsupported CGRect* argument conversion.
    var mediaBox = $.NSData.alloc.initWithBase64EncodedStringOptions('AAAAAAAAAAAAAAAAAAAAAA6d0Wg0moJAHwJ5PB5PikA=', 0);
    var context = $.CGPDFContextCreateWithURL($.NSURL.fileURLWithPath(output), null, null);
    if (!context) throw new Error('PDF 출력 파일을 만들 수 없습니다.');
    try {
        for (var page = 0; page < pages.length; page++) {
            $.CGPDFContextBeginPage(context, $({MediaBox: mediaBox}));
            $.CGContextSaveGState(context);
            $.CGContextTranslateCTM(context, 0, TEXT_PAGE_HEIGHT);
            $.CGContextScaleCTM(context, 1, -1);
            $.NSGraphicsContext.saveGraphicsState;
            try {
                $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithCGContextFlipped(context, true));
                layout.drawBackgroundForGlyphRangeAtPoint(pages[page], $.NSMakePoint(TEXT_MARGIN, TEXT_MARGIN));
                layout.drawGlyphsForGlyphRangeAtPoint(pages[page], $.NSMakePoint(TEXT_MARGIN, TEXT_MARGIN));
                var footer = $.NSMutableAttributedString.alloc.init;
                footer.replaceCharactersInRangeWithString($.NSMakeRange(0, 0), String(page + 1) + ' / ' + String(pages.length));
                footer.addAttributeValueRange($.NSFontAttributeName, textFont(8.5, false, false, false), $.NSMakeRange(0, footer.length));
                footer.addAttributeValueRange($.NSForegroundColorAttributeName, $.NSColor.grayColor, $.NSMakeRange(0, footer.length));
                footer.drawAtPoint($.NSMakePoint(TEXT_MARGIN, TEXT_PAGE_HEIGHT - TEXT_MARGIN + 7));
            } finally { $.NSGraphicsContext.restoreGraphicsState; }
            $.CGContextRestoreGState(context);
            $.CGPDFContextEndPage(context);
        }
    } finally { $.CGPDFContextClose(context); }
    var result = $.NSData.dataWithContentsOfFile(output);
    if (!result || result.isNil() || Number(result.length) === 0) throw new Error('PDF를 저장할 수 없습니다.');
    return pages.length;
}

/** Convert only a caller-selected private TXT/MD/CSV copy to a new private PDF.
 * The caller owns isolation, publication, and cleanup; existing outputs refuse.
 */
function run(argv) {
    if (argv.length !== 2 || argv[0][0] !== '/' || argv[1][0] !== '/') throw new Error('텍스트 변환에는 절대 입력·출력 경로가 필요합니다.');
    var extension = argv[0].split('.').pop().toLowerCase();
    if (extension !== 'txt' && extension !== 'md' && extension !== 'markdown' && extension !== 'csv') throw new Error('TXT, MD 또는 CSV 파일만 텍스트로 변환할 수 있습니다.');
    if ($.NSFileManager.defaultManager.fileExistsAtPath(argv[1])) throw new Error('PDF 출력 경로에 파일이 이미 있습니다.');
    var source = readTextInput(argv[0]);
    $.NSApplication.sharedApplication;
    if (extension === 'csv' && typeof buildCSVDocument !== 'function') throw new Error('CSV 변환 도우미가 없습니다. 변환기를 다시 설치해 주세요.');
    var document = extension === 'csv' ? buildCSVDocument(source) : buildTextDocument(source, extension !== 'txt');
    writeTextPDF(document, argv[1]);
    return argv[1];
}
