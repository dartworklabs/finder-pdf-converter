/* Native AppKit/PDFKit review of a private conversion batch. */
ObjC.import('AppKit');
ObjC.import('PDFKit');
ObjC.import('Foundation');

var review = null;
var progress = null;
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
    if (manifest && manifest.version === 1 && manifest.mode === 'progress') {
        return loadProgressManifest(manifest);
    }
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
    if (review.manifest.mode === 'progress') {
        progress = review;
        runProgress();
        return;
    }
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

/* The progress window talks only through files in the caller's private session. */
var progressStrings = {
    en: {
        title: 'Converting Documents', running: 'Converting documents…',
        retrying: 'Retrying failed files', cancelling: 'Cancelling after the current document…',
        complete: 'Conversion finished', cancelled: 'Conversion cancelled',
        error: 'Conversion stopped', unavailable: 'Progress is unavailable. Cancellation was requested.',
        cancel: 'Cancel', done: 'Done', retry: 'Retry Failed',
        completed: 'Completed', skipped: 'Skipped', failed: 'Failed', pending: 'Waiting',
        active: 'Converting', stopped: 'Cancelled', of: 'of', files: 'files', file: 'file'
    },
    ko: {
        title: '문서 변환', running: '문서를 변환하고 있습니다…',
        retrying: '실패한 파일 다시 변환', cancelling: '현재 문서를 마친 후 취소합니다…',
        complete: '변환 완료', cancelled: '변환 취소됨',
        error: '변환이 중단되었습니다', unavailable: '진행 상태를 읽을 수 없어 취소를 요청했습니다.',
        cancel: '취소', done: '완료', retry: '실패 항목 재시도',
        completed: '완료', skipped: '건너뜀', failed: '실패', pending: '대기 중',
        active: '변환 중', stopped: '취소됨', of: '/', files: '개 파일', file: '개 파일'
    }
};

/** Validate the paths given by the private session before showing a window. */
function loadProgressManifest(manifest) {
    if (!['en', 'ko'].includes(manifest.language) ||
        (manifest.autoCloseOnSuccess !== undefined && typeof manifest.autoCloseOnSuccess !== 'boolean') ||
        !['statusPath', 'commandPath', 'cancelPath', 'readyPath', 'shutdownPath'].every(function (key) {
            return typeof manifest[key] === 'string' && manifest[key][0] === '/';
        })) throw new Error('Invalid progress manifest.');
    return {manifest: manifest, t: progressStrings[manifest.language], attempt: 0,
        phase: 'running', cancelling: false, retryPending: false, finished: false};
}

/** Replace a session file atomically so the reader never observes partial JSON. */
function writeProgressFile(path, value) {
    var data = $(JSON.stringify(value)).dataUsingEncoding($.NSUTF8StringEncoding);
    if (!data.writeToFileOptionsError($(path), 1, null)) throw new Error('Cannot write session file.');
}

/** Atomically create an empty marker understood by the session worker. */
function writeProgressMarker(path) {
    if (!$.NSData.data.writeToFileOptionsError($(path), 1, null)) throw new Error('Cannot write session marker.');
}

/** Send a command tied to the displayed attempt. */
function progressCommand(action) {
    writeProgressFile(progress.manifest.commandPath,
        {version: 1, attempt: progress.attempt, action: action});
}

/** Ask the worker to stop before starting another document. */
function requestProgressCancel() {
    if (progress.cancelling) return;
    try {
        writeProgressMarker(progress.manifest.cancelPath);
        progressCommand('cancel');
        progress.cancelling = true;
        progress.heading.stringValue = $(progress.t.cancelling);
        progress.cancelButton.enabled = false;
    } catch (error) {
        reviewAlert(String(error));
    }
}

/** Parse a bounded status snapshot, rejecting invalid or inconsistent counts. */
function readProgressStatus() {
    var bytes = $.NSData.dataWithContentsOfFile($(progress.manifest.statusPath));
    if (bytes.isNil() || Number(bytes.length) > 16777216) throw new Error('Cannot read status.');
    var raw = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding)));
    var validInteger = function (value) { return Number.isInteger(value) && value >= 0; };
    if (!raw || raw.version !== 1 || !validInteger(raw.attempt) || raw.attempt < 1 ||
        !['running', 'complete', 'cancelled', 'error'].includes(raw.phase) ||
        !validInteger(raw.total) || !validInteger(raw.processed) ||
        raw.processed > raw.total || !Array.isArray(raw.items) || raw.items.length !== raw.total ||
        !raw.items.every(function (item) {
            return item && Number.isInteger(item.index) && item.index > 0 &&
                typeof item.name === 'string' && item.name.length <= 4096 &&
                ['pending', 'running', 'completed', 'skipped', 'failed', 'cancelled'].includes(item.status) &&
                (item.message === undefined || item.message === null || typeof item.message === 'string');
        })) throw new Error('Invalid status.');
    return raw;
}

/** End a timer-driven monitor after its terminal state has been published. */
function closeProgressWindow() {
    progress.finished = true;
    progress.timer.invalidate;
    // Terminate the app directly: stopModal alone may wait indefinitely for
    // a real user event when invoked from a timer during a modal session.
    $.NSApp.terminate(null);
}

/** Refresh native controls from one complete snapshot of the current attempt. */
function refreshProgress() {
    // Only the owner writes shutdown after its converter has stopped or never started.
    if ($.NSFileManager.defaultManager.fileExistsAtPath($(progress.manifest.shutdownPath))) {
        progress.heading.stringValue = $(progress.t.cancelled);
        closeProgressWindow();
        return;
    }
    var status;
    try {
        status = readProgressStatus();
        if (!progress.readyWritten) {
            writeProgressMarker(progress.manifest.readyPath);
            progress.readyWritten = true;
        }
    } catch (error) {
        // A broken status cannot safely authorize another document; request cancellation.
        requestProgressCancel();
        progress.heading.stringValue = $(progress.t.unavailable);
        progress.cancelButton.hidden = true;
        progress.retryButton.hidden = true;
        progress.doneButton.hidden = false;
        progress.doneButton.enabled = true;
        // Keep polling so owner shutdown can close a monitor with unreadable status.
        progress.phase = 'error';
        return;
    }
    if (status.attempt !== progress.attempt) {
        progress.attempt = status.attempt;
        progress.retryPending = false;
        progress.cancelling = false;
    }
    var running = status.phase === 'running';
    // A cancellation clicked after the worker's last snapshot still wins.
    var cancellationRequested = progress.cancelling || Boolean(
        $.NSFileManager.defaultManager.fileExistsAtPath($(progress.manifest.cancelPath)));
    progress.phase = !running && cancellationRequested ? 'cancelled' : status.phase;
    var t = progress.t;
    var heading = running ? (status.attempt > 1 ? t.retrying + ' — ' + status.total + ' ' + (status.total === 1 ? t.file : t.files) : t.running) :
        (status.phase === 'complete' ? t.complete : status.phase === 'cancelled' ? t.cancelled : t.error);
    progress.heading.stringValue = $(cancellationRequested ? (running ? t.cancelling : t.cancelled) : heading);
    progress.bar.maxValue = Math.max(1, status.total);
    progress.bar.doubleValue = status.processed;
    var current = typeof status.currentName === 'string' ? status.currentName : '';
    var countText = status.processed + ' ' + t.of + ' ' + status.total;
    if (running && current) countText += '  ·  ' + current;
    if (!running) {
        ['completed', 'skipped', 'failed', 'cancelled'].forEach(function (kind) {
            var count = status.items.filter(function (item) { return item.status === kind; }).length;
            if (count) countText += '  ·  ' + count + ' ' + (kind === 'cancelled' ? t.stopped : t[kind]);
        });
    }
    progress.count.stringValue = $(countText);
    var names = {pending: t.pending, running: t.active, completed: t.completed,
        skipped: t.skipped, failed: t.failed, cancelled: t.stopped};
    var lines = status.items.map(function (item) {
        return names[item.status] + '  ·  ' + item.name +
            (item.message ? '\n    ' + item.message : '');
    });
    progress.details.string = $(lines.join('\n'));
    var failed = status.items.some(function (item) { return item.status === 'failed'; });
    var canRetry = status.phase === 'complete' && failed && !cancellationRequested;
    progress.cancelButton.hidden = !running;
    progress.cancelButton.enabled = running && !progress.cancelling;
    progress.doneButton.hidden = running;
    progress.doneButton.enabled = !progress.retryPending;
    progress.retryButton.hidden = !canRetry;
    progress.retryButton.enabled = canRetry && !progress.retryPending;
    if (progress.manifest.autoCloseOnSuccess && status.phase === 'complete' && !failed) {
        try {
            progressCommand(cancellationRequested ? 'cancel' : 'close');
            closeProgressWindow();
        } catch (error) { reviewAlert(String(error)); }
    }
}

ObjC.registerSubclass({
    name: 'FinderPDFProgressController',
    superclass: 'NSObject',
    protocols: ['NSWindowDelegate'],
    methods: {
        'tick:': {types: ['void', ['id']], implementation: function () { refreshProgress(); }},
        'cancelProgress:': {types: ['void', ['id']], implementation: function () { requestProgressCancel(); }},
        'retryProgress:': {types: ['void', ['id']], implementation: function () {
            if (progress.retryPending || progress.phase === 'running') return;
            try {
                progressCommand('retry');
                progress.retryPending = true;
                progress.retryButton.enabled = false;
                progress.doneButton.enabled = false;
            } catch (error) { reviewAlert(String(error)); }
        }},
        'doneProgress:': {types: ['void', ['id']], implementation: function () {
            if (progress.retryPending) return;
            if (progress.phase === 'running') { requestProgressCancel(); return; }
            try { progressCommand('close'); } catch (error) { reviewAlert(String(error)); return; }
            progress.finished = true;
            progress.timer.invalidate;
            $.NSApp.stopModal;
        }},
        'windowShouldClose:': function () {
            if (progress.finished) return true;
            if (progress.retryPending) return false;
            if (progress.phase === 'running') { requestProgressCancel(); return false; }
            try { progressCommand('close'); } catch (error) { reviewAlert(String(error)); return false; }
            progress.finished = true;
            progress.timer.invalidate;
            $.NSApp.stopModal;
            return true;
        }
    }
});

/** Open the native progress window and poll until the user closes the result. */
function runProgress() {
    progress.handler = $.FinderPDFProgressController.alloc.init;
    var window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 600, 440), 7, 2, false);
    progress.window = window;
    window.title = $(progress.t.title);
    window.delegate = progress.handler;
    window.center;
    var content = window.contentView;
    progress.heading = label(progress.t.running, 24, 386, 550, 24, 16);
    content.addSubview(progress.heading);
    progress.bar = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 353, 552, 18));
    progress.bar.indeterminate = false;
    progress.bar.minValue = 0;
    content.addSubview(progress.bar);
    progress.count = label('', 24, 325, 552, 22);
    content.addSubview(progress.count);
    var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(24, 76, 552, 235));
    scroll.hasVerticalScroller = true;
    scroll.borderType = 1;
    progress.details = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 550, 235));
    progress.details.editable = false;
    progress.details.selectable = true;
    progress.details.font = $.NSFont.systemFontOfSize(13);
    scroll.documentView = progress.details;
    content.addSubview(scroll);
    // button() is shared with review and receives the active controller through review.
    review.handler = progress.handler;
    progress.cancelButton = button(progress.t.cancel, 466, 22, 110, 'cancelProgress:');
    progress.doneButton = button(progress.t.done, 466, 22, 110, 'doneProgress:');
    progress.retryButton = button(progress.t.retry, 310, 22, 148, 'retryProgress:');
    progress.doneButton.hidden = true;
    progress.retryButton.hidden = true;
    content.addSubview(progress.cancelButton);
    content.addSubview(progress.doneButton);
    content.addSubview(progress.retryButton);
    window.makeKeyAndOrderFront(null);
    window.orderFrontRegardless;
    window.makeMainWindow;
    $.NSApp.activateIgnoringOtherApps(true);
    progress.timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
        0.35, progress.handler, 'tick:', null, true);
    $.NSRunLoop.mainRunLoop.addTimerForMode(progress.timer, $.NSModalPanelRunLoopMode);
    $.NSApp.runModalForWindow(window);
}
