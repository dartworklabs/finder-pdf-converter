/* macOS JXA: render a batch through PDFKit using the selected printer's imageable area. */
ObjC.import('AppKit');
ObjC.import('PDFKit');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');

/** Parse the private batch interface, rejecting ambiguous or incomplete arguments. */
function argumentsForBatch(argv) {
    let proof = null;
    let i = 0;
    if (argv[i] === '--proof') {
        proof = argv[++i];
        if (!proof || proof[0] !== '/') throw new Error('Proof destination must be an absolute path.');
        i++;
    }
    if (argv[i++] !== '--' || i === argv.length) throw new Error('Usage: print-fit.js [--proof /destination.pdf] -- /input.pdf ...');
    const paths = argv.slice(i);
    if (paths.some(path => path[0] !== '/')) throw new Error('Input paths must be absolute.');
    return { proof, paths };
}

/** Read every PDF before opening a panel; a bad input rejects the entire batch. */
function combineDocuments(paths) {
    const combined = $.PDFDocument.alloc.init;
    for (const path of paths) {
        const url = $.NSURL.fileURLWithPath($(path));
        const doc = $.PDFDocument.alloc.initWithURL(url);
        if (doc.isNil() || doc.isLocked || !doc.allowsPrinting || Number(doc.pageCount) === 0) throw new Error('Cannot read an unlocked, nonempty PDF: ' + path);
        for (let i = 0; i < doc.pageCount; i++) {
            const page = doc.pageAtIndex(i);
            if (page.isNil()) throw new Error('Cannot read a PDF page: ' + path);
            combined.insertPageAtIndex(page, combined.pageCount);
        }
    }
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

/** Run one native print panel for the batch, or save the identical drawing path as a proof. */
function run(argv) {
    const args = argumentsForBatch(argv);
    const doc = combineDocuments(args.paths);
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
        if (Number(panel.runModalWithPrintInfo(info)) !== 1) return;
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
}
