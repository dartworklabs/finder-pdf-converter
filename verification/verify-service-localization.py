"""Check inline service labels with native pbs and bundle display-name resolution.

The default check reads the source bundle without installing or rebuilding the
Services cache. --installed also reads the existing cache with pbs -dump. Neither
mode changes preferences or proves which title a running Finder displays; inspect
Finder itself for that end-to-end check. ServicesMenu.strings must not override
the authoritative inline NSMenuItem dictionary.
"""
import argparse
import json
import re
from pathlib import Path
import plistlib
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
IDENTIFIER = 'com.wonjun-lab.finder-pdf-converter.quickaction'
EXPECTED_TITLES = {'default': 'PDF로 변환', 'en': 'Convert to PDF', 'ko': 'PDF로 변환'}
ACTIONS = [('PDF로 변환.workflow', IDENTIFIER, EXPECTED_TITLES),
           ('용지에 맞춰 인쇄.workflow', 'com.wonjun-lab.finder-pdf-converter.print-to-fit', {'default':'용지에 맞춰 인쇄','en':'Print to Fit','ko':'용지에 맞춰 인쇄'}),
           ('PDF 합치기.workflow', 'com.wonjun-lab.finder-pdf-converter.merge-pdfs', {'default':'PDF 합치기','en':'Merge PDFs','ko':'PDF 합치기'})]
PBS = '/System/Library/CoreServices/pbs'


def service_entry(output, identifier=IDENTIFIER):
    """Isolate this service so missing names cannot be borrowed from a later entry."""
    marker = f'NSBundleIdentifier = "{identifier}";'
    assert output.count(marker) == 1, 'expected exactly one converter service entry'
    target = output.index(marker)
    stack = []
    quoted = escaped = False
    for position, character in enumerate(output):
        if quoted:
            if escaped:
                escaped = False
            elif character == '\\':
                escaped = True
            elif character == '"':
                quoted = False
        elif character == '"':
            quoted = True
        elif character == '{':
            stack.append(position)
        elif character == '}':
            start = stack.pop()
            if start < target < position:
                return output[start:position + 1]
    raise AssertionError('converter service entry is incomplete')


def check_pbs_titles(output, label, identifier=IDENTIFIER, expected_titles=EXPECTED_TITLES):
    """Require English and Korean independently, including the registered default."""
    entry = service_entry(output, identifier)
    assert re.search(r'NSMessage\s*=\s*runWorkflowAsService;', entry), entry
    match = re.search(r'NSMenuItem\s*=\s*\{([^}]+)\}', entry)
    assert match is not None, f'{label}: service has no menu names'
    names = {key: json.loads('"' + value.replace('\\U', '\\u') + '"')
             for key, value in re.findall(r'(\w+)\s*=\s*"((?:\\.|[^"\\])*)";', match.group(1))}
    for language, expected in expected_titles.items():
        assert names.get(language) == expected, (label, language, names)
        print(f'PASS: {label} NSMenuItem[{language}]: {expected}')


def main():
    """Observe native source metadata and optionally the untouched installed cache."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=REPO,
                        help='source folder to inspect (also supports disposable regression copies)')
    parser.add_argument('--installed', action='store_true',
                        help='also read existing registered labels with pbs -dump; does not refresh them')
    options = parser.parse_args()
    for bundle, identifier, titles in ACTIONS:
        workflow = options.source.resolve() / bundle
        overrides = list((workflow / 'Contents/Resources').rglob('ServicesMenu.strings'))
        assert not overrides, 'ServicesMenu.strings can replace registered language labels: ' + repr(overrides)
        metadata = plistlib.loads((workflow / 'Contents/Info.plist').read_bytes())
        assert metadata['CFBundleIdentifier'] == identifier
        assert metadata['NSServices'][0]['NSMenuItem'] == titles
        result = subprocess.run([PBS, '-read_bundle', str(workflow)],
                                check=True, capture_output=True, text=True)
        check_pbs_titles(result.stdout + result.stderr, 'native pbs ' + bundle, identifier, titles)

    with tempfile.TemporaryDirectory(prefix='fpdf-languages-') as temp:
        # A bilingual host prevents its own localization from forcing English.
        contents = Path(temp) / 'Language Probe.app/Contents'
        executable = contents / 'MacOS/probe'
        executable.parent.mkdir(parents=True)
        (contents / 'Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': 'com.wonjun-lab.finder-pdf-converter.language-probe',
            'CFBundleExecutable': 'probe',
            'CFBundleDevelopmentRegion': 'en',
            'CFBundleLocalizations': ['en', 'ko'],
            'CFBundleAllowMixedLocalizations': True,
        }))
        subprocess.run(['xcrun', 'swiftc', str(REPO / 'verification/service-localization-probe.swift'),
                        '-o', str(executable)], check=True)
        for bundle, identifier, titles in ACTIONS:
            workflow = options.source.resolve() / bundle
            for languages, language in [(['en'], 'en'), (['ko'], 'ko'), (['en-US'], 'en'), (['ko-KR','en'], 'ko'), (['fr'], 'en')]:
                expected = titles[language]
                argument = '(' + ','.join(languages) + ')'
                result = subprocess.run([str(executable), str(workflow), '-AppleLanguages', argument],
                                        check=True, capture_output=True, text=True)
                value = json.loads(result.stdout)
                assert value['inlineMenuTitles'] == titles, value
                assert value['displayName'] == expected, value
                print(f'PASS: native {bundle} display name {languages}: {expected} (not Finder menu selection)')

    if options.installed:
        # Check every supported label, not just the current session language.
        # Rebuilding the cache is deliberately a separate, explicitly opted-in action.
        result = subprocess.run([PBS, '-dump'], check=True, capture_output=True, text=True)
        for bundle, identifier, titles in ACTIONS:
            check_pbs_titles(result.stdout + result.stderr, 'existing registered pbs cache ' + bundle, identifier, titles)
    else:
        print('NOT CHECKED: installed pbs cache; use --installed after installation/cache refresh')
    print('NOT CHECKED: live Finder menu selection, including unsupported-language fallback')


if __name__ == '__main__':
    main()
