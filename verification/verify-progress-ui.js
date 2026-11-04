/* Pin the late-cancel race at the owned native UI adapter without opening windows. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const entry = process.argv[2] || require.resolve('../document-review.js');

/** A terminal preparation snapshot must preserve a prior cancel request. */
function checkTerminalPreparation(localCancel, marker, expectedAction, shutdown = false) {
    const commands = [];
    let terminations = 0;
    const native = value => value;
    native.NSFileManager = {defaultManager: {fileExistsAtPath: path => (path === '/private/session/cancel' && marker) || (path === '/private/session/shutdown' && shutdown)}};
    native.NSApp = {terminate: () => { terminations++; }};
    native.NSPoint = () => ({});
    native.NSMakePoint = () => ({});
    native.NSEvent = {otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2: () => ({})};
    const context = {ObjC: {import: () => {}, registerSubclass: () => {}}, $: native};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(entry, 'utf8'), context);
    context.progress = {
        manifest: {autoCloseOnSuccess: true, cancelPath: '/private/session/cancel', shutdownPath: '/private/session/shutdown'},
        attempt: 1, cancelling: localCancel, readyWritten: true,
        t: context.progressStrings.en, heading: {}, bar: {}, count: {}, details: {},
        cancelButton: {}, doneButton: {}, retryButton: {}, timer: {}, window: {windowNumber: 1}
    };
    context.readProgressStatus = () => ({attempt: 1, phase: 'complete', total: 1, processed: 1,
        items: [{index: 1, name: 'file.pdf', status: 'completed'}]});
    context.progressCommand = action => commands.push(action);
    context.reviewAlert = message => { throw Error(message); };
    context.refreshProgress();
    assert.deepEqual(commands, expectedAction ? [expectedAction] : [], 'terminal preparation replaced cancellation with success');
    assert.equal(context.progress.heading.stringValue,
        expectedAction === 'close' ? context.progress.t.complete : context.progress.t.cancelled,
        'terminal preparation displayed success after cancellation');
    assert.equal(context.progress.finished, true);
    assert.equal(terminations, 1, 'terminal preparation did not terminate the monitor');
}

for (const [requested, marker, action] of [[false, false, 'close'], [true, false, 'cancel'], [false, true, 'cancel'], [true, true, 'cancel']]) {
    checkTerminalPreparation(requested, marker, action);
}
checkTerminalPreparation(false, false, null, true);
console.log('PASS: terminal preparation preserves late cancellation and owner shutdown');

/** Status parsing supports an ordinary selection above the separate review limit. */
function checkLargeConversionStatus() {
    const status = {version: 1, attempt: 1, phase: 'running', total: 1001, processed: 0,
        items: Array.from({length: 1001}, (_, index) => ({index: index + 1, name: 'file-' + index + '.txt', status: 'pending'}))};
    const encoded = JSON.stringify(status);
    let byteLength = Buffer.byteLength(encoded);
    const native = value => value;
    native.NSData = {dataWithContentsOfFile: () => ({isNil: () => false, length: byteLength})};
    native.NSString = {alloc: {initWithDataEncoding: () => encoded}};
    const context = {ObjC: {import: () => {}, registerSubclass: () => {}, unwrap: value => value}, $: native};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(entry, 'utf8'), context);
    context.progress = {manifest: {statusPath: '/private/session/status.json'}};
    assert.equal(context.readProgressStatus().total, 1001, 'ordinary conversion inherited the document review input cap');
    byteLength = 16777217;
    assert.throws(() => context.readProgressStatus(), /Cannot read status/, 'oversized status was not bounded before decoding');
}
checkLargeConversionStatus();
console.log('PASS: 1001-item conversion status is accepted and oversized status is rejected');

/** Broken status requests cancellation while polling remains alive for owner shutdown. */
function checkBrokenStatusShutdown(message) {
    let shutdown = false;
    let invalidations = 0;
    let cancellations = 0;
    let terminations = 0;
    const native = value => value;
    native.NSFileManager = {defaultManager: {fileExistsAtPath: () => shutdown}};
    native.NSApp = {terminate: () => { terminations++; }};
    native.NSMakePoint = () => ({});
    native.NSEvent = {otherEventWithTypeLocationModifierFlagsTimestampWindowNumberContextSubtypeData1Data2: () => ({})};
    const context = {ObjC: {import: () => {}, registerSubclass: () => {}}, $: native};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(entry, 'utf8'), context);
    context.progress = {manifest: {shutdownPath: '/private/session/shutdown'}, t: context.progressStrings.en,
        heading: {}, cancelButton: {}, doneButton: {}, retryButton: {}, window: {windowNumber: 1},
        timer: {get invalidate() { invalidations++; }}};
    context.readProgressStatus = () => { throw Error(message); };
    context.requestProgressCancel = () => { cancellations++; };
    context.refreshProgress();
    assert.equal(context.progress.heading.stringValue, context.progress.t.unavailable);
    assert.equal(cancellations, 1);
    assert.equal(invalidations, 0, 'unreadable status stopped owner shutdown polling');
    shutdown = true;
    context.refreshProgress();
    assert.equal(context.progress.finished, true);
    assert.equal(invalidations, 1);
    assert.equal(terminations, 1, 'owner shutdown did not terminate the monitor');
}
for (const message of ['Malformed JSON status', 'Status exceeds 16 MiB']) checkBrokenStatusShutdown(message);
console.log('PASS: malformed or oversized status continues polling until graceful owner shutdown');
