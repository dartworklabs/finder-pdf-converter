"""Pin progress preparation outcomes before review, printing, or merged saving.

The window adapter returns immediate review cancellation and the renderer rejects
any call;
no test can open a print panel, submit a job, or change installed services.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import time
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[1]
ENTRY = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO / 'print-fit.sh'


def verify_preparation_entry():
    """All inputs reach progress and only complete preparation may open review."""
    with tempfile.TemporaryDirectory(prefix='fpdf-preparation-entry-') as temporary:
        root = Path(temporary).resolve()
        app = root / 'app'
        app.mkdir()
        docs = root / "docs ' $"
        docs.mkdir()
        source_pdf = docs / 'first\n.pdf'
        source_txt = docs / '--second.txt'
        source_pdf.write_bytes((REPO / 'verification/blank.pdf').read_bytes())
        source_txt.write_text('PRIVATE PREPARATION SOURCE')
        original = {str(p): p.read_bytes() for p in (source_pdf, source_txt)}
        observed = root / 'session.json'
        review_observed = root / 'review.json'
        render_observed = root / 'render-called'
        ui_adapter = root / 'review-adapter.py'
        ui_adapter.write_text('''#!/usr/bin/python3
"""Capture a review request and return cancellation before any print/save effect."""
import json, os, sys
from pathlib import Path
manifest = json.loads(Path(sys.argv[sys.argv.index('--manifest') + 1]).read_text())
Path(os.environ['FPDF_REVIEW_OBSERVED']).write_text(json.dumps(manifest))
Path(manifest['selectionPath']).write_text('{"version":1,"cancelled":true}')
''')
        ui_adapter.chmod(0o700)
        session = app / 'conversion-session.sh'
        session.write_text('''#!/bin/bash
# The owned session boundary exposes prepared inputs and original/snapshot map.
exec /usr/bin/python3 - "$@" <<'ADAPTER'
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
refresh = json.loads(Path(args[args.index('--refresh-manifest') + 1]).read_text())
files = args[args.index('--') + 1:]
Path(os.environ['FPDF_SESSION_OBSERVED']).write_text(json.dumps({'args': args, 'map': refresh, 'files': files}))
# Emulate cooperative cleanup after the parent forwards only its owned session PID.
if os.environ.get('FPDF_PARENT_SIGNAL'):
    import signal, time
    received = []
    def stop_requested(number, frame):
        # Record only a signal delivered to this owned fixture session.
        received.append(number)
        Path(os.environ['FPDF_SIGNAL_RECEIVED']).write_text('TERM')
    signal.signal(signal.SIGTERM, stop_requested)
    Path(os.environ['FPDF_SIGNAL_READY']).write_text('ready')
    while not Path(os.environ['FPDF_SIGNAL_RELEASE']).exists():
        time.sleep(0.02)
    if not received:
        Path(os.environ['FPDF_SIGNAL_DONE']).write_text('cleanup without forwarded signal')
        sys.exit(3)
    Path(os.environ['FPDF_SIGNAL_DONE']).write_text('cleanup complete')
    sys.exit(130)
# Only create the expected converted snapshot on the successful path.
if os.environ['FPDF_SESSION_STATUS'] == '0':
    for name in files:
        path = Path(name)
        if path.suffix != '.pdf':
            path.with_suffix('.pdf').write_bytes(Path(os.environ['FPDF_BLANK_PDF']).read_bytes())
sys.exit(int(os.environ['FPDF_SESSION_STATUS']))
ADAPTER
''')
        for name in ('locale.sh', 'preferred-language.js', 'convert.sh'):
            shutil.copy2(REPO / name, app / name)
        (app / 'print-fit.js').write_text('''ObjC.import('Foundation');
/** Prohibit printing even if preparation incorrectly reaches the renderer. */
function run() {
    const path = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_RENDER_OBSERVED'));
    $('called').writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
    throw Error('Rendering is forbidden in the preparation-entry test');
}
''')
        review_binary = app / 'Finder PDF Review.app/Contents/MacOS/applet'
        review_binary.parent.mkdir(parents=True)
        review_binary.write_text('unused app fixture')
        production = ENTRY.read_text().replace('/usr/bin/open -W -n', str(ui_adapter) + ' -W -n')
        entry = app / 'print-fit.sh'
        entry.write_text(production)
        environment = {**os.environ, 'FPDF_SESSION_OBSERVED': str(observed),
                       'FPDF_REVIEW_OBSERVED': str(review_observed), 'FPDF_RENDER_OBSERVED': str(render_observed),
                       'FPDF_BLANK_PDF': str(REPO / 'verification/blank.pdf')}
        for merge in (False, True):
            for status in (130, 1, 0):
                observed.unlink(missing_ok=True)
                review_observed.unlink(missing_ok=True)
                result = subprocess.run(['/bin/bash', str(entry), '--no-dialog', *(['--merge'] if merge else []), '--', str(source_pdf), str(source_txt)],
                                        env={**environment, 'FPDF_SESSION_STATUS': str(status)}, capture_output=True)
                assert observed.is_file(), 'selection never reached progress preparation'
                value = json.loads(observed.read_text())
                assert value['args'][:2] == ['--prepare-pdfs', 'merge' if merge else 'print'], 'incorrect PDF validation permission policy'
                assert [p['source'] for p in value['map']] == [str(source_pdf), str(source_txt)], 'original source paths lost'
                assert [p['snapshot'] for p in value['map']] == value['files'], 'refresh map differs from converted selection'
                assert len(value['files']) == 2, 'native PDF missing from n/N preparation'
                assert all(str(docs) not in p for p in value['files']), 'original handed to converter instead of snapshot'
                assert all(not Path(p).exists() for p in value['files']), 'private snapshot leaked after closed action'
                assert review_observed.exists() == (status == 0), 'incomplete preparation reached review'
                assert not render_observed.exists(), 'preparation outcome reached rendering after cancellation or failure'
                assert result.returncode == 0, ('outcome lost', status, result.stderr)
                assert {str(p): p.read_bytes() for p in (source_pdf, source_txt)} == original, 'original changed'
                assert not source_txt.with_suffix('.pdf').exists(), 'preparation published adjacent original PDF'
                print(f'PASS: {"merge" if merge else "print"} preparation outcome {status}, all inputs, cleanup and source preservation')

        # A parent-only TERM must reach the owned session and wait for it before
        # removing private snapshots; an unrelated converter is never signalled.
        ready, received, release, done = [root / name for name in ('signal-ready', 'signal-received', 'signal-release', 'signal-done')]
        review_observed.unlink(missing_ok=True)
        process = subprocess.Popen(['/bin/bash', str(entry), '--no-dialog', '--merge', '--', str(source_pdf), str(source_txt)],
            env={**environment, 'FPDF_SESSION_STATUS': '0', 'FPDF_PARENT_SIGNAL': '1',
                 'FPDF_SIGNAL_READY': str(ready), 'FPDF_SIGNAL_RECEIVED': str(received),
                 'FPDF_SIGNAL_RELEASE': str(release), 'FPDF_SIGNAL_DONE': str(done)},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            assert ready.exists(), 'owned session never became ready'
            snapshot_paths = json.loads(observed.read_text())['files']
            process.send_signal(signal.SIGTERM)
            deadline = time.monotonic() + 5
            while not received.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            assert received.exists(), 'parent TERM never reached owned preparation session'
            assert process.poll() is None, 'parent exited before cooperative session cleanup'
            assert all(Path(path).exists() for path in snapshot_paths), 'parent removed snapshots before session cleanup'
            assert not review_observed.exists() and not render_observed.exists(), 'parent termination reached review or rendering'
            release.write_text('allow cooperative cleanup')
            process.communicate(timeout=10)
            assert process.returncode == 143 and done.exists(), 'parent termination lost its outcome or skipped session cleanup'
            assert all(not Path(path).exists() for path in snapshot_paths), 'terminated action leaked snapshots'
            print('PASS: parent-only TERM forwards to owned session and waits before snapshot cleanup')
        finally:
            release.touch()
            if process.poll() is None:
                process.communicate(timeout=10)
            deadline = time.monotonic() + 3
            while ready.exists() and not done.exists() and time.monotonic() < deadline:
                time.sleep(0.02)


if __name__ == '__main__':
    verify_preparation_entry()
