"""Exercise read-only diagnostics against real files in disposable homes."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
HELPERS = ('locale.sh', 'preferred-language.js', 'convert.sh', 'hancom.applescript', 'word.applescript',
           'powerpoint.applescript', 'excel.applescript', 'image.js', 'dng.js',
           'text.js', 'markdown.js', 'csv.js')


def snapshot(folder):
    """Observe entries and file bytes so repeated diagnostics cannot hide writes."""
    return {str(p.relative_to(folder)): ('link', os.readlink(p)) if p.is_symlink()
            else ('directory',) if p.is_dir() else ('file', p.read_bytes())
            for p in folder.rglob('*')}


with tempfile.TemporaryDirectory(prefix='fpdf-doctor-') as temp:
    home = Path(temp) / 'private-email@example.invalid'
    home.mkdir()

    def run(expected, label, *args):
        """Assert the public exit code, privacy, and absence of filesystem writes."""
        before = snapshot(home)
        result = subprocess.run(['/bin/bash', str(REPO / 'doctor.sh'), *args],
                                env={**os.environ, 'HOME': str(home)},
                                capture_output=True, text=True)
        assert result.returncode == expected, (label, result.returncode, result.stdout, result.stderr)
        assert snapshot(home) == before, label + ': diagnostic modified HOME'
        output = result.stdout + result.stderr
        assert str(home) not in output and 'private-email@' not in output, label + ': private path disclosed'
        assert str(REPO) not in output, label + ': source path disclosed'
        print('PASS: ' + label)
        return output

    run(1, 'missing workflow reported without creating installation')
    target = home / 'Library/Services/PDF로 변환.workflow'
    shutil.copytree(REPO / 'PDF로 변환.workflow', target)
    resources = target / 'Contents/Resources'
    resources.mkdir(exist_ok=True)
    for name in HELPERS:
        shutil.copy2(REPO / name, resources / name)
    output = run(0, 'matching installed workflow succeeds')
    for app in ('Hancom Office HWP', 'Microsoft Word', 'Microsoft PowerPoint', 'Microsoft Excel'):
        assert app in output, 'app not reported individually: ' + app
    run(0, 'repeated matching diagnosis remains read-only')
    for name in ('en.lproj/ServicesMenu.strings', 'ko.lproj/ServicesMenu.strings',
                 'en.lproj/InfoPlist.strings', 'ko.lproj/InfoPlist.strings'):
        localized = resources / name
        original = localized.read_bytes()
        localized.unlink()
        run(1, f'missing {name} rejected')
        localized.write_text('stale translation\n')
        run(1, f'stale {name} rejected')
        localized.write_bytes(original)
    locale = resources / 'ko.lproj'
    external_locale = Path(temp) / 'outside-locale'
    locale.rename(external_locale)
    locale.symlink_to(external_locale, target_is_directory=True)
    run(1, 'linked localization directory rejected')
    locale.unlink()
    external_locale.rename(locale)
    (resources / 'csv.js').write_text('stale helper\n')
    run(1, 'stale helper rejected')
    shutil.copy2(REPO / 'csv.js', resources / 'csv.js')
    (resources / 'excel.applescript').unlink()
    run(1, 'missing helper rejected')
    shutil.copy2(REPO / 'excel.applescript', resources / 'excel.applescript')
    (resources / 'dng.js').unlink()
    run(1, 'missing DNG adapter rejected')
    shutil.copy2(REPO / 'dng.js', resources / 'dng.js')
    (resources / 'dng.js').write_text('stale DNG adapter\n')
    run(1, 'stale DNG adapter rejected')
    shutil.copy2(REPO / 'dng.js', resources / 'dng.js')
    (target / 'Contents/document.wflow').write_text('stale workflow\n')
    run(1, 'stale workflow metadata rejected')
    run(2, 'unexpected argument rejected', '--unexpected')
