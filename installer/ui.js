/** Native AppKit shell for FPDFInstallerModel and the managed CLI protocol.
 * Public entry point: run(arguments_). Only bundled backend arguments are used.
 */
ObjC.import('AppKit');
ObjC.import('Foundation');
ObjC.bindFunction('getpid', ['int', []]);
ObjC.bindFunction('getpgid', ['int', ['int']]);
ObjC.bindFunction('kill', ['int', ['int', 'int']]);
/** @type {any} Native controls and process handles owned by this one window. */
const installerUI = {
    running: false,
    finished: false,
    task: null,
    timer: null,
    outputDirectory: null,
    preview: false,
    outcome: null,
};

/** Read one UTF-8 localization resource belonging to this compiled application.
 * @param {string} language @returns {Record<string,string>} */
function installerStrings(language) {
    const path =
        ObjC.unwrap($.NSBundle.mainBundle.resourcePath) + '/' + language + '.lproj/Installer.json';
    const text = $.NSString.stringWithContentsOfFileEncodingError(
        path,
        $.NSUTF8StringEncoding,
        null,
    );
    if (!text || text.isNil()) throw Error('Missing installer localization');
    return JSON.parse(ObjC.unwrap(text));
}

/** Parse only safe presentation overrides; they cannot invoke the backend. @param {string[]} arguments_ */
function installerOptions(arguments_) {
    /** @type {Record<string,string|null>} */
    const options = { preview: null, locale: null, appearance: null };
    for (let i = 0; i < arguments_.length; i++) {
        const name = String(arguments_[i]);
        if (name.indexOf('-psn_') === 0) continue;
        if (
            ['--preview', '--locale', '--appearance'].indexOf(name) < 0 ||
            i + 1 >= arguments_.length
        )
            throw Error('Invalid launch argument');
        const key = name.slice(2);
        if (options[key] !== null) throw Error('Repeated launch argument');
        options[key] = String(arguments_[++i]);
    }
    if (options.preview === null && (options.locale !== null || options.appearance !== null))
        throw Error('Presentation overrides require preview');
    if (
        options.preview !== null &&
        [
            'fresh',
            'current',
            'update',
            'legacy',
            'completed',
            'registration',
            'recovered',
            'conflict',
            'recovery',
            'recovery-conflict',
            'restored',
            'failed',
        ].indexOf(options.preview) < 0
    )
        throw Error('Invalid preview state');
    if (options.locale !== null && ['en', 'ko'].indexOf(options.locale) < 0)
        throw Error('Invalid locale');
    if (options.appearance !== null && ['light', 'dark'].indexOf(options.appearance) < 0)
        throw Error('Invalid appearance');
    return options;
}

/** Accept only one leading Cocoa process-language pair, then parse app options.
 * These arguments affect this process only; no preferences are written.
 * @param {string[]} arguments_
 * @returns {{preview:string|null,locale:string|null,appearance:string|null,nativeLanguage:'en'|'ko'|null}}
 */
function installerLaunchOptions(arguments_) {
    let custom = arguments_.slice();
    /** @type {'en'|'ko'|null} */
    let nativeLanguage = null;
    if (custom[0] === '-AppleLanguages') {
        if (custom[1] !== '(en)' && custom[1] !== '(ko)') throw Error('Invalid process language');
        nativeLanguage = custom[1] === '(en)' ? 'en' : 'ko';
        custom = custom.slice(2);
    }
    if (custom.indexOf('-AppleLanguages') >= 0)
        throw Error('Repeated or misplaced process language');
    const parsed = installerOptions(custom);
    return {
        preview: parsed.preview,
        locale: parsed.locale,
        appearance: parsed.appearance,
        nativeLanguage: nativeLanguage,
    };
}

/** Produce clearly labeled inert states for actual native-screen review.
 * @param {string} name @returns {InstallerOutcome} */
function installerPreview(name) {
    const apps = { hwp: false, word: false, powerpoint: false, excel: false };
    switch (name) {
        case 'fresh':
        case 'current':
        case 'update':
        case 'legacy':
            return { kind: name, apps: apps };
        case 'completed':
            return { kind: 'installed' };
        case 'registration':
            return { kind: 'registration-required' };
        case 'recovered':
            return { kind: 'recovered' };
        case 'conflict':
            return { kind: 'conflict', code: 'modified-item' };
        case 'recovery':
            return { kind: 'recovery-required', code: 'interrupted' };
        case 'recovery-conflict':
            return { kind: 'recovery-required', code: 'recovery-conflict' };
        case 'restored':
            return { kind: 'restored', code: 'write-failed' };
        default:
            return { kind: 'failed', code: 'operation-failed' };
    }
}

/** Build a wrapping native text field; all geometry is constrained by AppKit.
 * @param {number} size @param {number} weight @param {boolean} secondary @returns {any} */
function installerLabel(size, weight, secondary) {
    const field = $.NSTextField.labelWithString('');
    field.translatesAutoresizingMaskIntoConstraints = false;
    field.font = $.NSFont.systemFontOfSizeWeight(size, weight);
    field.textColor = secondary ? $.NSColor.secondaryLabelColor : $.NSColor.labelColor;
    field.maximumNumberOfLines = 0;
    field.lineBreakMode = 0;
    field.selectable = true;
    field.preferredMaxLayoutWidth = 564;
    return field;
}

/** Pin a view below its predecessor with fixed insets and a readable text height.
 * @param {any} view @param {any} content @param {any} topAnchor @param {number} spacing @param {number} height */
function installerPlace(view, content, topAnchor, spacing, height) {
    content.addSubview(view);
    view.leadingAnchor.constraintEqualToAnchorConstant(content.leadingAnchor, 28).active = true;
    view.trailingAnchor.constraintEqualToAnchorConstant(content.trailingAnchor, -28).active = true;
    view.topAnchor.constraintEqualToAnchorConstant(topAnchor, spacing).active = true;
    view.heightAnchor.constraintEqualToConstant(height).active = true;
}

/** Create a standard push button with native keyboard focus and a stable identifier.
 * @param {string} title @param {string} action @param {string} identifier @returns {any} */
function installerButton(title, action, identifier) {
    const button = $.NSButton.buttonWithTitleTargetAction($(title), installerUI.controller, action);
    button.translatesAutoresizingMaskIntoConstraints = false;
    button.bezelStyle = 1;
    button.setAccessibilityIdentifier($(identifier));
    return button;
}

/** Refresh only presentation fields, with one primary operation or a Close action.
 * @param {InstallerOutcome|{kind:'protocol-error'}} outcome */
function installerRender(outcome) {
    installerUI.outcome = outcome;
    const view = FPDFInstallerModel.present(outcome),
        t = installerUI.strings;
    installerUI.title.stringValue = $(t[view.title]);
    installerUI.body.stringValue = $(t[view.body]);
    installerUI.steps.stringValue = $(view.steps.map((key) => t[key]).join('\n\n'));
    installerUI.operation = view.operation;
    const label =
        view.operation === 'install' && (outcome.kind === 'update' || outcome.kind === 'legacy')
            ? 'update'
            : view.operation;
    installerUI.primary.title = $(t[label || 'close']);
    installerUI.primary.enabled = !installerUI.preview || !view.operation;
    installerUI.close.hidden = !view.operation;
    installerUI.close.enabled = true;
    installerUI.details.enabled = true;
    installerUI.spinner.stopAnimation(null);
    installerUI.spinner.hidden = true;
}

/** Show only stable machine codes and presence facts; never backend stderr or paths. */
function installerDetails() {
    const out = installerUI.outcome || { kind: 'protocol-error' },
        t = installerUI.strings;
    const lines = [out.code || (out.kind === 'protocol-error' ? t.protocol : t.none)];
    if (out.apps) {
        lines.push('', t.presence);
        [
            ['hwp', 'Hancom HWP'],
            ['word', 'Microsoft Word'],
            ['powerpoint', 'Microsoft PowerPoint'],
            ['excel', 'Microsoft Excel'],
        ].forEach((app) => {
            lines.push(app[1] + ': ' + t[out.apps[app[0]] ? 'found' : 'missing']);
        });
        lines.push('', t.notChecked);
    }
    const alert = $.NSAlert.alloc.init;
    alert.alertStyle = 1;
    alert.messageText = $(t.detailsTitle);
    alert.informativeText = $(lines.join('\n'));
    alert.addButtonWithTitle($(t.close));
    alert.runModal;
}

/** Remove the task's uniquely owned private output directory after all handles close. */
function installerCleanTask() {
    if (installerUI.outputHandle) {
        installerUI.outputHandle.closeFile;
        installerUI.outputHandle = null;
    }
    if (installerUI.outputDirectory) {
        $.NSFileManager.defaultManager.removeItemAtPathError($(installerUI.outputDirectory), null);
        installerUI.outputDirectory = null;
    }
    installerUI.task = null;
}

/** Read a bounded process-ID/run-state inventory with an owned, short-lived system tool.
 * No command names, user paths, or user-selected process identifiers are consumed.
 * @param {number} rootPID @returns {InstallerProcessSnapshot}
 */
function installerProcessSnapshot(rootPID, budgetSeconds = 2) {
    const directory =
        ObjC.unwrap($.NSTemporaryDirectory()) +
        'fpdf-processes-' +
        ObjC.unwrap($.NSUUID.UUID.UUIDString);
    const file = directory + '/numeric.txt';
    const manager = $.NSFileManager.defaultManager;
    let handle = null;
    let reader = null;
    let probe = null;
    try {
        if (
            !manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
                directory,
                false,
                $({ NSFilePosixPermissions: 448 }),
                null,
            )
        )
            return { kind: 'unavailable' };
        if (
            !manager.createFileAtPathContentsAttributes(
                file,
                $.NSData.data,
                $({ NSFilePosixPermissions: 384 }),
            )
        )
            return { kind: 'unavailable' };
        handle = $.NSFileHandle.fileHandleForWritingAtPath(file);
        probe = $.NSTask.alloc.init;
        probe.launchPath = '/bin/ps';
        probe.arguments = $(['-axo', 'pid=,ppid=,pgid=,state=']);
        probe.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
        probe.standardOutput = handle;
        probe.standardError = $.NSFileHandle.fileHandleWithNullDevice;
        probe.launch;
        const deadline =
            Number($.NSProcessInfo.processInfo.systemUptime) +
            Math.max(0.05, Math.min(2, budgetSeconds));
        while (probe.running && Number($.NSProcessInfo.processInfo.systemUptime) < deadline)
            $.NSThread.sleepForTimeInterval(0.005);
        if (probe.running || Number(probe.terminationStatus) !== 0) return { kind: 'unavailable' };
        handle.closeFile;
        handle = null;
        reader = $.NSFileHandle.fileHandleForReadingAtPath(file);
        const data = reader.readDataOfLength(1048577);
        if (Number(data.length) > 1048576) return { kind: 'unavailable' };
        const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
        return text && !text.isNil()
            ? FPDFInstallerModel.inspectionProcesses(ObjC.unwrap(text), rootPID)
            : { kind: 'unavailable' };
    } catch (_error) {
        return { kind: 'unavailable' };
    } finally {
        if (probe?.running) probe.terminate;
        if (handle) handle.closeFile;
        if (reader) reader.closeFile;
        manager.removeItemAtPathError(directory, null);
    }
}

/** Cancel only the live inspection root and verified descendants, root last.
 * Freezing the owned root before inventory prevents new launches from it; repeated
 * snapshots freeze descendants before any termination. Unknown groups are never signalled.
 * @param {any} task @returns {boolean} Whether a stable owned tree was verified.
 */
function installerCancelInspectionTree(task) {
    if (installerUI.invoked !== 'inspect' || !task?.running) return false;
    const rootPID = Number(task.processIdentifier);
    const ownPID = Number($.getpid());
    const rootGroup = Number($.getpgid(rootPID));
    if (!Number.isInteger(rootPID) || rootPID <= 1 || rootPID === ownPID || rootGroup <= 0)
        return false;
    /** @type {Map<number,InstallerOwnedProcess>} */
    const captured = new Map([
        [rootPID, { pid: rootPID, ppid: ownPID, pgid: rootGroup, state: '', depth: 0 }],
    ]);
    const paused = new Set();
    /** @type {InstallerOwnedProcess[]} */
    let verified = [];
    let previous = '';
    let stable = false;
    try {
        // Darwin SIGSTOP=17: pause this exact live NSTask before inventory.
        if ($.kill(rootPID, 17) !== 0) return false;
        paused.add(rootPID);
        const deadline = Number($.NSProcessInfo.processInfo.systemUptime) + 2.5;
        for (let attempt = 0; attempt < 4; attempt++) {
            const remaining = deadline - Number($.NSProcessInfo.processInfo.systemUptime);
            if (remaining <= 0) break;
            const snapshot = installerProcessSnapshot(rootPID, Math.min(2, remaining));
            if (snapshot.kind !== 'owned') break;
            let stopped = true;
            for (const row of snapshot.processes) {
                captured.set(row.pid, row);
                if (row.state.charAt(0) === 'Z') continue;
                const group = Number($.getpgid(row.pid));
                if (group < 0) continue;
                if (group !== row.pgid) {
                    stopped = false;
                    break;
                }
                if ($.kill(row.pid, 17) !== 0) {
                    if (Number($.getpgid(row.pid)) < 0) continue;
                    stopped = false;
                    break;
                }
                paused.add(row.pid);
            }
            if (!stopped) break;
            const signature = JSON.stringify(snapshot.processes);
            if (
                signature === previous &&
                snapshot.processes.every(
                    (row) => row.state.charAt(0) === 'T' || row.state.charAt(0) === 'Z',
                )
            ) {
                stable = true;
                verified = snapshot.processes;
                break;
            }
            previous = signature;
        }
        if (stable)
            for (const row of verified) {
                if (row.state.charAt(0) !== 'T' || !paused.has(row.pid)) continue;
                const currentGroup = Number($.getpgid(row.pid));
                if (currentGroup < 0) continue;
                // Never signal an entire group: a newly joined unrelated member
                // would not be covered by the verified ancestry snapshot.
                if (currentGroup !== row.pgid || $.kill(row.pid, 9) !== 0) {
                    stable = false;
                    break;
                }
            }
    } finally {
        if (!stable)
            for (const row of Array.from(captured.values()).sort((a, b) => b.depth - a.depth)) {
                if (
                    paused.has(row.pid) &&
                    row.pid !== ownPID &&
                    Number($.getpgid(row.pid)) === row.pgid
                )
                    $.kill(row.pid, 19);
            }
    }
    return stable;
}

/** Stop only this window's owned read-only inspection task, without waiting on I/O.
 * Mutations are never terminated here. Returns whether inspection was cancelled.
 * @returns {boolean}
 */
function installerStopInspection() {
    if (!installerUI.running || installerUI.invoked !== 'inspect') return false;
    let stopped = true;
    try {
        if (installerUI.task?.running) stopped = installerCancelInspectionTree(installerUI.task);
    } catch (_error) {
        stopped = false;
    }
    installerUI.inspectionCleanupVerified = stopped;
    if (!stopped) {
        // Keep the live handle/timer. The paused owned processes were resumed;
        // another Close can retry, or the read-only backend can finish itself.
        installerUI.cancelRetryAfter =
            Number($.NSProcessInfo.processInfo.systemUptime) * 1000 + 2000;
        if (installerUI.body && installerUI.strings?.inspectCleanupBody)
            installerUI.body.stringValue = $(installerUI.strings.inspectCleanupBody);
        return false;
    }
    if (installerUI.timer) installerUI.timer.invalidate;
    installerUI.timer = null;
    installerUI.running = false;
    installerUI.cancelRetryAfter = 0;
    installerCleanTask();
    return true;
}

/** Permit close immediately for read-only inspection, deferring active mutations.
 * @returns {boolean} Whether the caller may close or terminate the application.
 */
function installerPrepareClose() {
    if (installerUI.running && installerUI.invoked === 'inspect') installerStopInspection();
    return !installerUI.running;
}

/** Read at most the protocol limit plus one byte from this owned stdout file.
 * @param {string} path @param {InstallerOperation} operation @param {number} exit
 * @returns {InstallerParsed} Rejects oversized, malformed and invalid UTF-8 responses.
 */
function installerReadReply(path, operation, exit) {
    let reader = null;
    try {
        reader = $.NSFileHandle.fileHandleForReadingAtPath(path);
        if (!reader || reader.isNil()) return { kind: 'protocol-error' };
        const data = reader.readDataOfLength(16385);
        if (!data || data.isNil() || Number(data.length) > 16384) return { kind: 'protocol-error' };
        const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
        return text && !text.isNil()
            ? FPDFInstallerModel.parseReply(ObjC.unwrap(text), operation, exit)
            : { kind: 'protocol-error' };
    } catch (_error) {
        return { kind: 'protocol-error' };
    } finally {
        if (reader) reader.closeFile;
    }
}

/** Read a completed task's bounded stdout and require exact exit/result agreement. */
function installerTick() {
    if (!installerUI.task) return;
    if (installerUI.task.running) {
        const now = Number($.NSProcessInfo.processInfo.systemUptime) * 1000;
        if (
            FPDFInstallerModel.inspectionExpired(installerUI.invoked, installerUI.startedAt, now) &&
            now >= (installerUI.cancelRetryAfter || 0)
        ) {
            if (installerStopInspection()) {
                installerRender({ kind: 'failed', code: 'operation-failed' });
                installerUI.body.stringValue = $(installerUI.strings.inspectUnavailableBody);
            }
        }
        return;
    }
    /** @type {InstallerParsed} */
    let result = { kind: 'protocol-error' };
    try {
        installerUI.outputHandle.closeFile;
        installerUI.outputHandle = null;
        result = installerReadReply(
            installerUI.outputPath,
            installerUI.invoked,
            Number(installerUI.task.terminationStatus),
        );
    } catch (error) {
        result = { kind: 'protocol-error' };
    }
    installerUI.timer.invalidate;
    installerUI.timer = null;
    installerUI.running = false;
    installerCleanTask();
    installerRender(result.kind === 'accepted' ? result.outcome : { kind: 'protocol-error' });
}

/** Construct an unlaunched task for this bundle's declared backend only.
 * @param {InstallerOperation} operation @param {any} outputHandle @returns {any}
 */
function installerBackendTask(operation, outputHandle) {
    const payload = ObjC.unwrap($.NSBundle.mainBundle.resourcePath) + '/payload';
    const task = $.NSTask.alloc.init;
    task.launchPath = '/bin/bash';
    task.arguments = $([
        payload + '/installer/managed-install.sh',
        operation,
        '--source-root',
        payload,
    ]);
    task.standardOutput = outputHandle;
    task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
    task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
    const environment = $.NSMutableDictionary.alloc.init;
    environment.setObjectForKey('/usr/bin:/bin:/usr/sbin:/sbin', 'PATH');
    environment.setObjectForKey('C', 'LC_ALL');
    environment.setObjectForKey($.NSHomeDirectoryForUser($.NSUserName()), 'HOME');
    task.environment = environment;
    return task;
}

/** Schedule progress before any backend may start; invalidate if setup fails.
 * @returns {any} A timer retained by the window's global owner.
 */
function installerScheduleTimer() {
    const timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
        0.1,
        installerUI.controller,
        'tick:',
        null,
        true,
    );
    try {
        $.NSRunLoop.mainRunLoop.addTimerForMode(timer, $.NSRunLoopCommonModes);
        return timer;
    } catch (error) {
        timer.invalidate;
        throw error;
    }
}

/** Launch only this app's fixed backend with argument arrays, polling without blocking UI.
 * A running mutation cannot be cancelled through the UI: it finishes or restores.
 * @param {InstallerOperation} operation
 */
function installerStart(operation) {
    if (installerUI.preview || installerUI.running || installerUI.finished) return;
    try {
        installerUI.running = true;
        installerUI.invoked = operation;
        installerUI.startedAt = Number($.NSProcessInfo.processInfo.systemUptime) * 1000;
        installerUI.cancelRetryAfter = 0;
        const t = installerUI.strings;
        installerUI.title.stringValue = $(
            t[
                operation === 'inspect'
                    ? 'inspectTitle'
                    : operation === 'recover'
                      ? 'recoveringTitle'
                      : 'workingTitle'
            ],
        );
        installerUI.body.stringValue = $(
            t[
                operation === 'inspect'
                    ? 'inspectBody'
                    : operation === 'recover'
                      ? 'recoveringBody'
                      : 'workingBody'
            ],
        );
        installerUI.steps.stringValue = $('');
        installerUI.primary.enabled = false;
        installerUI.close.enabled = false;
        installerUI.details.enabled = false;
        installerUI.spinner.hidden = false;
        installerUI.spinner.startAnimation(null);
        // Foundation creates only this UUID-named private directory. No source or
        // legacy path is executed to determine ownership.
        const directory =
            ObjC.unwrap($.NSTemporaryDirectory()) +
            'fpdf-installer-' +
            ObjC.unwrap($.NSUUID.UUID.UUIDString);
        const attributes = $.NSMutableDictionary.alloc.init;
        attributes.setObjectForKey($(448), 'NSFilePosixPermissions');
        if (
            !$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
                $(directory),
                false,
                attributes,
                null,
            )
        )
            throw Error('Cannot create private output');
        installerUI.outputDirectory = directory;
        installerUI.outputPath = directory + '/response.json';
        attributes.setObjectForKey($(384), 'NSFilePosixPermissions');
        if (
            !$.NSFileManager.defaultManager.createFileAtPathContentsAttributes(
                $(installerUI.outputPath),
                $.NSData.data,
                attributes,
            )
        )
            throw Error('Cannot create output');
        installerUI.outputHandle = $.NSFileHandle.fileHandleForWritingAtPath(
            $(installerUI.outputPath),
        );
        const task = installerBackendTask(operation, installerUI.outputHandle);
        installerUI.task = task;
        installerUI.timer = installerScheduleTimer();
        installerUI.close.enabled = operation === 'inspect';
        // Final fallible effect: after this point a mutation may be running.
        task.launch;
    } catch (error) {
        if (installerUI.timer) installerUI.timer.invalidate;
        installerUI.timer = null;
        installerUI.running = false;
        installerCleanTask();
        installerRender({ kind: 'protocol-error' });
    }
}

/** Route the native Command-Q menu item directly to the guarded controller.
 * The applet's default Quit Apple Event waits for run() and cannot cancel a modal inspect.
 * @param {any} menu @returns {boolean} Whether an existing Command-Q item was rebound.
 */
function installerWireQuit(menu) {
    if (!menu || menu.isNil()) return false;
    for (let index = 0; index < Number(menu.numberOfItems); index++) {
        const item = menu.itemAtIndex(index);
        if (
            ObjC.unwrap(item.keyEquivalent).toLowerCase() === 'q' &&
            Number(item.keyEquivalentModifierMask) === Number($.NSEventModifierFlagCommand)
        ) {
            item.target = installerUI.controller;
            item.action = 'closeInstaller:';
            item.keyEquivalentModifierMask = $.NSEventModifierFlagCommand;
            item.enabled = true;
            menu.autoenablesItems = false;
            installerUI.quitItem = item;
            return true;
        }
        if (item.hasSubmenu && installerWireQuit(item.submenu)) return true;
    }
    return false;
}

/** Install a native guarded Quit route, preserving existing applet menus when present. */
function installerInstallQuitMenu() {
    let main = $.NSApp.mainMenu;
    if (installerWireQuit(main)) return;
    if (!main || main.isNil()) {
        main = $.NSMenu.alloc.initWithTitle('');
        $.NSApp.mainMenu = main;
    }
    let applicationMenu;
    if (Number(main.numberOfItems) > 0 && main.itemAtIndex(0).hasSubmenu) {
        applicationMenu = main.itemAtIndex(0).submenu;
    } else {
        const applicationItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('', null, '');
        applicationMenu = $.NSMenu.alloc.initWithTitle('');
        applicationItem.submenu = applicationMenu;
        main.addItem(applicationItem);
    }
    applicationMenu.addItem(
        $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent(
            $(installerUI.strings.quit),
            'closeInstaller:',
            'q',
        ),
    );
    installerWireQuit(main);
}

/** Close immediately for inspection, or after a mutation has finished/restored. */
function installerClose() {
    if (!installerPrepareClose()) return;
    installerUI.finished = true;
    if (installerUI.window) installerUI.window.orderOut(null);
    $.NSApp.terminate(null);
}

ObjC.registerSubclass({
    name: 'FPDFInstallerController',
    superclass: 'NSObject',
    protocols: ['NSWindowDelegate', 'NSApplicationDelegate'],
    methods: {
        'primary:': {
            types: ['void', ['id']],
            implementation: () => {
                if (installerUI.operation) installerStart(installerUI.operation);
                else installerClose();
            },
        },
        'closeInstaller:': {
            types: ['void', ['id']],
            implementation: () => {
                installerClose();
            },
        },
        'details:': {
            types: ['void', ['id']],
            implementation: () => {
                installerDetails();
            },
        },
        'tick:': {
            types: ['void', ['id']],
            implementation: () => {
                installerTick();
            },
        },
        'applicationShouldTerminate:': {
            types: ['unsigned long', ['id']],
            implementation: () => (installerPrepareClose() ? 1 : 0),
        },
        'windowShouldClose:': () => {
            if (!installerPrepareClose()) return false;
            installerClose();
            return true;
        },
    },
});

/** Wire the native window and either inspect the current user or show inert PoC. @param {string[]} _arguments */
function run(_arguments) {
    // Compiled applets receive LaunchServices --args in the native process
    // argument vector, not in the Apple Event run handler's parameter.
    const arguments_ = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).slice(1);
    const options = installerLaunchOptions(arguments_);
    if (
        typeof FPDF_INSTALLER_PREVIEW_ONLY !== 'undefined' &&
        FPDF_INSTALLER_PREVIEW_ONLY &&
        options.preview === null
    )
        options.preview = 'fresh';
    installerUI.preview = options.preview !== null;
    const language =
        options.locale ||
        options.nativeLanguage ||
        FPDFInstallerModel.language(ObjC.deepUnwrap($.NSLocale.preferredLanguages));
    installerUI.strings = installerStrings(language);
    const t = installerUI.strings;
    $.NSApplication.sharedApplication;
    $.NSApp.setActivationPolicy(0);
    installerUI.controller = $.FPDFInstallerController.alloc.init;
    installerInstallQuitMenu();
    const window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 620, 520),
        7,
        2,
        false,
    );
    installerUI.window = window;
    window.title = $(t.window);
    window.delegate = installerUI.controller;
    window.releasedWhenClosed = false;
    $.NSApp.delegate = installerUI.controller;
    if (options.appearance)
        window.appearance = $.NSAppearance.appearanceNamed(
            $(options.appearance === 'dark' ? 'NSAppearanceNameDarkAqua' : 'NSAppearanceNameAqua'),
        );
    const content = window.contentView;
    const product = installerLabel(13, 0, true);
    product.stringValue = $(t.product);
    installerPlace(product, content, content.topAnchor, 24, 20);
    installerUI.title = installerLabel(23, 0.5, false);
    installerPlace(installerUI.title, content, product.bottomAnchor, 12, 58);
    installerUI.body = installerLabel(13, 0, false);
    installerPlace(installerUI.body, content, installerUI.title.bottomAnchor, 10, 60);
    installerUI.steps = installerLabel(13, 0, false);
    installerPlace(installerUI.steps, content, installerUI.body.bottomAnchor, 20, 156);
    const developer = installerLabel(11, 0, true);
    developer.stringValue = $(t.developer);
    installerPlace(developer, content, installerUI.steps.bottomAnchor, 14, 30);
    const preview = installerLabel(11, 0.5, true);
    preview.stringValue = $(installerUI.preview ? t.preview : '');
    installerPlace(preview, content, developer.bottomAnchor, 0, 20);
    installerUI.spinner = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(0, 0, 0, 0));
    installerUI.spinner.translatesAutoresizingMaskIntoConstraints = false;
    installerUI.spinner.style = 0;
    installerUI.spinner.indeterminate = true;
    content.addSubview(installerUI.spinner);
    installerUI.spinner.leadingAnchor.constraintEqualToAnchorConstant(
        content.leadingAnchor,
        28,
    ).active = true;
    installerUI.spinner.trailingAnchor.constraintEqualToAnchorConstant(
        content.trailingAnchor,
        -28,
    ).active = true;
    installerUI.spinner.topAnchor.constraintEqualToAnchorConstant(
        installerUI.body.bottomAnchor,
        4,
    ).active = true;
    installerUI.spinner.heightAnchor.constraintEqualToConstant(4).active = true;
    installerUI.details = installerButton(t.details, 'details:', 'installer-details');
    content.addSubview(installerUI.details);
    installerUI.close = installerButton(t.close, 'closeInstaller:', 'installer-close');
    content.addSubview(installerUI.close);
    installerUI.close.keyEquivalent = $('\u001b');
    installerUI.primary = installerButton(t.install, 'primary:', 'installer-primary');
    content.addSubview(installerUI.primary);
    installerUI.primary.keyEquivalent = $('\r');
    [installerUI.primary, installerUI.close, installerUI.details].forEach((button) => {
        button.bottomAnchor.constraintEqualToAnchorConstant(content.bottomAnchor, -22).active =
            true;
        button.heightAnchor.constraintEqualToConstant(32).active = true;
    });
    installerUI.primary.trailingAnchor.constraintEqualToAnchorConstant(
        content.trailingAnchor,
        -28,
    ).active = true;
    installerUI.primary.widthAnchor.constraintGreaterThanOrEqualToConstant(100).active = true;
    installerUI.close.trailingAnchor.constraintEqualToAnchorConstant(
        installerUI.primary.leadingAnchor,
        -12,
    ).active = true;
    installerUI.close.widthAnchor.constraintGreaterThanOrEqualToConstant(80).active = true;
    installerUI.details.leadingAnchor.constraintEqualToAnchorConstant(
        content.leadingAnchor,
        22,
    ).active = true;
    window.initialFirstResponder = installerUI.primary;
    window.center;
    window.makeKeyAndOrderFront(null);
    $.NSApp.activateIgnoringOtherApps(true);
    if (installerUI.preview) installerRender(installerPreview(options.preview || 'fresh'));
    else installerStart('inspect');
    // A stay-open applet returns to its existing AppKit event loop.
    // Global references retain the window, controller, task and timer.
    return;
}
