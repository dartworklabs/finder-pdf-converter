/** Exercise package-boundary preservation with one small reusable source fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fpdf-build-check-')));
const project = path.join(fixture, 'project');
const installer = path.join(project, 'installer');
fs.mkdirSync(installer, { recursive: true });
/** Invoke the real build boundary in the fixture, leaving the developer checkout untouched. */
function build(output, preview = true) {
    return spawnSync(
        '/bin/bash',
        [
            path.join(installer, 'build-installer.sh'),
            ...(preview ? ['--preview-only'] : []),
            '--output-dir',
            output,
        ],
        { cwd: project, encoding: 'utf8' },
    );
}
try {
    for (const name of ['build-installer.sh', 'model.js', 'ui.js'])
        fs.copyFileSync(path.join(source, name), path.join(installer, name));
    for (const language of ['en', 'ko']) {
        const directory = path.join(installer, 'resources', language + '.lproj');
        fs.mkdirSync(directory, { recursive: true });
        fs.copyFileSync(
            path.join(source, 'resources', language + '.lproj', 'Installer.json'),
            path.join(directory, 'Installer.json'),
        );
    }
    const output = path.join(fixture, 'valid');
    assert.equal(build(output).status, 0, 'inert preview must build without backend files');
    const app = path.join(output, 'Finder PDF Converter Preview.app');
    assert.equal(spawnSync('/usr/libexec/PlistBuddy',['-c','Print :OSAAppletStayOpen',path.join(app,'Contents/Info.plist')],{encoding:'utf8'}).stdout.trim(),'true','installer must return to the standard stay-open applet event loop');

    assert.equal(
        spawnSync('/usr/bin/codesign', ['--verify', '--strict', app]).status,
        0,
        'final preview signature must cover its resources',
    );
    assert.equal(
        fs.existsSync(path.join(app, 'Contents/Resources/payload')),
        false,
        'preview-only package must contain no executable backend',
    );
    const script = path.join(app, 'Contents/Resources/Scripts/main.scpt');
    const before = fs.readFileSync(script);
    assert.notEqual(build(output).status, 0, 'existing output must be preserved');
    assert.deepEqual(fs.readFileSync(script), before);
    assert.equal(build('relative-output').status, 2);
    assert.equal(fs.existsSync(path.join(project, 'relative-output')), false);
    const target = path.join(fixture, 'target');
    fs.mkdirSync(target);
    const sentinel = path.join(target, 'sentinel');
    fs.writeFileSync(sentinel, 'foreign target');
    const redirect = path.join(fixture, 'redirected');
    fs.symlinkSync(target, redirect, 'dir');
    assert.notEqual(
        build(redirect + '/').status,
        0,
        'trailing slash must not hide a redirected output',
    );
    assert.deepEqual(fs.readdirSync(target), ['sentinel']);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'foreign target');
    const payloadMember = path.join(project, 'locale.sh');
    fs.symlinkSync(sentinel, payloadMember);
    let refused = build(path.join(fixture, 'symlink-payload'), false);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Symbolic links are not accepted at the build boundary/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'foreign target');
    fs.unlinkSync(payloadMember);
    fs.linkSync(sentinel, payloadMember);
    refused = build(path.join(fixture, 'hardlink-payload'), false);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Invalid payload member: locale\.sh/);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'foreign target');
    fs.unlinkSync(payloadMember);
    // Remove just the trailing-slash defense in the same fixture and show that
    // the preserved-target assertion detects the plausible boundary mutation.
    const builder = path.join(installer, 'build-installer.sh');
    const original = fs.readFileSync(builder, 'utf8');
    const mutation = original.replace(
        /^while \[ "\$output" != \/ \].*output=\$\{output%\/\}; done\n/m,
        '',
    );
    assert.notEqual(mutation, original);
    fs.writeFileSync(builder, mutation);
    const mutant = build(redirect + '/');
    assert.equal(mutant.status, 0, 'unsafe mutation must exercise the redirected target');
    assert.notDeepEqual(
        fs.readdirSync(target),
        ['sentinel'],
        'preservation oracle must reject the mutation',
    );
    fs.writeFileSync(builder, original);
    console.log(
        'installer build: real preview/signature, existing output, relative/redirected paths, link preservation and boundary mutation passed',
    );
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
