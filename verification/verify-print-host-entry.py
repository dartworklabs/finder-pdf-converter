"""Reject unsafe native outcomes and keep snapshots until the owned host closes.

Only owned launch adapters execute: dummy apps and a rejecting legacy renderer
make physical spooling impossible, even when the entry point is mutated.
"""
import json
import os
from pathlib import Path
import random
import shutil
import signal
import subprocess
import sys
import tempfile
import time

REPO = Path(__file__).resolve().parents[1]
ENTRY = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / 'print-fit.sh'


def wait_file(path):
    """Bound synchronization to a fixture event rather than timing an effect."""
    deadline = time.monotonic() + 8
    while not path.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert path.exists(), f'fixture did not reach {path.name}'


def verify_print_host_entry():
    """Every closed result controls one print attempt with no fallback or leak."""
    with tempfile.TemporaryDirectory(prefix='fpdf-print-entry-') as temporary:
        root = Path(temporary).resolve()
        app = root / 'app'
        app.mkdir()
        source = root / "PRIVATE ' $\nsource.pdf"
        source.write_bytes((REPO / 'verification/blank.pdf').read_bytes())
        original = source.read_bytes()
        events = root / 'events.jsonl'
        renderer_called = root / 'legacy-renderer-called'
        adapter = root / 'native-launch.py'
        adapter.write_text('''#!/usr/bin/python3
"""Replace only our launch boundary, recording effects without any print system."""
import json, os, sys, time
from pathlib import Path
manifest = json.loads(Path(sys.argv[sys.argv.index('--manifest') + 1]).read_text())
with Path(os.environ['FPDF_EVENTS']).open('a') as output:
    output.write(json.dumps(manifest) + '\\n')
if 'files' in manifest:
    Path(manifest['selectionPath']).write_text(json.dumps({'version': 1, 'cancelled': False, 'files': [{'index': 0, 'pages': [1]}]}))
else:
    if os.environ.get('FPDF_WAIT'):
        Path(os.environ['FPDF_READY']).write_text('ready')
        while not Path(os.environ['FPDF_RELEASE']).exists(): time.sleep(0.02)
    raw = os.environ['FPDF_RESULT']
    if raw != 'MISSING':
        result = Path(manifest['resultPath'])
        if raw == 'LINK': result.symlink_to(os.environ['FPDF_LINK_TARGET'])
        else: result.write_text(raw)
''')
        adapter.chmod(0o700)
        for helper in ('locale.sh', 'preferred-language.js', 'convert.sh'):
            shutil.copy2(REPO / helper, app / helper)
        (app / 'conversion-session.sh').write_text('#!/bin/bash\nexit 0\n')
        (app / 'print-fit.js').write_text('''ObjC.import('Foundation');
/** Fail before any native operation if the entry attempts a duplicate fallback. */
function run() {
    const path = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_RENDERER_CALLED'));
    $('unsafe fallback').writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    throw Error('No legacy renderer is allowed in this test');
}
''')
        for name in ('Finder PDF Review.app', 'Finder PDF Print.app'):
            binary = app / name / 'Contents/MacOS/applet'
            binary.parent.mkdir(parents=True)
            binary.write_text('dummy: never launch')
        entry = app / 'print-fit.sh'
        production = ENTRY.read_text().replace('/usr/bin/open -W -n', str(adapter) + ' -W -n')
        # Widen only the launch/PID registration gap, without changing the
        # boundary behavior. This reproduces the previously tiny signal race.
        production = production.replace('    print_wait_pid=$!', '''    if [[ ${FPDF_LAUNCH_SIGNAL:-} == 1 ]]; then
        : > "$FPDF_REGISTRATION_READY"
        while [[ ! -e $FPDF_REGISTRATION_RELEASE ]]; do /bin/sleep 0.02; done
    fi
    print_wait_pid=$!''')
        entry.write_text(production)
        environment = {**os.environ, 'FPDF_EVENTS': str(events), 'FPDF_RENDERER_CALLED': str(renderer_called), 'FPDF_LINK_TARGET': str(source)}
        cases = [('{"version":1,"status":"completed"}', 0), ('{"version":1,"status":"cancelled"}', 0),
                 ('{"status":"cancelled","version":1}', 0), ('{"version":1,"status":"error"}', 1),
                 ('MISSING', 1), ('LINK', 1), ('not json', 1), ('{"version":1,"status":"completed","extra":1}', 1),
                 ('{"version":1,"status":"error","status":"completed"}', 1),
                 ('{"version":1,"status":"completed","version":1}', 1), ('{"version":2,"status":"completed"}', 1),
                 ('{"version":1,"status":"unknown"}', 1), (' ' * 1025 + '{"version":1,"status":"completed"}', 1)]
        generator = random.Random(96128)
        for _ in range(12):
            cases.append((json.dumps({'version': generator.choice([None, -1, 2, '1']), 'status': generator.choice([None, True, 7, 'accepted'])}), 1))
        for raw, expected in cases:
            events.unlink(missing_ok=True)
            result = subprocess.run(['/bin/bash', str(entry), '--no-dialog', '--', str(source)], env={**environment, 'FPDF_RESULT': raw}, capture_output=True, timeout=15)
            assert result.returncode == expected, ('closed result outcome lost', raw, result.returncode, result.stderr)
            assert not renderer_called.exists(), 'native result reached duplicate legacy renderer'
            records = [json.loads(line) for line in events.read_text().splitlines()]
            assert len(records) == 2 and 'files' in records[0] and 'pdfs' in records[1], 'native launch was missing or duplicated'
            request = records[1]
            assert set(request) == {'version', 'selectionPath', 'resultPath', 'pdfs'} and request['version'] == 1, 'host protocol changed'
            assert request['selectionPath'] == records[0]['selectionPath'], 'host did not use the accepted review selection'
            assert request['pdfs'] == [records[0]['files'][0]['pdf']], 'host did not use the reviewed snapshots'
            assert all(not Path(path).exists() for path in request['pdfs']), 'closed action leaked snapshots'
            assert source.read_bytes() == original, 'original input changed'
        print('PASS: native completed/cancelled/error/missing/malformed/generated outcomes, no duplicate rendering, cleanup')

        # The adapter holds the same lifetime as open -W. Parent TERM must wait
        # for that instance; it must never kill unrelated applications.
        ready, release = root / 'ready', root / 'release'
        registration_ready, registration_release = root / 'registration-ready', root / 'registration-release'
        events.unlink()
        process = subprocess.Popen(['/bin/bash', str(entry), '--no-dialog', '--', str(source)],
            env={**environment, 'FPDF_RESULT': '{"version":1,"status":"cancelled"}', 'FPDF_WAIT': '1', 'FPDF_READY': str(ready), 'FPDF_RELEASE': str(release), 'FPDF_LAUNCH_SIGNAL': '1', 'FPDF_REGISTRATION_READY': str(registration_ready), 'FPDF_REGISTRATION_RELEASE': str(registration_release)},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            wait_file(ready)
            wait_file(registration_ready)
            records = [json.loads(line) for line in events.read_text().splitlines()]
            snapshots = records[-1]['pdfs']
            process.send_signal(signal.SIGTERM)
            registration_release.write_text('allow PID registration')
            time.sleep(0.15)
            assert process.poll() is None and all(Path(path).is_file() for path in snapshots), 'signal removed snapshots before owned app closed'
            process.send_signal(signal.SIGHUP)
            time.sleep(0.1)
            assert process.poll() is None and all(Path(path).is_file() for path in snapshots), 'repeated signal removed snapshots before owned app closed'
            release.write_text('close owned app')
            process.communicate(timeout=10)
            assert process.returncode == 143 and not renderer_called.exists(), 'signal outcome lost or duplicate rendering attempted'
            assert all(not Path(path).exists() for path in snapshots), 'signalled native action leaked snapshots'
            print('PASS: launch-gap TERM is deferred until the owned host closes before snapshot cleanup')
        finally:
            registration_release.touch()
            release.touch()
            if process.poll() is None:
                process.communicate(timeout=10)


if __name__ == '__main__':
    verify_print_host_entry()
