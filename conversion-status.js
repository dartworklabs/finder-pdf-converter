/* Atomic progress protocol for the converter and its private native monitor. */
ObjC.import('Foundation');

/** Read the current progress object from its private file. */
function readStatus(path) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
    if (!text || text.isNil()) throw Error('Cannot read progress');
    return JSON.parse(ObjC.unwrap(text));
}

/** Replace the complete progress object in one atomic write. */
function writeStatus(path, value) {
    if (!$(JSON.stringify(value)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) {
        throw Error('Cannot write progress');
    }
}

/** Begin an attempt with original, distinct 1-based indices. */
function createStatus(attemptText, indicesText, paths) {
    const attempt = Number(attemptText);
    const indices = indicesText.split(',').map(Number);
    if (!Number.isSafeInteger(attempt) || attempt < 1 || indices.length !== paths.length ||
        !indices.every(number => Number.isSafeInteger(number) && number > 0) ||
        new Set(indices).size !== indices.length) {
        throw Error('Invalid attempt or indices');
    }
    return {
        version: 1,
        attempt: attempt,
        phase: 'running',
        total: paths.length,
        processed: 0,
        currentIndex: null,
        currentName: null,
        items: paths.map((path, position) => ({
            index: indices[position],
            name: path.split('/').pop(),
            status: 'pending',
            message: ''
        })),
        summary: {completed: 0, skipped: 0, failed: 0, cancelled: 0}
    };
}

/** Apply one converter transition or return a session query. */
function run(arguments_) {
    const operation = arguments_[0];
    const path = arguments_[1];
    if (operation === 'init') {
        writeStatus(path, createStatus(arguments_[2], arguments_[3], arguments_.slice(4)));
        return;
    }
    const state = readStatus(path);
    if (operation === 'start' || operation === 'update') {
        const item = state.items[Number(arguments_[2]) - 1];
        if (!item) throw Error('Invalid item');
        if (operation === 'start') {
            item.status = 'running';
            state.currentIndex = item.index;
            state.currentName = item.name;
        } else {
            const outcome = arguments_[3];
            if (!['completed', 'skipped', 'failed'].includes(outcome) || item.status !== 'running') {
                throw Error('Invalid outcome');
            }
            item.status = outcome;
            item.message = arguments_[4];
            state.processed++;
            state.summary[outcome]++;
            state.currentIndex = null;
            state.currentName = null;
        }
    } else if (operation === 'finish') {
        const phase = arguments_[2];
        if (!['complete', 'cancelled', 'error'].includes(phase)) throw Error('Invalid phase');
        state.phase = phase;
        state.currentIndex = null;
        state.currentName = null;
        if (phase === 'cancelled') {
            state.items.forEach(function (item) {
                if (item.status === 'pending' || item.status === 'running') {
                    item.status = 'cancelled';
                    state.summary.cancelled++;
                }
            });
        }
    } else if (operation === 'refresh-failed') {
        state.items.forEach(function (item) {
            item.status = 'failed';
            item.message = arguments_[2];
        });
        state.summary.failed = state.total;
        state.processed = state.total;
        state.phase = 'complete';
    } else if (operation === 'phase') {
        return state.phase;
    } else if (operation === 'failed') {
        return state.items.filter(item => item.status === 'failed').map(item => item.index).join(',');
    } else {
        throw Error('Invalid operation');
    }
    writeStatus(path, state);
}
