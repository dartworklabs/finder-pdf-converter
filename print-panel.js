/* Native app entry point, compiled together with print-fit.js by the installer. */
ObjC.bindFunction('getuid', ['unsigned int', []]);

/** Resolve a bounded absolute path without permitting symlink or lexical escapes. */
function panelPath(path) {
    if (typeof path !== 'string' || path.length > 4096 || path[0] !== '/' || path.indexOf('\u0000') !== -1) throw Error('Invalid path.');
    const standard = ObjC.unwrap($(path).stringByStandardizingPath);
    const resolved = ObjC.unwrap($(standard).stringByResolvingSymlinksInPath);
    // Foundation canonicalizes /private/tmp to /tmp on macOS.
    const expected = path.replace(/^\/private\/tmp(?=\/|$)/, '/tmp');
    if (standard.replace(/^\/private\/tmp(?=\/|$)/, '/tmp') !== expected ||
        resolved.replace(/^\/private\/tmp(?=\/|$)/, '/tmp') !== expected) throw Error('Invalid path.');
    return path;
}

/** Require an owned regular file, or an absent output path, inside the private session. */
function panelFile(path, root, absent) {
    panelPath(path);
    if (!path.startsWith(root + '/')) throw Error('Path outside session.');
    const attrs = $.NSFileManager.defaultManager.attributesOfItemAtPathError($(path), null);
    if (absent) {
        if (!attrs.isNil()) throw Error('Result already exists.');
        return;
    }
    if (attrs.isNil() || ObjC.unwrap(attrs.objectForKey($.NSFileType)) !== ObjC.unwrap($.NSFileTypeRegular) ||
        Number(ObjC.unwrap(attrs.objectForKey($.NSFileOwnerAccountID))) !== Number($.getuid())) throw Error('Invalid session file.');
}

/** Parse a private bounded print request and require an already accepted review selection. */
function panelRequest(path) {
    panelPath(path);
    const root = ObjC.unwrap($(path).stringByDeletingLastPathComponent);
    if (!/^\/private\/tmp\/fpdf-print\.[^/]+$/.test(root) || path !== root + '/print-manifest.json') throw Error('Invalid session.');
    const attrs = $.NSFileManager.defaultManager.attributesOfItemAtPathError($(root), null);
    if (attrs.isNil() || ObjC.unwrap(attrs.objectForKey($.NSFileType)) !== ObjC.unwrap($.NSFileTypeDirectory) ||
        Number(ObjC.unwrap(attrs.objectForKey($.NSFileOwnerAccountID))) !== Number($.getuid()) ||
        (Number(ObjC.unwrap(attrs.objectForKey($.NSFilePosixPermissions))) & 0o077) !== 0) throw Error('Invalid session permissions.');
    panelFile(path, root, false);
    const data = $.NSData.dataWithContentsOfFile($(path));
    if (data.isNil() || Number(data.length) > 1048576) throw Error('Invalid request.');
    const string = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    if (string.isNil()) throw Error('Invalid request encoding.');
    const value = JSON.parse(ObjC.unwrap(string));
    if (!value || Object.keys(value).sort().join(',') !== 'pdfs,resultPath,selectionPath,version' || value.version !== 1 ||
        !Array.isArray(value.pdfs) || value.pdfs.length < 1 || value.pdfs.length > 1000 ||
        value.selectionPath !== root + '/selection.json' || value.resultPath !== root + '/print-result.json') throw Error('Invalid request fields.');
    panelFile(value.selectionPath, root, false);
    panelFile(value.resultPath, root, true);
    value.pdfs.forEach(function (pdf) { panelFile(pdf, root, false); });
    return value;
}

/** Publish a terminal status atomically inside the already validated session. */
function panelResult(path, status) {
    const data = $(JSON.stringify({version: 1, status: status})).dataUsingEncoding($.NSUTF8StringEncoding);
    if (!data.writeToFileOptionsError($(path), $.NSDataWritingAtomic, null)) throw Error('Cannot publish print result.');
}

/** Run the shared print capability in this app; missing result always means failure. */
function printPanelAppRun(argv) {
    const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments);
    const position = args.indexOf('--manifest');
    let request = null;
    try {
        if (position < 0 || position + 2 !== args.length || args.lastIndexOf('--manifest') !== position) throw Error('Invalid launch.');
        request = panelRequest(args[position + 1]);
        const outcome = printFitRun(['--selection', request.selectionPath, '--'].concat(request.pdfs));
        if (outcome !== 'completed' && outcome !== 'cancelled') throw Error('Invalid print outcome.');
        panelResult(request.resultPath, outcome);
    } catch (error) {
        if (request) {
            try { panelResult(request.resultPath, 'error'); } catch (_) { /* No result is a failure to the caller. */ }
        }
    }
    // A compiled applet can retain its event loop after a modal panel closes.
    $.NSApplication.sharedApplication;
    $.NSApp.terminate(null);
}
