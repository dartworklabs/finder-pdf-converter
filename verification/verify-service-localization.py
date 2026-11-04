"""Check packaged service labels with native macOS bundle resolution in each language.

The temporary host app supports both languages, so its own localization does not
force English on a loaded workflow. AppleLanguages is set only for each child
process. This checks the published menu strings, not Finder's registered cache.
"""
import argparse
import json
import re
from pathlib import Path
import plistlib
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
WORKFLOW = REPO / 'PDF로 변환.workflow'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--installed', action='store_true',
                    help='also read the normal registered pbs cache without changing it')
options = parser.parse_args()

with tempfile.TemporaryDirectory(prefix='fpdf-languages-') as temp:
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
    for languages, expected in [(['en'], 'Convert to PDF'),
                                (['ko'], 'PDF로 변환'),
                                (['en-US'], 'Convert to PDF'),
                                (['ko-KR', 'en'], 'PDF로 변환'),
                                (['fr'], 'Convert to PDF')]:
        argument = '(' + ','.join(languages) + ')'
        result = subprocess.run([str(executable), str(WORKFLOW),
                                 '-AppleLanguages', argument],
                                check=True, capture_output=True, text=True)
        value = json.loads(result.stdout)
        assert value['menuTitle'] == expected, value
        assert value['displayName'] == expected, value
        print(f"PASS: native bundle resolution {languages}: {expected}")
    # pbs reads this isolated source bundle without installing or changing prefs.
    result = subprocess.run(['/System/Library/CoreServices/pbs', '-read_bundle', str(WORKFLOW)],
                            check=True, capture_output=True, text=True)
    metadata = plistlib.loads((WORKFLOW / 'Contents/Info.plist').read_bytes())
    expected_titles = {'default': 'PDF로 변환', 'en': 'Convert to PDF', 'ko': 'PDF로 변환'}
    assert metadata['NSServices'][0]['NSMenuItem'] == expected_titles
    assert 'runWorkflowAsService' in result.stdout + result.stderr
    assert 'com.wonjun-lab.finder-pdf-converter.quickaction' in result.stdout + result.stderr
    print('PASS: native pbs accepts the preserved service identifier and workflow entry point')

if options.installed:
    # pbs is a user-session broker: explicit language arguments rebuild labels
    # in its current language. Inspect the ordinary installed cache instead.
    result = subprocess.run(['/System/Library/CoreServices/pbs', '-dump'],
                            check=True, capture_output=True, text=True)
    output = result.stdout + result.stderr
    marker = 'NSBundleIdentifier = "com.wonjun-lab.finder-pdf-converter.quickaction";'
    assert output.count(marker) == 1, 'expected one registered converter service'
    entry = output.split(marker, 1)[1]
    match = re.search(r'NSMenuItem\s*=\s*\{([^}]+)\}', entry)
    assert match is not None, 'registered service has no menu names'
    names = {key: json.loads('"' + value.replace('\\U', '\\u') + '"')
             for key, value in re.findall(r'(default|en|ko)\s*=\s*"([^"\n]*)";', match.group(1))}
    session = next((language.split('-')[0] for language in value['sessionLanguages']
                    if language.split('-')[0] in ('en', 'ko')), 'en')
    assert names['default'] == expected_titles['default'], names
    assert names.get(session) == expected_titles[session], (session, names)
    print(f'PASS: registered pbs cache preserves service identity and active session title ({session})')
