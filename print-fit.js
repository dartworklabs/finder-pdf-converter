/* macOS JXA: render a batch through PDFKit using the selected printer's imageable area. */
ObjC.import('AppKit');
ObjC.import('PDFKit');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

/** Parse the private batch interface, rejecting ambiguous or incomplete arguments. */
function argumentsForBatch(argv) {
    const args = { proof: null, merge: null, selection: null };
    let i = 0;
    while (i < argv.length && argv[i] !== '--') {
        const option = argv[i++];
        const key = { '--proof': 'proof', '--merge': 'merge', '--selection': 'selection' }[option];
        if (!key || args[key] !== null || i >= argv.length || argv[i][0] !== '/') {
            throw new Error('Invalid batch option or absolute path.');
        }
        args[key] = argv[i++];
    }
    if (argv[i++] !== '--' || i === argv.length || (args.proof && args.merge)) {
        throw new Error('Usage: print-fit.js [--selection /selection.json] [--proof /proof.pdf | --merge /output.pdf] -- /input.pdf ...');
    }
    args.paths = argv.slice(i);
    if (args.paths.some(path => path[0] !== '/')) throw new Error('Input paths must be absolute.');
    return args;
}

/** Read and validate all source pages before any printing or output is attempted. */
function readDocuments(paths, copying) {
    return paths.map(path => {
        const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath($(path)));
        if (doc.isNil() || doc.isLocked || (copying ? !doc.allowsCopying : !doc.allowsPrinting) || Number(doc.pageCount) === 0) {
            throw new Error('Cannot read a permitted, unlocked, nonempty PDF: ' + path);
        }
        for (let i = 0; i < Number(doc.pageCount); i++) {
            if (doc.pageAtIndex(i).isNil()) throw new Error('Cannot read a PDF page: ' + path);
        }
        return doc;
    });
}

/** Convert reviewed selection to an ordered sequence after validating the entire selection. */
function selectedPages(path, docs) {
    if (!path) return docs.map((doc, index) => ({ index, pages: Array.from({length: Number(doc.pageCount)}, (_, i) => i + 1) }));
    const data = $.NSData.dataWithContentsOfFile($(path));
    if (data.isNil() || Number(data.length) > 10 * 1024 * 1024) throw new Error('Cannot read selection.');
    const string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    if (string.isNil()) throw new Error('Invalid selection encoding.');
    let selection;
    try { selection = JSON.parse(ObjC.unwrap(string)); } catch (_) { throw new Error('Invalid selection JSON.'); }
    if (!selection || selection.version !== 1 || selection.cancelled !== false || !Array.isArray(selection.files)) throw new Error('Invalid selection.');
    const seenFiles = new Set();
    let total = 0;
    const files = selection.files.map(file => {
        if (!file || !Number.isSafeInteger(file.index) || file.index < 0 || file.index >= docs.length || seenFiles.has(file.index) || !Array.isArray(file.pages)) throw new Error('Invalid selected file.');
        seenFiles.add(file.index);
        const seenPages = new Set();
        for (const page of file.pages) {
            if (!Number.isSafeInteger(page) || page < 1 || page > Number(docs[file.index].pageCount) || seenPages.has(page)) throw new Error('Invalid selected page.');
            seenPages.add(page);
            total++;
        }
        if (file.name !== undefined && (typeof file.name !== 'string' || !file.name || file.name.length > 4096)) throw new Error('Invalid selected filename.');
        return {index: file.index, pages: file.pages, name: file.name};
    });
    if (!total) throw new Error('No pages selected.');
    return files;
}

/** Assemble the selected original PDF pages without rendering or changing their geometry. */
function combineDocuments(docs, selection, paths, bookmarks) {
    const combined = $.PDFDocument.alloc.init;
    const outline = bookmarks ? $.PDFOutline.alloc.init : null;
    for (const file of selection) {
        const first = Number(combined.pageCount);
        for (const page of file.pages) {
            combined.insertPageAtIndex(docs[file.index].pageAtIndex(page - 1), combined.pageCount);
        }
        if (outline && file.pages.length) {
            const bookmark = $.PDFOutline.alloc.init;
            bookmark.label = $(file.name || ObjC.unwrap($(paths[file.index]).lastPathComponent));
            bookmark.destination = $.PDFDestination.alloc.initWithPageAtPoint(combined.pageAtIndex(first), $.NSMakePoint(0, 0));
            outline.insertChildAtIndex(bookmark, outline.numberOfChildren);
        }
    }
    if (outline) combined.outlineRoot = outline;
    return combined;
}

// The view draws one already-positioned page into a vector PDF context.
let pageToDraw = null;
let placement = null;
ObjC.registerSubclass({
    name: 'FinderPdfFitPageView',
    superclass: 'NSView',
    methods: {
        'drawRect:': function () {
            const context = $.NSGraphicsContext.currentContext.CGContext;
            $.CGContextSaveGState(context);
            $.CGContextTranslateCTM(context, placement.x, placement.y);
            if (placement.rotate) {
                $.CGContextTranslateCTM(context, placement.height, 0);
                $.CGContextRotateCTM(context, Math.PI / 2);
            }
            $.CGContextScaleCTM(context, placement.scale, placement.scale);
            pageToDraw.drawWithBoxToContext(1, context);
            $.CGContextRestoreGState(context);
        }
    }
});

/** Create paper-sized vector pages centered inside the selected printer's imageable area. */
function layoutPages(doc, info) {
    const paper = ObjC.deepUnwrap(info.paperSize);
    const area = ObjC.deepUnwrap(info.imageablePageBounds);
    const x = area.origin.x, y = area.origin.y, w = area.size.width, h = area.size.height;
    if (![paper.width, paper.height, x, y, w, h].every(Number.isFinite) ||
        w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > paper.width + 0.1 || y + h > paper.height + 0.1) {
        throw new Error('The selected printer did not provide a usable printable area.');
    }
    const output = $.PDFDocument.alloc.init;
    const rect = $.NSMakeRect(0, 0, paper.width, paper.height);
    const view = $.FinderPdfFitPageView.alloc.initWithFrame(rect);
    for (let i = 0; i < doc.pageCount; i++) {
        pageToDraw = doc.pageAtIndex(i);
        const bounds = ObjC.deepUnwrap(pageToDraw.boundsForBox(1));
        const rotation = ((pageToDraw.rotation % 360) + 360) % 360;
        if (rotation % 90 !== 0 || bounds.size.width <= 0 || bounds.size.height <= 0) {
            throw new Error('The PDF contains an unsupported page size or rotation.');
        }
        const width = rotation % 180 ? bounds.size.height : bounds.size.width;
        const height = rotation % 180 ? bounds.size.width : bounds.size.height;
        const normal = Math.min(1, w / width, h / height);
        const turned = Math.min(1, w / height, h / width);
        const rotate = turned > normal + 1e-9;
        const scale = rotate ? turned : normal;
        const drawWidth = (rotate ? height : width) * scale;
        const drawHeight = (rotate ? width : height) * scale;
        // PDFKit centers a paper-sized page on the printer imageable rectangle.
        // Precompensate that translation so the final output uses paper coordinates.
        placement = { x: (paper.width - drawWidth) / 2, y: (paper.height - drawHeight) / 2,
            height: drawWidth, scale, rotate };
        const data = view.dataWithPDFInsideRect(rect);
        const rendered = $.PDFDocument.alloc.initWithData(data);
        if (rendered.isNil() || Number(rendered.pageCount) !== 1) throw new Error('Could not render a PDF page.');
        output.insertPageAtIndex(rendered.pageAtIndex(0), output.pageCount);
    }
    pageToDraw = null;
    placement = null;
    return output;
}

/** Set the print system to place each prepared paper-sized page at 100%. */
function disableAdditionalScaling(info) {
    info.leftMargin = 0; info.rightMargin = 0; info.topMargin = 0; info.bottomMargin = 0;
    const settings = info.dictionary;
    settings.setObjectForKey($(1), $.NSPrintScalingFactor);
    settings.setObjectForKey($(1), $.NSPrintPagesAcross);
    settings.setObjectForKey($(1), $.NSPrintPagesDown);
}

/** Render one validated batch; return cancelled or completed for an interactive caller. */
function printFitRun(argv) {
    const args = argumentsForBatch(argv);
    const docs = readDocuments(args.paths, !!args.merge);
    const selection = selectedPages(args.selection, docs);
    const doc = combineDocuments(docs, selection, args.paths, !!args.merge);
    if (args.merge) {
        const data = doc.dataRepresentation;
        if (data.isNil() || !data.writeToURLOptionsError($.NSURL.fileURLWithPath($(args.merge)), 2, null)) {
            throw new Error('Could not write new merge output.');
        }
        return;
    }
    $.NSApplication.sharedApplication;
    const info = $.NSPrintInfo.sharedPrintInfo.copy;
    if (info.printer.isNil()) throw new Error('No default printer is available.');
    if (args.proof) {
        if ($.NSFileManager.defaultManager.fileExistsAtPath($(args.proof))) throw new Error('Proof destination already exists.');
        info.jobDisposition = $.NSPrintSaveJob;
        info.dictionary.setObjectForKey($.NSURL.fileURLWithPath($(args.proof)), $.NSPrintJobSavingURL);
    } else {
        $.NSApp.setActivationPolicy(1);
        $.NSApp.activateIgnoringOtherApps(true);
        const panel = $.NSPrintPanel.printPanel;
        // This action always prints the complete batch. A standalone panel does
        // not know its page count, so do not present a misleading page range.
        panel.options = 1 | 4 | 8;
        if (Number(panel.runModalWithPrintInfo(info)) !== 1) return 'cancelled';
        const settings = info.dictionary;
        settings.setObjectForKey($(true), $.NSPrintAllPages);
        settings.setObjectForKey($(1), $.NSPrintFirstPage);
        settings.setObjectForKey($(Number(doc.pageCount)), $.NSPrintLastPage);
        const disposition = ObjC.unwrap(info.jobDisposition);
        if (disposition !== ObjC.unwrap($.NSPrintSpoolJob) &&
            disposition !== ObjC.unwrap($.NSPrintSaveJob)) {
            throw new Error('The print panel did not select a supported destination.');
        }
    }
    const laidOut = layoutPages(doc, info);
    disableAdditionalScaling(info);
    // Prepared pages already match the chosen paper, so no second fit is applied.
    const operation = laidOut.printOperationForPrintInfoScalingModeAutoRotate(info, 0, false);
    if (operation.isNil()) throw new Error('Could not create the print operation.');
    operation.showsPrintPanel = false;
    operation.showsProgressPanel = false;
    if (!operation.runOperation) throw new Error('The print operation failed.');
    if (args.proof && !$.NSFileManager.defaultManager.fileExistsAtPath($(args.proof))) throw new Error('The proof PDF was not created.');
    return 'completed';
}

/** Preserve the CLI entry point and dispatch to the bundled app when present. */
function run(argv) {
    if (typeof printPanelAppRun === 'function') return printPanelAppRun(argv);
    printFitRun(argv);
}
