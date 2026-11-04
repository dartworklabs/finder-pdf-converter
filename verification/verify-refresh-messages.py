#!/usr/bin/env python3
"""Verify localized refresh guidance against real absolute-path helper errors."""
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HELPER = ROOT / 'conversion-session.js'
source = (ROOT / 'conversion-session.sh').read_text()
function = source[source.index('refresh_message_for_log() {'):source.index('\n\nresult=2\n')]
expected = {
    'denied': {
        'en': 'macOS blocked access to the replaced file. Close this window, select the repaired file in Finder, and run the action again.',
        'ko': 'macOS가 교체된 파일에 대한 접근을 차단했습니다. 이 창을 닫고 Finder에서 복구한 파일을 다시 선택한 뒤 작업을 다시 실행하세요.',
    },
    'missing': {
        'en': 'Restore the original file, then try again.',
        'ko': '원본 파일을 복구한 뒤 다시 시도하세요.',
    },
    'generic': {
        'en': 'The original could not be refreshed.',
        'ko': '원본을 다시 가져오지 못했습니다.',
    },
}


def classify(log, language):
    """Execute the exact shell classifier with a private captured error log."""
    return subprocess.check_output(['/bin/bash', '-c', function + '\nrefresh_message_for_log "$1" "$2" "$3"',
                                    'test', language, str(log), str(HELPER)], text=True)


with tempfile.TemporaryDirectory(prefix='fpdf-message-') as temp:
    directory = Path(temp)
    original, snapshot = directory / 'original', directory / 'snapshot'
    original.write_text('repaired')
    snapshot.write_text('old')
    mapping = directory / 'map.json'
    mapping.write_text(json.dumps([{'source': str(original), 'snapshot': str(snapshot)}]))
    try:
        original.chmod(0)
        denied = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(HELPER), 'refresh', str(mapping), str(snapshot)], capture_output=True, text=True)
    finally:
        original.chmod(0o600)
    assert denied.returncode != 0 and denied.stderr.startswith(str(HELPER) + ': execution error: Error: Error: FPDF_ACCESS_DENIED:')
    original.unlink()
    missing = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(HELPER), 'refresh', str(mapping), str(snapshot)], capture_output=True, text=True)
    assert missing.returncode != 0 and missing.stderr.startswith(str(HELPER) + ': execution error: Error: Error: FPDF_SOURCE_MISSING:')
    assert snapshot.read_text() == 'old'
    log = directory / 'refresh.log'
    for case, error in [('denied', denied.stderr), ('missing', missing.stderr)]:
        log.write_text(error)
        for language in ('en', 'ko'):
            assert classify(log, language) == expected[case][language], (case, language)
    # A crafted filename or subsequent diagnostic cannot impersonate a header.
    log.write_text(str(HELPER) + ': execution error: Error: Error: FPDF_REFRESH_ERROR: path\n' + denied.stderr)
    for language in ('en', 'ko'):
        assert classify(log, language) == expected['generic'][language]
print('PASS: absolute helper errors, localized guidance, snapshot preservation and spoof rejection')
