/** Enforce installer slice surfaces and prove each prohibited dependency fails. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const allowed = [
    {
        from: 'installer-ui',
        to: 'installer-model',
        reason: 'Native presentation consumes parsed outcomes and localized presentation keys.',
    },
    {
        from: 'installer-ui',
        to: 'installer-backend',
        reason: 'Native install invokes only the managed public command and parses its v1 JSON.',
    },
];
/** Return structural violations over direct and transitive slice paths. */
function violations(modules, edges) {
    const errors = [];
    for (const [from, to] of edges) {
        const source = modules[from],
            target = modules[to];
        if (!source || !target) {
            errors.push('unlisted module');
            continue;
        }
        if (source.slice !== target.slice) {
            if (!target.public) errors.push('private import');
            if (!allowed.some((rule) => rule.from === source.slice && rule.to === target.slice))
                errors.push('unlisted dependency');
        }
    }
    /** Walk dependency paths with a stack that detects cycles without hiding transitive reach. */
    function visit(origin, node, stack) {
        for (const [, to] of edges.filter((edge) => edge[0] === node)) {
            if (!modules[to]) continue;
            if (stack.includes(to)) {
                errors.push('cycle');
                continue;
            }
            if (
                ['shared', 'platform'].includes(modules[origin].slice) &&
                !['shared', 'platform'].includes(modules[to].slice)
            )
                errors.push('shared reaches slice');
            if (modules[origin].decision && modules[origin].slice !== modules[to].slice)
                errors.push('decision reaches feature');
            visit(origin, to, [...stack, to]);
        }
    }
    for (const name of Object.keys(modules)) visit(name, name, [name]);
    return errors;
}
const modules = {
    'installer/ui.js': { slice: 'installer-ui', public: true },
    'installer/model.js': {
        slice: 'installer-model',
        public: true,
        decision: true,
    },
    'installer/managed-install.sh': { slice: 'installer-backend', public: true },
    'installer/managed-engine.js': { slice: 'installer-backend', public: false },
    'installer/stage-managed.sh': { slice: 'installer-backend', public: false },
    'installer/resources/en.lproj/Installer.json': {
        slice: 'installer-ui',
        public: false,
    },
    'installer/resources/ko.lproj/Installer.json': {
        slice: 'installer-ui',
        public: false,
    },
};
const edges = [
    ['installer/ui.js', 'installer/model.js'],
    ['installer/ui.js', 'installer/managed-install.sh'],
];
const ui = fs.readFileSync(path.join(root, 'installer/ui.js'), 'utf8');
const compactUI = ui.replace(/\s+/g, '').replace(/"/g, "'");
const model = fs.readFileSync(path.join(root, 'installer/model.js'), 'utf8');
assert.match(ui, /FPDFInstallerModel\.parseReply/);
assert.match(compactUI, /payload\+'\/installer\/managed-install\.sh'/);
assert.doesNotMatch(ui, /managed-engine|stage-managed|doctor\.sh|['/]install\.sh['"]/);
assert.match(
    compactUI,
    /if\(installerUI\.preview\|\|installerUI\.running\|\|installerUI\.finished\)return/,
    'preview must refuse backend entry',
);
assert.match(
    compactUI,
    /task\.arguments=\$\(\[payload\+'\/installer\/managed-install\.sh',operation,'--source-root',payload,?\]\)/,
);
assert.doesNotMatch(
    ui,
    /NSData\.dataWithContentsOfFile|attributesOfItemAtPathError/,
    'stdout reads cannot use unbounded data or metadata probes',
);
assert.doesNotMatch(
    ui,
    /\$\.kill\(\s*-/,
    'inspection cancellation cannot signal an entire process group',
);
assert.doesNotMatch(
    model,
    /\b(?:ObjC|NSTask|NSFileManager|readFile|fetch|XMLHttpRequest)\b|require\s*\(/,
    'pure decisions import no I/O',
);
// Imported local modules must be declared, including future explicit imports.
for (const [file, source] of [
    ['installer/ui.js', ui],
    ['installer/model.js', model],
]) {
    for (const match of source.matchAll(/(?:require\s*\(\s*|\bfrom\s+)['"]([^'"]+)['"]/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
        edges.push([file, target.endsWith('.js') ? target : target + '.js']);
    }
}
assert.deepEqual(violations(modules, edges), []);
/** Apply one forbidden graph change while preserving all production declarations. */
function injected(extraModules, extraEdges, expected) {
    assert.ok(
        violations({ ...modules, ...extraModules }, [...edges, ...extraEdges]).includes(expected),
        expected,
    );
}
injected({}, [['installer/ui.js', 'installer/managed-engine.js']], 'private import');
injected(
    {
        'shared/a.js': { slice: 'shared', public: true },
        'shared/b.js': { slice: 'shared', public: true },
    },
    [
        ['shared/a.js', 'shared/b.js'],
        ['shared/b.js', 'installer/ui.js'],
    ],
    'shared reaches slice',
);
injected({}, [['installer/managed-install.sh', 'installer/ui.js']], 'cycle');
injected(
    { 'conversion/public.js': { slice: 'conversion', public: true } },
    [['installer/ui.js', 'conversion/public.js']],
    'unlisted dependency',
);
injected({}, [['installer/model.js', 'installer/managed-install.sh']], 'decision reaches feature');
assert.deepEqual(
    violations(
        {
            ...modules,
            'installer/ui-internal.js': { slice: 'installer-ui', public: false },
        },
        [...edges, ['installer/ui.js', 'installer/ui-internal.js']],
    ),
    [],
);
console.log(
    'installer boundaries: actual dependency checks, five injected violations and legal same-slice dependency passed',
);
