/** Pin opt-in preferences, authoritative login status, and manager lifecycle outputs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modelPath = path.resolve(__dirname, '../model.js');
const model = require(modelPath);

/** Apply public behavior assertions to both the real model and a private guard mutant. */
function verify(subject) {
    assert.deepEqual(
        subject.parseMenuPreference?.(undefined),
        { kind: 'invalid', enabled: false },
        'missing preference must leave the optional menu off',
    );
    for (const enabled of [false, true])
        assert.deepEqual(subject.parseMenuPreference(enabled), { kind: 'valid', enabled });
    for (const malformed of [null, 0, 1, '', 'false', 'true', [], {}, { enabled: true }])
        assert.deepEqual(
            subject.parseMenuPreference(malformed),
            { kind: 'invalid', enabled: false },
            'malformed persisted values must never opt the user in',
        );
    for (const [status, expected] of [
        [0, 'disabled'], [1, 'enabled'], [2, 'approval-required'], [3, 'unavailable'],
        [-1, 'unavailable'], [4, 'unavailable'], [null, 'unavailable'],
        [undefined, 'unavailable'], ['1', 'unavailable'], [true, 'unavailable'],
    ])
        assert.equal(subject.loginPresentation(status), expected,
            'only confirmed native enabled status may claim login enabled');

    for (const menu of [false, true]) {
        assert.equal(subject.managerAction(null, menu, 'open'), 'show');
        assert.equal(subject.managerAction(null, menu, 'close'), menu ? 'hide' : 'exit');
        assert.equal(subject.managerAction(null, menu, 'quit'), 'exit');
        assert.equal(subject.managerAction(null, menu, 'background'), menu ? 'background' : 'exit');
        for (const operation of ['inspect', 'install', 'recover']) {
            assert.equal(subject.managerAction(operation, menu, 'open'), 'retain',
                'reopening an active manager must not start a duplicate operation');
            assert.equal(subject.managerAction(operation, menu, 'background'), 'retain',
                'background reopening must preserve active work and its window');
        }
        for (const operation of ['install', 'recover'])
            for (const intent of ['close', 'quit'])
                assert.equal(subject.managerAction(operation, menu, intent), 'defer',
                    'active mutation must survive every closing route');
    }

    // A seeded sequence changes user intent independently of the service's facts.
    // Assertions pin invariants; the test does not implement a second lifecycle.
    let seed = 0x51a71c;
    let menu = false;
    let loginIntent = false;
    const events = ['toggle-menu', 'toggle-login', 'open', 'close', 'quit', 'background'];
    const operations = [null, 'inspect', 'install', 'recover'];
    const statuses = [0, 1, 2, 3, undefined];
    for (let step = 0; step < 1500; step++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const event = events[seed % events.length];
        const priorMenu = menu;
        const priorLogin = loginIntent;
        if (event === 'toggle-menu') menu = !menu;
        if (event === 'toggle-login') loginIntent = !loginIntent;
        const context = 'seed=0x51a71c step=' + step;
        const candidate = [seed, String(seed), [seed], { enabled: true, version: seed }, null,
            Boolean(seed & 1)][(seed >>> 4) % 6];
        const parsedPreference = subject.parseMenuPreference(candidate);
        if (typeof candidate !== 'boolean')
            assert.deepEqual(parsedPreference, { kind: 'invalid', enabled: false },
                context + ': generated malformed preference must fail closed');
        if (event !== 'toggle-menu') assert.equal(menu, priorMenu, context);
        if (event !== 'toggle-login') assert.equal(loginIntent, priorLogin, context);
        assert.equal(subject.parseMenuPreference(menu).enabled, menu, context);
        const status = statuses[(seed >>> 8) % statuses.length];
        assert.equal(subject.loginPresentation(status) === 'enabled', status === 1,
            context + ': requested login must not override observed authorization');
        if (event.startsWith('toggle-')) continue;
        const operation = operations[(seed >>> 16) % operations.length];
        const result = subject.managerAction(operation, menu, event);
        if (event === 'open' && operation !== null) assert.equal(result, 'retain', context);
        if (event === 'background' && operation !== null) assert.equal(result, 'retain', context);
        if (['install', 'recover'].includes(operation) && ['close', 'quit'].includes(event))
            assert.equal(result, 'defer', context);
        if (operation === null && event === 'background')
            assert.equal(result, menu ? 'background' : 'exit', context);
        assert.equal(menu, event === 'toggle-menu' ? !priorMenu : priorMenu, context);
        assert.equal(loginIntent, priorLogin, context + ': lifecycle must not rewrite login intent');
    }
}

verify(model);
// Mutate only an isolated source value, never the shared checkout: pending OS
// authorization plausibly misreported as enabled must fail this same oracle.
const source = fs.readFileSync(modelPath, 'utf8');
const mutation = source.replace(/return (['"])approval-required\1/, "return 'enabled'");
assert.notEqual(mutation, source, 'pending-status guard mutation must apply');
const isolated = { module: { exports: {} } };
vm.runInNewContext(mutation, isolated);
// Normalize cross-realm output objects while keeping production values intact.
const mutant = isolated.module.exports;
const normalized = {
    parseMenuPreference: (value) => JSON.parse(JSON.stringify(mutant.parseMenuPreference(value))),
    loginPresentation: (status) => mutant.loginPresentation(status),
    managerAction: (operation, menu, intent) => mutant.managerAction(operation, menu, intent),
};
assert.throws(() => verify(normalized), /only confirmed native enabled status/,
    'pending authorization mutation must fail the intended status assertion');
console.log('management model: opt-in parsing, OS status truth, lifecycle, 1500 seeded events and pending-status mutation passed');
