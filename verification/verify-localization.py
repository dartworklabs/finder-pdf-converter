"""Check actual macOS selection and bilingual batch results without changing preferences.

Only the copied locale launcher's osascript arguments select a process-local
AppleLanguages list. The production selector, converter and native TXT adapter
run unchanged. No installed Quick Action or system preference is written.
"""
import argparse
import os
import re
import json
import random
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]


def check_selection(source):
    """Language order, regional tags, unsupported tags and shell locales stay distinct."""
    cases = [('(en-US, ko-KR)', 'en'), ('(ko-KR, en)', 'ko'),
             ('(fr, ko-KR)', 'ko'), ('(de, en-GB)', 'en'),
             ('(fr, ja)', 'en'), ('(ko_KR)', 'ko')]
    before = subprocess.check_output(['/usr/bin/defaults', 'read', '-g', 'AppleLanguages'])
    for tags, expected in cases:
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript',
                                 str(source/'preferred-language.js'), '-AppleLanguages', tags],
                                env={**os.environ, 'LANG': 'en_US.UTF-8' if expected == 'ko' else 'ko_KR.UTF-8'},
                                capture_output=True, text=True)
        assert result.returncode == 0 and result.stdout.strip() == expected, (tags, result.stdout, result.stderr)
    after = subprocess.check_output(['/usr/bin/defaults', 'read', '-g', 'AppleLanguages'])
    assert before == after, 'process-local tests changed global language preferences'
    print('PASS: native ordered/region/unsupported language selection ignores conflicting LANG; global preferences unchanged')


def check_language_properties(source):
    """Unsupported prefixes and later supported tags cannot change the first supported tag."""
    generator = random.Random(1731)
    cases = []
    for _ in range(50):
        first = generator.choice(['en', 'ko'])
        unsupported = [generator.choice(['fr-FR', 'de-DE', 'ja-JP', 'zz']) for _ in range(generator.randrange(7))]
        tail = [generator.choice(['en-GB', 'ko-KR', 'fr', 'ja']) for _ in range(generator.randrange(7))]
        cases.append([unsupported + [first] + tail, first])
    script = (source/'preferred-language.js').read_text() + '\nfunction run() { var cases=' + json.dumps(cases) + '; cases.forEach(function(c) { if (fpdfPreferredLanguage(c[0]) !== c[1]) throw Error(JSON.stringify(c)); }); return "50"; }'
    result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], capture_output=True, text=True)
    assert result.returncode == 0 and result.stdout.strip() == '50', result.stderr
    print('PASS: 50 seeded language-order properties (seed 1731)')


def check_adapter_catalog(source):
    """All app-owned RAW/image errors have exact bilingual handling, including wrappers."""
    messages = set()
    for name in ['image.js', 'dng.js']:
        messages.update(re.findall(r"throw new Error\('([^']+)'\)", (source/name).read_text()))
    keys = set(re.findall(r"^        '([^']+)'\) english=", (source/'locale.sh').read_text(), re.M))
    assert messages and messages <= keys, 'untranslated app-owned errors: ' + repr(messages-keys)
    for language in ['en', 'ko']:
        script = '. "$1"; fpdf_locale="$2"; shift 2; for message in "$@"; do fpdf_adapter_reason "execution error: Error: Error: $message (-2700)" dng; printf "\\n"; done'
        result = subprocess.run(['/bin/bash', '-c', script, 'catalog-test', str(source/'locale.sh'), language, *sorted(messages)], capture_output=True, text=True)
        lines = result.stdout.splitlines()
        assert result.returncode == 0 and len(lines) == len(messages)
        if language == 'ko':
            assert lines == sorted(messages), 'Korean adapter reason changed'
        else:
            assert not any(re.search('[가-힣]', line) for line in lines), 'English adapter reason retained Korean app text'
    unknown = "OS detail: weird ' quoted $value 😀"
    result = subprocess.run(['/bin/bash', '-c', '. "$1"; fpdf_locale=en; fpdf_adapter_reason "$2" docx', 'catalog-test', str(source/'locale.sh'), unknown], capture_output=True, text=True)
    assert 'Technical details: ' + unknown in result.stdout, 'unknown external diagnostic was changed'
    print('PASS: ' + str(len(messages)) + ' exact RAW/image errors in both languages; unknown diagnostic preserved')


def check_batch(source, language):
    """Real TXT conversion reports success, skips, failures and original names in either language."""
    with tempfile.TemporaryDirectory(prefix='fpdf-localization-') as temporary:
        root = Path(temporary)
        app = root/'app'
        app.mkdir()
        for name in ['convert.sh', 'locale.sh', 'preferred-language.js', 'text.js', 'markdown.js', 'csv.js']:
            shutil.copy2(source/name, app/name)
        launcher = app/'locale.sh'
        launcher.write_text(launcher.read_text().replace('/usr/bin/osascript -l JavaScript "$1"',
                            '/usr/bin/osascript -l JavaScript "$1" -AppleLanguages \'(' + language + ')\''))
        original = "보고서 ' 100% $값 😀.txt"
        (root/original).write_text('Actual native adapter content.\n', encoding='utf-8')
        (root/'notes.bin').write_text('unsupported source')
        (root/'broken.csv').write_text('"unclosed')
        result = subprocess.run(['/bin/bash', str(app/'convert.sh'), '--no-dialog', '--',
                                 str(root/original), str(root/'notes.bin'), str(root/'missing.png'), str(root/'broken.csv')],
                                capture_output=True, text=True)
        expected = 'Completed: 1 · Skipped: 1 · Failed: 2' if language == 'en' else '완료 1개 · 건너뜀 1개 · 실패 2개'
        assert result.returncode == 1 and result.stdout.splitlines()[0] == expected, result.stdout + result.stderr
        for name in [original, 'notes.bin', 'missing.png', 'broken.csv']:
            assert name in result.stdout, 'original filename missing: ' + name
        assert (root/Path(original).with_suffix('.pdf')).is_file(), 'actual TXT PDF missing'
        assert (root/original).read_text() == 'Actual native adapter content.\n'
        reason = 'The CSV quoting is invalid.' if language == 'en' else 'CSV 따옴표 형식이 올바르지 않습니다.'
        assert reason in result.stdout, 'known adapter reason was not localized'
        empty = subprocess.run(['/bin/bash', str(app/'convert.sh'), '--no-dialog'], capture_output=True, text=True)
        assert empty.returncode == 2
        assert ('Select files to convert.' if language == 'en' else '변환할 문서를 선택해 주세요.') in empty.stdout
        print('PASS: ' + language + ' native mixed batch, known CSV error, input names, startup message and exit codes')


def main():
    """Allow a disposable source override for observed mutation checks."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=REPO)
    args = parser.parse_args()
    check_selection(args.source)
    check_language_properties(args.source)
    check_adapter_catalog(args.source)
    for language in ['en', 'ko']:
        check_batch(args.source, language)


if __name__ == '__main__':
    main()
