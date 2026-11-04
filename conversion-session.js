/* Private monitor protocol: paths and command values remain data, not shell. */
ObjC.import('Foundation');
ObjC.bindFunction('rename', ['int', ['string', 'string']]);
ObjC.bindFunction('getuid', ['uint32_t', []]);

/** Read one JSON file written inside the private session directory. */
function readJSON(path) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    if (!text || text.isNil()) throw Error('Cannot read file');
    return JSON.parse(ObjC.unwrap(text));
}

/** Publish a complete JSON object atomically for the native monitor. */
function writeJSON(path, value) {
    if (!$(JSON.stringify(value)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) {
        throw Error('Cannot write file');
    }
}

/** Run a fixed local executable with arguments kept separate from the shell. */
function runFileTool(executable, arguments_, sourcePath) {
    const task = $.NSTask.alloc.init;
    const output = $.NSPipe.pipe;
    task.launchPath = executable;
    task.arguments = $(arguments_);
    const environment = $.NSProcessInfo.processInfo.environment.mutableCopy;
    environment.setObjectForKey('C', 'LC_ALL');
    task.environment = environment;
    task.standardOutput = output;
    // File tools only report paths and OS errors; no document contents are logged.
    task.standardError = output;
    task.launch;
    // A slow or inaccessible volume must not strand the session forever.
    const deadline = Date.now() + 10000;
    while (task.running && Date.now() < deadline) {
        $.NSThread.sleepForTimeInterval(0.05);
    }
    if (task.running) {
        task.terminate;
        throw Error('File operation timed out: ' + executable);
    }
    const data = output.fileHandleForReading.readDataToEndOfFile;
    const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)) || '';
    if (Number(task.terminationStatus) !== 0) {
        let code = 'FPDF_REFRESH_ERROR';
        if (sourcePath && text.includes(sourcePath + ': ')) {
            if (/: (Operation not permitted|Permission denied)\s*$/.test(text)) code = 'FPDF_ACCESS_DENIED';
            else if (/: No such file or directory\s*$/.test(text)) code = 'FPDF_SOURCE_MISSING';
        }
        throw Error(code + ': File operation failed (' + executable + '): ' + text.slice(0, 8192));
    }
    return text.trim();
}

/** Inspect type and owner with lstat, without loading Finder extended attributes. */
function fileIdentity(path, isSource) {
    const identity = runFileTool('/usr/bin/stat', ['-f', '%HT:%u', path], isSource ? path : null);
    const match = /^Regular File:(\d+)$/.exec(identity);
    if (!match) throw Error('Expected a regular file');
    return Number(match[1]);
}

/** Refresh only selected private snapshots, without exposing a partial copy. */
function refreshSnapshots(manifestPath, paths) {
    const mapping = readJSON(manifestPath);
    const manager = $.NSFileManager.defaultManager;
    if (!Array.isArray(mapping) || mapping.length > 10000) throw Error('Invalid refresh map');
    const sources = new Map();
    mapping.forEach(function (entry) {
        if (!entry || Object.keys(entry).sort().join(',') !== 'snapshot,source' ||
            typeof entry.source !== 'string' || typeof entry.snapshot !== 'string' ||
            !entry.source.startsWith('/') || !entry.snapshot.startsWith('/') || sources.has(entry.snapshot)) {
            throw Error('Invalid refresh map');
        }
        sources.set(entry.snapshot, entry.source);
    });
    paths.forEach(function (snapshot) {
        const source = sources.get(snapshot);
        if (!source) throw Error('Snapshot absent from refresh map');
        fileIdentity(source, true);
        if (fileIdentity(snapshot) !== Number($.getuid())) throw Error('Snapshot is not owned');
        const parent = snapshot.slice(0, snapshot.lastIndexOf('/') + 1);
        const temporary = parent + '.fpdf-refresh-' + ObjC.unwrap($.NSUUID.UUID.UUIDString);
        try {
            // -P prevents a raced-in symbolic link from being followed; -X
            // avoids copying extended attributes and resource forks.
            runFileTool('/bin/cp', ['-P', '-X', '--', source, temporary], source);
            if (fileIdentity(temporary) !== Number($.getuid())) throw Error('Invalid refresh copy');
            if ($.rename(temporary, snapshot) !== 0) throw Error('Refresh publication failed');
        } finally {
            manager.removeItemAtPathError(temporary, null);
        }
    });
}

/** Validate commands against the currently displayed attempt before acting. */
function readCommand(path, attempt) {
    const command = readJSON(path);
    if (!command || command.version !== 1 || command.attempt !== attempt ||
        !['retry', 'close', 'cancel'].includes(command.action) ||
        Object.keys(command).sort().join(',') !== 'action,attempt,version') {
        throw Error('Invalid command');
    }
    return command.action;
}

/** Dispatch the narrow operations used by the session shell. */
function run(arguments_) {
    const operation = arguments_[0];
    if (operation === 'manifest') {
        writeJSON(arguments_[1], {
            version: 1,
            mode: 'progress',
            language: arguments_[2],
            statusPath: arguments_[3],
            commandPath: arguments_[4],
            cancelPath: arguments_[5],
            autoCloseOnSuccess: arguments_[6] === '1',
            readyPath: arguments_[7],
            shutdownPath: arguments_[8]
        });
    } else if (operation === 'command') {
        return readCommand(arguments_[1], Number(arguments_[2]));
    } else if (operation === 'refresh') {
        refreshSnapshots(arguments_[1], arguments_.slice(2));
    } else {
        throw Error('Invalid operation');
    }
}
