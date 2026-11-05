/** Pure native-installer protocol and presentation surface: FPDFInstallerModel.
 * No filesystem, process, other-feature or native UI dependencies are permitted.
 */
const FPDFInstallerModel = (() => {
    const codes = Object.freeze([
        'invalid-payload',
        'unsafe-path',
        'foreign-item',
        'modified-item',
        'legacy-source-unavailable',
        'owner-mismatch',
        'recovery-conflict',
        'write-failed',
        'operation-failed',
        'interrupted',
    ]);
    /** @type {Record<string, number>} */
    const exits = {
        fresh: 0,
        current: 0,
        update: 0,
        legacy: 0,
        installed: 0,
        recovered: 0,
        'registration-required': 1,
        conflict: 1,
        'recovery-required': 1,
        restored: 1,
        busy: 1,
        failed: 1,
        'invalid-request': 2,
    };
    /** Compare the exact own field set; arrays and null are refused.
     * @param {any} value @param {string[]} names @returns {boolean} */
    function fields(value, names) {
        return (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).sort().join(',') === names.slice().sort().join(',')
        );
    }
    /** Reject duplicate JSON keys and excessive nesting before interpreting data.
     * @param {string} text @returns {any} */
    function decode(text) {
        let at = 0;
        /** Skip only the whitespace accepted by JSON. */
        function space() {
            while (' \t\r\n'.indexOf(text.charAt(at)) >= 0 && at < text.length) at++;
        }
        /** Decode one quoted JSON token, preserving escaped key equality. */
        function string() {
            const start = at++;
            while (at < text.length) {
                if (text.charAt(at) === '\\') {
                    at += 2;
                    continue;
                }
                if (text.charAt(at++) === '"') return JSON.parse(text.slice(start, at));
            }
            throw Error('string');
        }
        /** Consume one JSON value with unique member names and bounded depth. @param {number} depth */
        function value(depth) {
            if (depth > 8) throw Error('depth');
            space();
            const ch = text.charAt(at);
            if (ch === '"') {
                string();
                return;
            }
            if (ch === '{' || ch === '[') {
                const object = ch === '{',
                    end = object ? '}' : ']',
                    keys = Object.create(null);
                at++;
                space();
                if (text.charAt(at) === end) {
                    at++;
                    return;
                }
                for (let count = 0; count < 32; count++) {
                    if (object) {
                        if (text.charAt(at) !== '"') throw Error('key');
                        const key = string();
                        if (Object.hasOwn(keys, key)) throw Error('duplicate');
                        keys[key] = true;
                        space();
                        if (text.charAt(at++) !== ':') throw Error('colon');
                    }
                    value(depth + 1);
                    space();
                    const separator = text.charAt(at++);
                    if (separator === end) return;
                    if (separator !== ',') throw Error('separator');
                    space();
                }
                throw Error('members');
            }
            const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
                text.slice(at),
            );
            if (!token) throw Error('token');
            at += token[0].length;
        }
        value(0);
        space();
        if (at !== text.length) throw Error('trailing');
        return JSON.parse(text);
    }
    /** Parse the exact v1 envelope for the invoked operation and process exit.
     * Returns accepted(outcome) or protocol-error; never promotes refusal to success.
     * @param {unknown} text @param {unknown} operation @param {unknown} exit
     * @returns {InstallerParsed}
     */
    function parseReply(text, operation, exit) {
        /** @type {{kind:'protocol-error'}} */
        const bad = { kind: 'protocol-error' };
        if (
            typeof text !== 'string' ||
            text.length === 0 ||
            text.length > 16384 ||
            typeof operation !== 'string' ||
            ['inspect', 'install', 'recover'].indexOf(operation) < 0
        )
            return bad;
        let wire;
        try {
            wire = decode(text);
        } catch (_error) {
            return bad;
        }
        if (
            !fields(wire, ['schemaVersion', 'operation', 'outcome']) ||
            wire.schemaVersion !== 1 ||
            wire.operation !== operation
        )
            return bad;
        const out = wire.outcome;
        if (
            !out ||
            typeof out.kind !== 'string' ||
            !Object.hasOwn(exits, out.kind) ||
            exits[out.kind] !== exit
        )
            return bad;
        switch (out.kind) {
            case 'fresh':
            case 'current':
            case 'update':
            case 'legacy':
                if (
                    operation !== 'inspect' ||
                    !fields(out, ['kind', 'apps']) ||
                    !fields(out.apps, ['hwp', 'word', 'powerpoint', 'excel'])
                )
                    return bad;
                if (!Object.keys(out.apps).every((key) => typeof out.apps[key] === 'boolean'))
                    return bad;
                break;
            case 'installed':
                if (operation !== 'install' || !fields(out, ['kind'])) return bad;
                break;
            case 'recovered':
                if (operation !== 'recover' || !fields(out, ['kind'])) return bad;
                break;
            case 'registration-required':
            case 'busy':
                if (operation === 'inspect' || !fields(out, ['kind'])) return bad;
                break;
            case 'restored':
                if (operation === 'inspect') return bad;
                // Both restored and refusals carry exactly one closed diagnostic code.
                if (!fields(out, ['kind', 'code']) || codes.indexOf(out.code) < 0) return bad;
                break;
            case 'conflict':
            case 'recovery-required':
            case 'failed':
            case 'invalid-request':
                if (!fields(out, ['kind', 'code']) || codes.indexOf(out.code) < 0) return bad;
                break;
            default:
                return bad;
        }
        return { kind: 'accepted', outcome: out };
    }
    /** Select the first supported Mac language, falling back to English.
     * @param {unknown} tags @returns {'en'|'ko'} */
    function language(tags) {
        if (Array.isArray(tags))
            for (let i = 0; i < tags.length; i++) {
                if (typeof tags[i] !== 'string') continue;
                const tag = tags[i].toLowerCase().split(/[-_]/)[0];
                if (tag === 'en' || tag === 'ko') return tag;
            }
        return 'en';
    }
    /** Map parsed outcomes to localization keys and the only permitted next action.
     * @param {InstallerOutcome|{kind:'protocol-error'}} outcome @returns {InstallerPresentation} */
    function present(outcome) {
        const kind = outcome.kind;
        switch (kind) {
            case 'fresh':
                return {
                    title: 'freshTitle',
                    body: 'freshBody',
                    steps: ['actions', 'perUser', 'afterInstall'],
                    operation: 'install',
                };
            case 'update':
            case 'legacy':
                return {
                    title: 'updateTitle',
                    body: kind === 'legacy' ? 'legacyBody' : 'updateBody',
                    steps: ['actions', 'preserve', 'afterInstall'],
                    operation: 'install',
                };
            case 'current':
                return {
                    title: 'currentTitle',
                    body: 'currentBody',
                    steps: ['finderStep', 'pngStep', 'permissionStep'],
                    operation: null,
                };
            case 'installed':
                return {
                    title: 'installedTitle',
                    body: 'installedBody',
                    steps: ['finderStep', 'pngStep', 'permissionStep'],
                    operation: null,
                };
            case 'registration-required':
                return {
                    title: 'registrationTitle',
                    body: 'registrationBody',
                    steps: [
                        'registrationFinderStep',
                        'registrationEnableStep',
                        'registrationPNGStep',
                    ],
                    operation: null,
                };
            case 'recovered':
                return {
                    title: 'recoveredTitle',
                    body: 'recoveredBody',
                    steps: ['reopenStep'],
                    operation: null,
                };
            case 'recovery-required':
                return {
                    title: 'recoveryTitle',
                    body: 'recoveryBody',
                    steps: [
                        'code' in outcome && outcome.code === 'recovery-conflict'
                            ? 'contactStep'
                            : 'recoverStep',
                    ],
                    operation:
                        'code' in outcome && outcome.code === 'recovery-conflict'
                            ? null
                            : 'recover',
                };
            case 'conflict':
                return {
                    title: 'conflictTitle',
                    body: 'conflictBody',
                    steps: ['preserve', 'contactStep'],
                    operation: null,
                };
            case 'restored':
                return {
                    title: 'restoredTitle',
                    body: 'restoredBody',
                    steps: ['contactStep'],
                    operation: null,
                };
            case 'busy':
                return {
                    title: 'busyTitle',
                    body: 'busyBody',
                    steps: ['reopenStep'],
                    operation: null,
                };
            case 'failed':
            case 'invalid-request':
            case 'protocol-error':
                return {
                    title: 'failedTitle',
                    body: 'failedBody',
                    steps: ['contactStep'],
                    operation: null,
                };
            default: {
                /** @type {never} A new protocol variant requires an explicit UI decision. */
                const unhandled = kind;
                throw Error('Unparsed installer outcome: ' + unhandled);
            }
        }
    }
    /** Bound only read-only inspection, using monotonic millisecond inputs.
     * @param {InstallerOperation} operation @param {number} started @param {number} now
     * @returns {boolean} Never expires an install or recovery operation.
     */
    function inspectionExpired(operation, started, now) {
        return operation === 'inspect' && now - started >= 45000;
    }
    /** Parse bounded numeric kernel process facts into this live root's descendants.
     * Kernel run state is preserved so the caller can require confirmed stops before signalling.
     * @param {string} text @param {number} rootPID @returns {InstallerProcessSnapshot}
     */
    function inspectionProcesses(text, rootPID) {
        /** @type {{kind:'unavailable'}} */
        const bad = { kind: 'unavailable' };
        if (
            typeof text !== 'string' ||
            text.length > 1048576 ||
            !Number.isInteger(rootPID) ||
            rootPID <= 1 ||
            rootPID > 2147483647
        )
            return bad;
        const lines = text.trim().split('\n');
        if (lines.length > 32768) return bad;
        /** @type {Map<number,InstallerProcessFact>} */
        const byPID = new Map();
        /** @type {Map<number,InstallerProcessFact[]>} */
        const children = new Map();
        for (const line of lines) {
            const match = /^[ \t]*(\d+)[ \t]+(\d+)[ \t]+(\d+)[ \t]+([!-~]{1,16})[ \t]*$/.exec(line);
            if (!match) return bad;
            const values = match.slice(1, 4).map(Number);
            if (values.some((value) => !Number.isInteger(value) || value > 2147483647)) return bad;
            const row = { pid: values[0], ppid: values[1], pgid: values[2], state: match[4] };
            if (byPID.has(row.pid)) return bad;
            byPID.set(row.pid, row);
            if (!children.has(row.ppid)) children.set(row.ppid, []);
            children.get(row.ppid)?.push(row);
        }
        const rootRow = byPID.get(rootPID);
        if (!rootRow) return bad;
        /** @type {InstallerOwnedProcess[]} */
        const owned = [{ ...rootRow, depth: 0 }];
        const ownedIDs = new Set([rootPID]);
        for (let index = 0; index < owned.length; index++) {
            if (owned.length > 256) return bad;
            for (const row of children.get(owned[index].pid) || []) {
                if (ownedIDs.has(row.pid)) continue;
                ownedIDs.add(row.pid);
                owned.push({ ...row, depth: owned[index].depth + 1 });
            }
        }
        if (ownedIDs.has(rootRow.ppid)) return bad;
        return {
            kind: 'owned',
            processes: owned.sort((a, b) => b.depth - a.depth || b.pid - a.pid),
        };
    }
    /** Parse the app-owned preference without coercing foreign values. Missing or
     * malformed input remains off; callers may display an error and must not overwrite it.
     * @param {unknown} value @returns {{kind:'valid',enabled:boolean}|{kind:'invalid',enabled:false}} */
    function parseMenuPreference(value) {
        if (typeof value === 'boolean') return { kind: 'valid', enabled: value };
        return { kind: 'invalid', enabled: false };
    }
    /** Map the actual ServiceManagement status, never a requested setting, to presentation.
     * @param {unknown} status @returns {'enabled'|'disabled'|'approval-required'|'unavailable'} */
    function loginPresentation(status) {
        if (status === 1) return 'enabled';
        if (status === 0) return 'disabled';
        if (status === 2) return 'approval-required';
        return 'unavailable';
    }
    /** Decide window and application lifecycle effects after any inspect cancellation.
     * @param {InstallerOperation|null} operation @param {boolean} menuEnabled
     * @param {'open'|'close'|'quit'|'background'} intent
     * @returns {'show'|'retain'|'defer'|'hide'|'exit'|'background'} */
    function managerAction(operation, menuEnabled, intent) {
        if (intent === 'open') return operation ? 'retain' : 'show';
        if (intent === 'background') return operation ? 'retain' : menuEnabled ? 'background' : 'exit';
        if (operation === 'install' || operation === 'recover') return 'defer';
        if (operation === 'inspect') return 'defer';
        if (intent === 'quit') return 'exit';
        return menuEnabled ? 'hide' : 'exit';
    }
    return {
        parseMenuPreference: parseMenuPreference,
        loginPresentation: loginPresentation,
        managerAction: managerAction,
        inspectionProcesses: inspectionProcesses,
        inspectionExpired: inspectionExpired,
        parseReply: parseReply,
        present: present,
        language: language,
        codes: codes,
    };
})();
if (typeof module !== 'undefined') module.exports = FPDFInstallerModel;
