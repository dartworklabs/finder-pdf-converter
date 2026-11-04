/* Native AppKit/PDFKit review of a private conversion batch. */
ObjC.import('AppKit');
ObjC.import('PDFKit');
ObjC.import('Foundation');

var review = null;
var strings = {
    en: {
        title: 'Review Documents',
        documents: 'Documents',
        pages: 'Pages (blank for all)',
        hint: 'For example: 1, 3-5',
        include: 'Include this document',
        up: 'Move Up',
        down: 'Move Down',
        cancel: 'Cancel',
        print: 'Print Settings…',
        merge: 'Save PDF…',
        invalid: 'Enter valid, non-repeated page numbers within the document.',
        empty: 'Include at least one document.',
        occupied: 'Choose a new filename. The selected path already exists.',
        bad: 'The document could not be opened.',
        count: 'pages',
        save: 'Save merged PDF'
    },
    ko: {
        title: '문서 검토',
        documents: '문서',
        pages: '페이지 (비우면 전체)',
        hint: '예: 1, 3-5',
        include: '이 문서 포함',
        up: '위로 이동',
        down: '아래로 이동',
        cancel: '취소',
        print: '인쇄 설정…',
        merge: 'PDF 저장…',
        invalid: '문서 범위 안에서 중복되지 않는 페이지 번호를 입력하세요.',
        empty: '문서를 하나 이상 포함하세요.',
        occupied: '새 파일 이름을 선택하세요. 선택한 경로에 이미 항목이 있습니다.',
        bad: '문서를 열 수 없습니다.',
        count: '페이지',
        save: '병합 PDF 저장'
    }
};

/** Present a localized error without closing the review window. */
function reviewAlert(message) {
    var alert = $.NSAlert.alloc.init;
    alert.messageText = $(message);
    alert.runModal;
}

/** Atomically publish the result only after it is complete. */
function writeResult(value) {
    var json = JSON.stringify(value);
    var data = $(json).dataUsingEncoding($.NSUTF8StringEncoding);
    if (!data.writeToFileOptionsError($(review.manifest.selectionPath), 1, null)) {
        throw new Error('Cannot write selection.');
    }
}

/** Persist edits before changing the selected document. */
function saveCurrent() {
    if (review.current < 0) return;
    var item = review.items[review.current];
    item.range = ObjC.unwrap(review.range.stringValue);
    item.included = Number(review.include.state) === 1;
}

/** Preview all included pages in their selected output order. */
function previewCurrent() {
    if (review.current < 0) return;
    saveCurrent();
    var result = $.PDFDocument.alloc.init;
    var target = -1;
    try {
        review.items.forEach(function (item, index) {
            if (!item.included) return;
            var pages = ReviewModel.parseRange(item.range, item.count);
            if (index === review.current) target = Number(result.pageCount);
            pages.forEach(function (number) {
                result.insertPageAtIndex(item.doc.pageAtIndex(number - 1).copy, result.pageCount);
            });
        });
    } catch (error) {
        review.pdf.document = $.PDFDocument.alloc.init;
        review.status.stringValue = $(review.t.invalid);
        return;
    }
    review.pdf.document = result;
    review.status.stringValue = $(Number(result.pageCount) + ' ' + review.t.count);
    if (target >= 0) review.pdf.goToPage(result.pageAtIndex(target));
}

/** Rebuild the native source list from current order and selection. */
function redrawList() {
    var container = review.list.documentView;
    container.subviews.makeObjectsPerformSelector('removeFromSuperview');
    var height = Math.max(440, review.items.length * 34 + 8);
    container.setFrameSize($.NSMakeSize(244, height));
    review.items.forEach(function (item, index) {
        var sourceButton = $.NSButton.alloc.initWithFrame(
            $.NSMakeRect(4, height - 34 * (index + 1), 236, 30)
        );
        sourceButton.title = $((item.included ? '☑ ' : '☐ ') + item.name);
        sourceButton.setAccessibilityIdentifier($('source-' + item.index));
        sourceButton.tag = index;
        sourceButton.bezelStyle = 0;
        sourceButton.setButtonType(7);
        sourceButton.state = index === review.current ? 1 : 0;
        sourceButton.target = review.handler;
        sourceButton.action = 'choose:';
        container.addSubview(sourceButton);
    });
}

/** Show the active document's controls and selected pages. */
function showCurrent() {
    var item = review.items[review.current];
    review.range.stringValue = $(item.range);
    review.include.state = item.included ? 1 : 0;
    redrawList();
    previewCurrent();
}

/** Construct a standard native control at fixed window coordinates. */
function label(text, x, y, width, height, fontSize) {
    var field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(x, y, width, height));
    field.stringValue = $(text);
    field.editable = false;
    field.selectable = false;
    field.bezeled = false;
    field.drawsBackground = false;
    field.font = $.NSFont.systemFontOfSize(fontSize || 13);
    return field;
}

/** Create a native push button with an action on the review controller. */
function button(text, x, y, width, action) {
    var control = $.NSButton.alloc.initWithFrame($.NSMakeRect(x, y, width, 30));
    control.title = $(text);
    control.setAccessibilityIdentifier($(action.slice(0, -1)));
    control.bezelStyle = 1;
    control.target = review.handler;
    control.action = action;
    return control;
}

ObjC.registerSubclass({
    name: 'FinderPDFReviewController',
    superclass: 'NSObject',
    protocols: ['NSWindowDelegate', 'NSTextFieldDelegate'],
    methods: {
        'choose:': {
            types: ['void', ['id']],
            implementation: function (sender) {
                saveCurrent();
                review.current = Number(sender.tag);
                showCurrent();
            }
        },
        'changed:': {
            types: ['void', ['id']],
            implementation: function () {
                previewCurrent();
                redrawList();
            }
        },
        'controlTextDidChange:': function () {
            previewCurrent();
        },
        'up:': {
            types: ['void', ['id']],
            implementation: function () {
                saveCurrent();
                var index = review.current;
                if (index > 0) {
                    var previous = review.items[index - 1];
                    review.items[index - 1] = review.items[index];
                    review.items[index] = previous;
                    review.current--;
                    showCurrent();
                }
            }
        },
        'down:': {
            types: ['void', ['id']],
            implementation: function () {
                saveCurrent();
                var index = review.current;
                if (index < review.items.length - 1) {
                    var next = review.items[index + 1];
                    review.items[index + 1] = review.items[index];
                    review.items[index] = next;
                    review.current++;
                    showCurrent();
                }
            }
        },
        'cancel:': {
            types: ['void', ['id']],
            implementation: function () {
                writeResult({version: 1, cancelled: true});
                review.finished = true;
                $.NSApp.stopModal;
            }
        },
        'windowShouldClose:': function () {
            if (!review.finished) {
                writeResult({version: 1, cancelled: true});
                review.finished = true;
                $.NSApp.stopModal;
            }
            return true;
        },
        'accept:': {
            types: ['void', ['id']],
            implementation: function () {
                saveCurrent();
                var files;
                try {
                    files = ReviewModel.selection(review.items);
                } catch (error) {
                    reviewAlert(error.message === 'empty' ? review.t.empty : review.t.invalid);
                    return;
                }
                files.forEach(function (file) {
                    file.name = review.manifest.files[file.index].name;
                });
                var output = {version: 1, cancelled: false, files: files};
                if (review.manifest.mode === 'merge') {
                    var panel = $.NSSavePanel.savePanel;
                    panel.title = $(review.t.save);
                    panel.allowedFileTypes = $(['pdf']);
                    panel.nameFieldStringValue = $('Merged.pdf');
                    if (Number(panel.runModal) !== 1) return;
                    var path = ObjC.unwrap(panel.URL.path);
                    if ($.NSFileManager.defaultManager.fileExistsAtPath($(path))) {
                        reviewAlert(review.t.occupied);
                        return;
                    }
                    output.destination = path;
                }
                writeResult(output);
                review.finished = true;
                $.NSApp.stopModal;
            }
        }
    }
});

/** Read and validate the private manifest and prepare native PDF documents. */
function loadManifest(path) {
    if (!path || path[0] !== '/') throw new Error('Manifest path must be absolute.');
    var bytes = $.NSData.dataWithContentsOfFile($(path));
    if (bytes.isNil() || Number(bytes.length) > 1048576) throw new Error('Cannot read manifest.');
    var text = $.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding);
    var manifest = JSON.parse(ObjC.unwrap(text));
    if (!manifest || manifest.version !== 1 ||
        !['print', 'merge'].includes(manifest.mode) ||
        !['en', 'ko'].includes(manifest.language) ||
        !Array.isArray(manifest.files) || !manifest.files.length ||
        manifest.files.length > 1000 || typeof manifest.selectionPath !== 'string' ||
        manifest.selectionPath[0] !== '/') {
        throw new Error('Invalid manifest.');
    }
    var items = manifest.files.map(function (file, index) {
        if (!file || typeof file.pdf !== 'string' || file.pdf[0] !== '/' ||
            typeof file.name !== 'string') {
            throw new Error('Invalid file.');
        }
        var document = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath($(file.pdf)));
        if (document.isNil() || document.isLocked || Number(document.pageCount) < 1) {
            throw new Error(strings[manifest.language].bad);
        }
        return {
            index: index,
            name: file.name,
            doc: document,
            count: Number(document.pageCount),
            range: '',
            included: true
        };
    });
    return {
        manifest: manifest,
        items: items,
        current: 0,
        t: strings[manifest.language],
        finished: false
    };
}

/** Launch a regular app window and wait until the user accepts or cancels. */
function run(argv) {
    var args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
    // Launch Services may reopen this internal app without a batch.
    // Ignore its process serial number, but reject other malformed invocations.
    if (args.slice(1).every(function (arg) { return /^-psn_[0-9]+_[0-9]+$/.test(arg); })) return;
    var position = args.indexOf('--manifest');
    if (position < 0 || position + 1 >= args.length || args.lastIndexOf('--manifest') !== position) {
        throw new Error('Expected --manifest path.');
    }
    review = loadManifest(args[position + 1]);
    $.NSApplication.sharedApplication;
    $.NSApp.setActivationPolicy(0);
    $.NSApp.finishLaunching;
    review.handler = $.FinderPDFReviewController.alloc.init;
    var window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 980, 700), 7, 2, false
    );
    review.window = window;
    window.title = $(review.t.title);
    window.delegate = review.handler;
    window.center;
    var content = window.contentView;
    content.addSubview(label(review.t.documents, 20, 650, 220, 22, 16));
    var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(20, 180, 244, 465));
    scroll.hasVerticalScroller = true;
    scroll.borderType = 1;
    scroll.documentView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 244, 465));
    review.list = scroll;
    content.addSubview(scroll);
    content.addSubview(button(review.t.up, 20, 140, 118, 'up:'));
    content.addSubview(button(review.t.down, 146, 140, 118, 'down:'));
    review.include = $.NSButton.alloc.initWithFrame($.NSMakeRect(20, 108, 244, 24));
    review.include.setButtonType(3);
    review.include.title = $(review.t.include);
    review.include.setAccessibilityIdentifier($('include-document'));
    review.include.target = review.handler;
    review.include.action = 'changed:';
    content.addSubview(review.include);
    content.addSubview(label(review.t.pages, 20, 80, 244, 20));
    review.range = $.NSTextField.alloc.initWithFrame($.NSMakeRect(20, 52, 244, 25));
    review.range.delegate = review.handler;
    review.range.setAccessibilityLabel($(review.t.pages));
    review.range.setAccessibilityIdentifier($('page-range'));
    review.range.placeholderString = $(review.t.hint);
    content.addSubview(review.range);
    review.pdf = $.PDFView.alloc.initWithFrame($.NSMakeRect(280, 70, 680, 575));
    review.pdf.autoScales = true;
    review.pdf.displayMode = 1;
    content.addSubview(review.pdf);
    review.status = label('', 280, 652, 300, 20);
    content.addSubview(review.status);
    var cancelButton = button(review.t.cancel, 748, 20, 95, 'cancel:');
    cancelButton.keyEquivalent = $('\u001b');
    content.addSubview(cancelButton);
    var acceptButton = button(
        review.manifest.mode === 'print' ? review.t.print : review.t.merge,
        850, 20, 110, 'accept:'
    );
    acceptButton.keyEquivalent = $('\r');
    content.addSubview(acceptButton);
    showCurrent();
    window.makeKeyAndOrderFront(null);
    window.orderFrontRegardless;
    window.makeMainWindow;
    $.NSApp.activateIgnoringOtherApps(true);
    $.NSApp.runModalForWindow(window);
}
