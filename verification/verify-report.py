"""Exercise CLI summary transport and Finder session dispatch without modal UI.

The isolated osascript shim runs each production script with its dialog replaced
by returning the same message. Native UTF-8 decoding and macOS exec limits remain
real; no installed service, document app, or persistent summary log is touched.
"""
import os
import ast
from pathlib import Path
import plistlib
import shutil
import shlex
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]


def verify_reports() -> None:
    """Require lossless summaries and both locale labels across native dialog boundaries."""
    with tempfile.TemporaryDirectory(prefix='fpdf-report-') as temporary:
        root = Path(temporary)
        shim = root / 'osascript'
        shim.write_text('''#!/usr/bin/python3
"""Run the real native script, returning its message instead of opening a modal."""
import os
from pathlib import Path
import re
import subprocess
import sys
args = sys.argv[1:]
payload = sys.stdin.buffer.read()
if '-e' in args:
    position = args.index('-e') + 1
    script = args[position]
else:
    position = None
    script = payload.decode('utf-8')
if '-l' in args:
    # Keep native input decoding; substitute only the NSAlert presentation.
    script = re.sub(r"const app = .*?alert\\.runModal;", "return message;" if 'const message =' in script else 'return argv[0];', script, flags=re.S)
else:
    script = re.sub(r'display dialog .*', 'return message' if 'set message to' in script else 'return (item 1 of argv)', script)
if position is not None:
    args[position] = script
else:
    payload = script.encode('utf-8')
result = subprocess.run(['/usr/bin/osascript', *args], input=payload, capture_output=True)
Path(os.environ['FPDF_REPORT_OBSERVED']).write_bytes(result.stdout)
Path(os.environ['FPDF_REPORT_OBSERVED'] + '.args').write_text(repr(args[-2:]))
sys.stderr.buffer.write(result.stderr)
raise SystemExit(result.returncode)
''')
        shim.chmod(0o700)
        converter = (REPO / 'convert.sh').read_text()
        # Source the converter's definitions without running its batch main.
        definitions = converter.split('if [[ $# == 0 ]]; then', 1)[0]
        definitions = definitions.replace('script_dir=$(CDPATH=\'\' cd -P -- "$(dirname -- "$0")" && pwd) || exit 2', 'script_dir=' + shlex.quote(str(REPO)))
        definitions = definitions.replace('/usr/bin/osascript', str(shim))
        workflow = plistlib.loads((REPO / 'PDF로 변환.workflow/Contents/document.wflow').read_bytes())
        action = workflow['actions'][0]['action']['ActionParameters']['COMMAND_STRING']
        resources = root / 'Library/Services/PDF로 변환.workflow/Contents/Resources'
        resources.mkdir(parents=True)
        shutil.copy2(REPO / 'locale.sh', resources / 'locale.sh')
        shutil.copy2(REPO / 'preferred-language.js', resources / 'preferred-language.js')
        # Finder no longer duplicates results in a modal alert: the session owns them.
        (resources / 'conversion-session.sh').write_text('#!/bin/bash\n/usr/bin/python3 -c \'import json, os, sys; from pathlib import Path; Path(os.environ["FPDF_SESSION_OBSERVED"]).write_text(json.dumps(sys.argv[1:], ensure_ascii=False)); sys.exit(int(os.environ["FPDF_SESSION_STATUS"]))\' "$@"\n')
        ordinary = "완료 1개 · 실패 1개\n한글 '인용' $값 😀\n실패: 문서.docx — 확인해 주세요."
        # A valid argv-sized selection can create a larger per-file error list.
        large = '실패 1500개\n' + ('실패: item.docx — ' + 'x' * 700 + '\n') * 1500
        # Seeded round trips exercise encoding and shell-significant characters.
        import random
        generator = random.Random(1731)
        alphabet = list('가A0\n\t\"\' $`\\') + ['😀', '𝄞', 'é', 'e\u0301']
        generated = [('generated-' + str(index), ''.join(generator.choice(alphabet) for _ in range(250)).rstrip('\n')) for index in range(5)]
        for language, title, button in [('en', 'PDF Conversion Results', 'OK'), ('ko', 'PDF 변환 결과', '확인')]:
            catalog = (REPO / 'locale.sh').read_text()
            catalog = catalog.replace('/usr/bin/osascript -l JavaScript "$1"',
                                      '/usr/bin/osascript -l JavaScript "$1" -AppleLanguages \'(' + language + ')\'')
            (resources / 'locale.sh').write_text(catalog)
            for label, message in [('ordinary', ordinary), ('large', large.rstrip('\n'))] + generated:
                fixture = root / 'message.txt'
                fixture.write_text(message)
                converter_script = definitions + '\nfpdf_locale=' + language + '\nreport "$(/bin/cat "$FPDF_REPORT_FIXTURE")"\n'
                for boundary, script in [('converter', converter_script)]:
                    observed = root / (language + '-' + label + '-' + boundary + '.txt')
                    environment = {**os.environ, 'HOME': str(root), 'FPDF_REPORT_FIXTURE': str(fixture), 'FPDF_REPORT_OBSERVED': str(observed)}
                    result = subprocess.run(['/bin/bash', '-c', script], env=environment, capture_output=True)
                    assert observed.exists(), f'{boundary} {label}: summary never reached dialog transport (status {result.returncode})'
                    assert observed.read_bytes() == (message + '\n').encode(), f'{boundary} {label}: summary text changed or native decode failed'
                    assert ast.literal_eval(Path(str(observed) + '.args').read_text()) == [title, button], f'{boundary} {language}: native title/button not localized'
                    assert result.returncode == 0, f'{boundary} {label}: reporting failed'
                    print(f'PASS: {boundary} {language} {label} unchanged summary and localized title/button ({len(message.encode())} bytes)')


        # Arbitrary Finder selections cross one session boundary unchanged; the
        # workflow consumes a deliberate cancellation without a duplicate alert.
        import json
        paths = ["/source/한글 ' $` \nfile.txt", '/source/--proof.txt']
        observed = root / 'session.json'
        for status in (0, 1, 130):
            environment = {**os.environ, 'HOME': str(root), 'FPDF_SESSION_OBSERVED': str(observed), 'FPDF_SESSION_STATUS': str(status)}
            result = subprocess.run(['/bin/bash', '-c', action, 'finder-action', *paths], env=environment, capture_output=True)
            assert json.loads(observed.read_text()) == ['--', *paths], 'Finder changed session selection'
            assert result.returncode == (0 if status in (1, 130) else status), 'Finder lost session outcome'
            assert result.stdout == b'' and result.stderr == b'', 'Finder duplicated session presentation'
            print(f'PASS: Finder session selection and outcome {status} without duplicate alert')

        # A session startup failure has an actionable localized alert, not a result alert.
        for language, title, button in [('en', 'PDF Conversion Results', 'OK'), ('ko', 'PDF 변환 결과', '확인')]:
            catalog = (REPO / 'locale.sh').read_text().replace('/usr/bin/osascript -l JavaScript "$1"',
                '/usr/bin/osascript -l JavaScript "$1" -AppleLanguages \'(' + language + ')\'')
            (resources / 'locale.sh').write_text(catalog)
            failed_observed = root / ('startup-' + language + '.txt')
            result = subprocess.run(['/bin/bash', '-c', action.replace('/usr/bin/osascript', str(shim))],
                env={**os.environ, 'HOME': str(root), 'FPDF_REPORT_OBSERVED': str(failed_observed),
                     'FPDF_SESSION_OBSERVED': str(observed), 'FPDF_SESSION_STATUS': '2'}, capture_output=True)
            assert result.returncode == 2, 'session startup failure lost its error code'
            assert ast.literal_eval(Path(str(failed_observed) + '.args').read_text()) == [title, button], 'Finder session startup labels not localized'
            assert failed_observed.stat().st_size > 0 and result.stderr, 'session startup failure was silent'
            print(f'PASS: Finder {language} session startup failure has a localized alert')

        # Missing installations retain an actionable localized startup alert.
        (resources / 'conversion-session.sh').unlink()
        for language, title, button in [('en', 'PDF Conversion Results', 'OK'), ('ko', 'PDF 변환 결과', '확인')]:
            catalog = (REPO / 'locale.sh').read_text().replace('/usr/bin/osascript -l JavaScript "$1"',
                '/usr/bin/osascript -l JavaScript "$1" -AppleLanguages \'(' + language + ')\'')
            (resources / 'locale.sh').write_text(catalog)
            missing_observed = root / ('missing-' + language + '.txt')
            result = subprocess.run(['/bin/bash', '-c', action.replace('/usr/bin/osascript', str(shim))],
                env={**os.environ, 'HOME': str(root), 'FPDF_REPORT_OBSERVED': str(missing_observed)}, capture_output=True)
            assert result.returncode == 2, 'missing installation lost startup error'
            assert ast.literal_eval(Path(str(missing_observed) + '.args').read_text()) == [title, button], 'Finder startup alert labels not localized'
            expected = '변환기를 찾을 수 없습니다' if language == 'ko' else 'The PDF converter could not be found'
            assert expected in missing_observed.read_text(), 'Finder startup alert lost actionable reason'
            print(f'PASS: Finder {language} missing-installation reason and localized title/button')



if __name__ == '__main__':
    verify_reports()
