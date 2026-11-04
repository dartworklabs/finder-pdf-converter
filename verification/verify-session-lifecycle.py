#!/usr/bin/env python3
"""Exercise session child exits and cooperative shutdown with private fixtures."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def wait_for(predicate, process, label):
    """Wait for a fixture event while reporting early process failures."""
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if predicate():
            return
        if process.poll() is not None:
            raise AssertionError(f'{label}: process exited {process.returncode}')
        time.sleep(0.05)
    raise AssertionError(f'{label}: timed out')


def check(mode, expected, interrupt=False):
    """Verify the session result and lifecycle side effects for one mode."""
    with tempfile.TemporaryDirectory(prefix='fpdf-session-test-') as temp:
        directory = Path(temp)
        for filename in ('conversion-session.sh', 'conversion-session.js', 'conversion-status.js', 'locale.sh', 'preferred-language.js'):
            shutil.copy(ROOT / filename, directory / filename)
        (directory / 'Finder PDF Review.app').mkdir()
        monitor = directory / 'monitor.py'
        monitor.write_text('''#!/usr/bin/python3
import json, os, pathlib, sys, time
manifest = json.loads(pathlib.Path(sys.argv[sys.argv.index('--manifest') + 1]).read_text())
pathlib.Path(os.environ['FPDF_SESSION_PATH']).write_text(str(pathlib.Path(manifest['readyPath']).parent))
pathlib.Path(manifest['readyPath']).touch()
while True:
    state = json.loads(pathlib.Path(manifest['statusPath']).read_text())
    if pathlib.Path(manifest['shutdownPath']).exists():
        pathlib.Path(os.environ['FPDF_MONITOR_SHUTDOWN']).touch()
        break
    if state['phase'] != 'running' and os.environ['FPDF_CASE'] not in ('interrupt', 'wait-close-pending'):
        pathlib.Path(os.environ['FPDF_PHASE']).write_text(state['phase'])
        if os.environ['FPDF_CASE'] == 'late-cancel':
            pathlib.Path(manifest['cancelPath']).touch()
        if os.environ['FPDF_CASE'] != 'crash':
            destination = pathlib.Path(manifest['commandPath'])
            temporary = destination.with_suffix('.tmp')
            temporary.write_text(json.dumps({'version': 1, 'attempt': state['attempt'], 'action': 'close'}))
            temporary.replace(destination)
            if os.environ['FPDF_CASE'] == 'wait-close':
                pathlib.Path(os.environ['FPDF_COMMAND_SENT']).touch()
                os.environ['FPDF_CASE'] = 'wait-close-pending'
                continue
        break
    time.sleep(0.03)
''')
        monitor.chmod(0o755)
        session = directory / 'conversion-session.sh'
        session.write_text(session.read_text().replace('/usr/bin/open -W -n', '"$FPDF_MONITOR" -W -n'))
        converter = directory / 'convert.sh'
        converter.write_text('''#!/bin/bash
while [[ $# -gt 0 ]]; do
    if [[ $1 == --progress-dir ]]; then state="$2/status.json"; shift 2; else shift; fi
done
/usr/bin/osascript -l JavaScript "${0%/*}/conversion-status.js" start "$state" 1
/usr/bin/touch "$FPDF_STARTED"
case "$FPDF_CASE" in
    killed) kill -TERM $$ ;;
    cancel-no-state) exit 130 ;;
    no-state) exit 0 ;;
    interrupt)
        while [[ ! -e ${state%/*}/cancel ]]; do /bin/sleep 0.05; done
        /bin/sleep 0.3
        /usr/bin/touch "$FPDF_CLEANED"
        /usr/bin/osascript -l JavaScript "${0%/*}/conversion-status.js" finish "$state" cancelled
        exit 130 ;;
    *)
        /usr/bin/osascript -l JavaScript "${0%/*}/conversion-status.js" update "$state" 1 completed done
        /usr/bin/osascript -l JavaScript "${0%/*}/conversion-status.js" finish "$state" complete ;;
esac
''')
        converter.chmod(0o755)
        source = directory / 'input.docx'
        source.write_text('fixture')
        env = os.environ.copy()
        env.update(FPDF_MONITOR=str(monitor), FPDF_CASE=mode,
                   FPDF_STARTED=str(directory / 'started'), FPDF_CLEANED=str(directory / 'cleaned'),
                   FPDF_PHASE=str(directory / 'phase'), FPDF_MONITOR_SHUTDOWN=str(directory / 'shutdown'),
                   FPDF_SESSION_PATH=str(directory / 'session-path'), FPDF_COMMAND_SENT=str(directory / 'command-sent'))
        process = subprocess.Popen(['/bin/bash', str(session), '--', str(source)], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if interrupt:
            event = 'command-sent' if mode == 'wait-close' else 'started'
            wait_for(lambda: (directory / event).exists(), process, event)
            process.terminate()
        try:
            out, err = process.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise AssertionError(f'{mode}: session hung')
        assert process.returncode == expected, (mode, process.returncode, out, err)
        assert not Path((directory / 'session-path').read_text()).exists(), 'session files leaked'
        if mode in ('killed', 'no-state'):
            assert (directory / 'phase').read_text() == 'error'
        if mode == 'cancel-no-state':
            assert (directory / 'phase').read_text() == 'cancelled'
        if interrupt:
            if mode == 'interrupt':
                assert (directory / 'cleaned').exists(), 'adapter cleanup was not awaited'
            assert (directory / 'shutdown').exists(), 'monitor was not asked to close'


if __name__ == '__main__':
    check('killed', 2)
    check('no-state', 2)
    check('cancel-no-state', 130)
    check('success', 0)
    check('crash', 2)
    check('late-cancel', 130)
    check('interrupt', 130, interrupt=True)
    check('wait-close', 130, interrupt=True)
    print('PASS: child failure, close race, monitor crash, late cancellation and cooperative session termination')
