/** Pin the closed backend protocol, refused outcomes and safe native actions. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const modelPath = path.join(__dirname, '../model.js');
assert.ok(fs.existsSync(modelPath), 'Native installer model must exist');
const model = require(modelPath);
assert.throws(() => model.codes.push('not-a-code'));
const apps = { hwp: false, word: true, powerpoint: false, excel: false };
/** Produce a backend wire reply for an independently selected expected variant. */
function reply(operation, outcome) {
    return JSON.stringify({ schemaVersion: 1, operation, outcome });
}
const cases = [];
for (const kind of ['fresh', 'current', 'update', 'legacy'])
    cases.push(['inspect', { kind, apps }, 0]);
cases.push(['install', { kind: 'installed' }, 0], ['recover', { kind: 'recovered' }, 0]);
cases.push(
    ['install', { kind: 'registration-required' }, 1],
    ['recover', { kind: 'registration-required' }, 1],
);
for (const operation of ['inspect', 'install', 'recover']) {
    for (const kind of ['conflict', 'recovery-required', 'failed', 'invalid-request']) {
        cases.push([operation, { kind, code: 'unsafe-path' }, kind === 'invalid-request' ? 2 : 1]);
    }
}
for (const operation of ['install', 'recover'])
    cases.push(
        [operation, { kind: 'busy' }, 1],
        [operation, { kind: 'restored', code: 'write-failed' }, 1],
    );
for (const [operation, outcome, exit] of cases) {
    const result = model.parseReply(reply(operation, outcome), operation, exit);
    assert.equal(result.kind, 'accepted', JSON.stringify({ operation, outcome, exit }));
    assert.deepEqual(result.outcome, outcome);
    for (const wrongExit of [0, 1, 2, 9].filter((x) => x !== exit))
        assert.equal(
            model.parseReply(reply(operation, outcome), operation, wrongExit).kind,
            'protocol-error',
        );
    assert.equal(
        model.parseReply(reply(operation, outcome), 'unknown', exit).kind,
        'protocol-error',
    );
    const view = model.present(outcome);
    assert.ok(view.title && view.body && Array.isArray(view.steps));
    if (view.operation) assert.ok(['install', 'recover'].includes(view.operation));
}
for (const [operation, outcome] of [
    ['inspect', { kind: 'installed' }],
    ['inspect', { kind: 'busy' }],
    ['recover', { kind: 'installed' }],
    ['install', { kind: 'recovered' }],
    ['inspect', { kind: 'restored', code: 'write-failed' }],
]) {
    assert.equal(model.parseReply(reply(operation, outcome), operation, 0).kind, 'protocol-error');
}
for (let mask = 0; mask < 16; mask++) {
    const presence = {
        hwp: Boolean(mask & 1),
        word: Boolean(mask & 2),
        powerpoint: Boolean(mask & 4),
        excel: Boolean(mask & 8),
    };
    const parsed = model.parseReply(
        reply('inspect', { kind: 'fresh', apps: presence }),
        'inspect',
        0,
    );
    assert.equal(parsed.kind, 'accepted');
    assert.deepEqual(parsed.outcome.apps, presence);
}
assert.equal(
    model.parseReply(reply('inspect', { kind: 'registration-required' }), 'inspect', 1).kind,
    'protocol-error',
);
for (const operation of ['install', 'recover']) {
    assert.equal(
        model.parseReply(
            reply(operation, { kind: 'registration-required', code: 'operation-failed' }),
            operation,
            1,
        ).kind,
        'protocol-error',
    );
    assert.equal(
        model.parseReply(reply(operation, { kind: 'registration-required', apps }), operation, 1)
            .kind,
        'protocol-error',
    );
}
assert.equal(model.present({ kind: 'registration-required' }).operation, null);
const valid = reply('inspect', { kind: 'fresh', apps });
for (const bad of [
    '',
    'null',
    '[]',
    '{}',
    valid.slice(0, -1),
    valid + '{}',
    ' '.repeat(17000) + valid,
    valid.replace('"schemaVersion":1', '"schemaVersion":2'),
    valid.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    valid.replace('"word":true', '"word":1'),
    valid.replace('"hwp":false', '"hwp":null'),
    valid.replace('"outcome":', '"unknown":1,"outcome":'),
    valid.replace('"apps":', '"code":"unsafe-path","apps":'),
    valid.replace('"hwp":false,', ''),
    valid.replace('"excel":false', '"excel":false,"extra":false'),
    valid.replace('fresh', 'novel'),
    valid.replace('"word":true', '"word":true,"w\\u006frd":false'),
    '\u00a0' + valid,
]) {
    assert.equal(model.parseReply(bad, 'inspect', 0).kind, 'protocol-error', bad.slice(0, 100));
}
for (const code of model.codes)
    assert.equal(
        model.parseReply(reply('install', { kind: 'failed', code }), 'install', 1).kind,
        'accepted',
    );
assert.equal(
    model.parseReply(reply('install', { kind: 'failed', code: 'private-path-leak' }), 'install', 1)
        .kind,
    'protocol-error',
);
for (const [tags, expected] of [
    [['ko-KR'], 'ko'],
    [['fr', 'en-US'], 'en'],
    [['de', 'ko'], 'ko'],
    [['fr'], 'en'],
    [null, 'en'],
])
    assert.equal(model.language(tags), expected);
let seed = 7529;
/** Generate stable hostile JSON values without relying on the implementation grammar. */
function random() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
}
for (let i = 0; i < 1000; i++) {
    const bad = {
        schemaVersion: random() % 9,
        operation: ['inspect', 'install', 'recover', 'other'][random() % 4],
        outcome: {
            kind: ['fresh', 'installed', 'foreign'][random() % 3],
            extra: random(),
        },
    };
    assert.equal(
        model.parseReply(JSON.stringify(bad), 'inspect', random() % 4).kind,
        'protocol-error',
    );
}
assert.equal(model.present({ kind: 'fresh', apps }).operation, 'install');
assert.equal(model.present({ kind: 'update', apps }).operation, 'install');
assert.equal(model.present({ kind: 'current', apps }).operation, null);
assert.equal(model.present({ kind: 'conflict', code: 'modified-item' }).operation, null);
assert.equal(
    model.present({ kind: 'recovery-required', code: 'write-failed' }).operation,
    'recover',
);
assert.equal(
    model.present({ kind: 'recovery-required', code: 'recovery-conflict' }).operation,
    null,
);
for (const lang of ['en', 'ko']) {
    const strings = JSON.parse(
        fs.readFileSync(
            path.join(__dirname, '../resources', lang + '.lproj/Installer.json'),
            'utf8',
        ),
    );
    for (const [, outcome] of cases) {
        const view = model.present(outcome);
        for (const key of [
            view.title,
            view.body,
            ...view.steps,
            ...(view.operation ? [view.operation] : []),
        ])
            assert.equal(typeof strings[key], 'string', lang + ': ' + key);
    }
    assert.equal(typeof strings.inspectUnavailableBody, 'string');
    assert.equal(typeof strings.quit, 'string');
    assert.doesNotMatch(strings.recoveredTitle, lang === 'en' ? /restor/i : /복원/);
    assert.match(strings.developer, lang === 'ko' ? /개발/ : /developer/i);
    assert.match(strings.installedBody, lang === 'ko' ? /확인하지/ : /not been verified/);
}
// A plausible omitted refusal must fail the same external protocol assertion.
const source = fs.readFileSync(modelPath, 'utf8');
const mutated = source.replace(/(?:['"])?conflict(?:['"])?\s*:\s*1/, 'conflict: 0');
assert.notEqual(mutated, source, 'refusal mutation must apply');
const context = { module: { exports: {} } };
vm.runInNewContext(mutated, context);
assert.notEqual(
    context.module.exports.parseReply(
        reply('install', { kind: 'conflict', code: 'unsafe-path' }),
        'install',
        1,
    ).kind,
    'accepted',
);
assert.equal(model.inspectionExpired('inspect', 1000, 45999), false);
assert.equal(model.inspectionExpired('inspect', 1000, 46000), true);
for (const operation of ['install', 'recover'])
    assert.equal(model.inspectionExpired(operation, 1000, 99999999), false);
for (let elapsed = 0; elapsed < 60000; elapsed += 137) {
    assert.equal(model.inspectionExpired('inspect', 1000, 1000 + elapsed), elapsed >= 45000);
    assert.equal(model.inspectionExpired('install', 1000, 1000 + elapsed), false);
}
const processRows = '100 1 100 S\n101 100 101 S\n102 101 101 S\n200 1 200 S\n201 200 200 S\n';
const owned = model.inspectionProcesses(processRows, 100);
assert.equal(owned.kind, 'owned');
assert.deepEqual(
    owned.processes.map((row) => row.pid),
    [102, 101, 100],
);
const foreignMember = model.inspectionProcesses(processRows + '300 1 101 S\n', 100);
assert.equal(foreignMember.kind, 'owned');
assert.equal(model.inspectionProcesses(processRows + '400 1 400 ?\n', 100).kind, 'owned');
assert.deepEqual(
    foreignMember.processes.map((row) => row.pid),
    [102, 101, 100],
);
for (const rows of ['', 'bad', '100 1 100\n100 1 100', '100 101 100\n101 100 101', '100 -1 100'])
    assert.equal(model.inspectionProcesses(rows, 100).kind, 'unavailable');
for (let count = 1; count < 200; count += 7) {
    let rows = '1000 1 1000 S\n9000 1 9000 S\n';
    for (let n = 1; n <= count; n++) rows += 1000 + n + ' ' + (999 + n) + ' ' + (1000 + n) + ' S\n';
    const snapshot = model.inspectionProcesses(rows, 1000);
    assert.equal(snapshot.kind, 'owned');
    assert.equal(snapshot.processes.length, count + 1);
    assert.ok(snapshot.processes.every((row) => row.pid < 9000));
}
console.log(
    'installer model: protocol variants, generated malformed replies, localization and refusal mutation passed',
);
require('./verify-management-model.js');
