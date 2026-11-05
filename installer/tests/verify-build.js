/** Exercise package-boundary preservation with one small reusable source fixture. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
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
    for (const name of ['build-installer.sh', 'model.js', 'ui.js', 'login-agent.plist', 'login-helper.m'])
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
    // The retained manager is a real renamed signed package, independent of the
    // tiny hostile-boundary fixture above. Build it without launching any app.
    const retainedOutput = path.join(fixture, 'retained-manager');
    const retained = spawnSync('/bin/bash', [path.join(source, 'build-installer.sh'),
        '--output-dir', retainedOutput], { cwd: path.dirname(source), encoding: 'utf8' });
    assert.equal(retained.status, 0, retained.stderr);
    const manager = path.join(retainedOutput, 'Finder PDF Converter.app');
    assert.ok(fs.existsSync(manager), 'retained manager must use its product name');
    assert.ok(fs.existsSync(path.join(retainedOutput, 'Finder PDF Converter.zip')));
    const previewIdentifier = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier',
        path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).stdout.trim();
    const managerIdentifier = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier',
        path.join(manager, 'Contents/Info.plist')], { encoding: 'utf8' }).stdout.trim();
    assert.notEqual(previewIdentifier, managerIdentifier,
        'inert preview must never satisfy the login helper’s manager identity lookup');
    assert.equal(managerIdentifier, 'com.wonjun-lab.finder-pdf-converter.installer');
    assert.equal(previewIdentifier, 'com.wonjun-lab.finder-pdf-converter.installer.preview');
    assert.equal(fs.existsSync(path.join(app, 'Contents/Library/LaunchAgents')), false,
        'inert preview must not contain login registration authority');
    assert.equal(fs.existsSync(path.join(app, 'Contents/MacOS/fpdf-login-helper')), false,
        'inert preview must not contain the login launcher');
    const agent = path.join(manager, 'Contents/Library/LaunchAgents/com.wonjun-lab.finder-pdf-converter.login.plist');
    assert.deepEqual(fs.readFileSync(agent), fs.readFileSync(path.join(source, 'login-agent.plist')));
    const nativeHelper = path.join(manager, 'Contents/MacOS/fpdf-login-helper');
    const helperFormat = spawnSync('/usr/bin/file', ['-b', nativeHelper], { encoding: 'utf8' });
    assert.equal(helperFormat.status, 0, helperFormat.stderr);
    assert.match(helperFormat.stdout, /Mach-O universal binary/,
        'login bootstrap must be a native executable rather than an interpreted script');
    const helperArchitectures = spawnSync('/usr/bin/xcrun', ['lipo', '-archs', nativeHelper],
        { encoding: 'utf8' });
    assert.equal(helperArchitectures.status, 0, helperArchitectures.stderr);
    assert.deepEqual(helperArchitectures.stdout.trim().split(/\s+/).sort(), ['arm64', 'x86_64'],
        'local package must include both declared helper architectures');
    assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', nativeHelper]).status, 0,
        'native login helper must have its own valid signature');
    assert.ok(fs.statSync(nativeHelper).isFile() && (fs.statSync(nativeHelper).mode & 0o111) !== 0,
        'launch-agent target must be a regular executable');
    const bundleProgram = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :BundleProgram', agent],
        { encoding: 'utf8' });
    assert.equal(bundleProgram.status, 0, bundleProgram.stderr);
    assert.equal(path.resolve(manager, bundleProgram.stdout.trim()), nativeHelper,
        'agent BundleProgram must resolve to the packaged native helper');
    // An actual native execution outside an app has no launch authority. An
    // existing manager may cause its early warm exit; otherwise it rejects the
    // containing path. Neither outcome may emit logs or create owned files.
    const readOnlyDirectory = path.join(fixture, 'readonly-helper');
    fs.mkdirSync(readOnlyDirectory);
    const misplacedHelper = path.join(readOnlyDirectory, 'fpdf-login-helper');
    fs.copyFileSync(nativeHelper, misplacedHelper);
    const readOnlyFiles = fs.readdirSync(readOnlyDirectory);
    const readOnlyHelper = spawnSync(misplacedHelper, [], {
        cwd: readOnlyDirectory, env: { PATH: '/usr/bin:/bin', HOME: readOnlyDirectory },
        encoding: 'utf8', timeout: 5000,
    });
    assert.equal(readOnlyHelper.error, undefined, 'native helper must finish its bounded read-only check');
    assert.ok([0, 4].includes(readOnlyHelper.status), 'helper must exit warm or reject non-app placement');
    assert.equal(readOnlyHelper.stdout, '');
    assert.equal(readOnlyHelper.stderr, '');
    assert.deepEqual(fs.readdirSync(readOnlyDirectory), readOnlyFiles,
        'read-only native helper must not create file logs');
    assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', manager]).status, 0);
    const resources = path.join(manager, 'Contents/Resources');
    const manifest = fs.readFileSync(path.join(resources, 'payload.sha256'), 'utf8').trim().split('\n');
    assert.equal(manifest.length, 37, 'outer manager packaging must retain the bounded payload');
    assert.equal(new Set(manifest.map((line) => line.slice(66))).size, 37,
        'payload inventory may not duplicate a member while omitting another');
    for (const line of manifest) {
        assert.match(line, /^[a-f0-9]{64} {2}[^\n]+$/);
        const relative = line.slice(66);
        assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
        const copied = fs.readFileSync(path.join(resources, 'payload', relative));
        assert.deepEqual(copied, fs.readFileSync(path.join(source, '..', relative)),
            'retained manager payload must exactly match source: ' + relative);
        assert.equal(crypto.createHash('sha256').update(copied).digest('hex'),
            line.slice(0, 64));
        const fixtureMember = path.join(project, relative);
        fs.mkdirSync(path.dirname(fixtureMember), { recursive: true });
        fs.copyFileSync(path.join(source, '..', relative), fixtureMember);
    }
    // Complete this same source fixture once so rejection cannot accidentally
    // pass because some unrelated payload input is absent.
    const sourceControl = build(path.join(fixture, 'complete-source-control'), false);
    assert.equal(sourceControl.status, 0, sourceControl.stderr);
    for (const member of ['login-helper.m', 'login-agent.plist']) {
        const memberPath = path.join(installer, member);
        const memberBytes = fs.readFileSync(memberPath);
        const external = path.join(fixture, 'external-' + member);
        fs.writeFileSync(external, memberBytes);
        for (const alteration of ['symlink', 'hardlink', 'oversize']) {
            const caseOutput = path.join(fixture, member + '-' + alteration);
            fs.mkdirSync(caseOutput);
            const outputSentinel = path.join(caseOutput, 'preserve-output');
            fs.writeFileSync(outputSentinel, 'existing unrelated output');
            fs.unlinkSync(memberPath);
            if (alteration === 'symlink') fs.symlinkSync(external, memberPath);
            else if (alteration === 'hardlink') fs.linkSync(external, memberPath);
            else fs.writeFileSync(memberPath, Buffer.concat([
                memberBytes, Buffer.alloc(2097153 - memberBytes.length, 0x20),
            ]));
            const externalBefore = fs.statSync(external);
            try {
                const rejectedAsset = build(caseOutput, false);
                assert.deepEqual(fs.readFileSync(external), memberBytes,
                    'asset rejection must preserve the external target: ' + member + '/' + alteration);
                assert.equal(fs.statSync(external).mode, externalBefore.mode,
                    'asset rejection must preserve external permissions');
                assert.equal(fs.statSync(external).nlink, externalBefore.nlink,
                    'asset rejection must preserve external hard links');
                assert.notEqual(rejectedAsset.status, 0,
                    'build must reject ' + alteration + ' login asset: ' + member);
                assert.deepEqual(fs.readdirSync(caseOutput), ['preserve-output'],
                    'rejected login asset must publish no app or archive');
                assert.equal(fs.readFileSync(outputSentinel, 'utf8'), 'existing unrelated output');
            } finally {
                fs.rmSync(memberPath, { force: true });
                fs.writeFileSync(memberPath, memberBytes);
                fs.rmSync(caseOutput, { recursive: true, force: true });
            }
        }
    }
    console.log(
        'installer build: real preview/signature, existing output, relative/redirected paths, link preservation and boundary mutation passed',
    );
} finally {
    fs.rmSync(fixture, { recursive: true, force: true });
}
