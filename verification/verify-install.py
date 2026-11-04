"""Check installation, ownership, and destination indirection in disposable homes."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[1]
checks = []


def check(condition, description):
    """Collect behavioral results so the unsafe baseline exposes every defect."""
    checks.append((bool(condition), description))


with tempfile.TemporaryDirectory(prefix='fpdf-install-') as temp:
    base = Path(temp).resolve()
    source = base / "source ' $ checkout"
    source.mkdir()
    for name in ['install.sh', 'locale.sh', 'preferred-language.js', 'convert.sh', 'hancom.applescript', 'word.applescript', 'powerpoint.applescript', 'excel.applescript', 'image.js', 'dng.js', 'text.js', 'markdown.js', 'csv.js']:
        shutil.copy2(REPO / name, source / name)
    shutil.copytree(REPO / 'PDF로 변환.workflow', source / 'PDF로 변환.workflow')

    def run(home):
        """Run the real installer with HOME isolated from the user's services."""
        return subprocess.run(['/bin/bash', str(source / 'install.sh')], env={**os.environ, 'HOME': str(home)}, capture_output=True, text=True)

    home = base / 'fresh-home'
    result = run(home)
    target = home / 'Library/Services/PDF로 변환.workflow'
    resources = target / 'Contents/Resources'
    check(result.returncode == 0 and all((resources / name).is_file() and (resources / name).read_bytes() == (source / name).read_bytes() for name in ('image.js', 'dng.js', 'text.js', 'markdown.js', 'csv.js', 'excel.applescript')), 'fresh alternate HOME install includes every renderer')
    check((target / 'Contents/project').is_symlink(), 'ownership marker installed')
    localized = ('en.lproj/ServicesMenu.strings', 'ko.lproj/ServicesMenu.strings',
                 'en.lproj/InfoPlist.strings', 'ko.lproj/InfoPlist.strings')
    check(all((resources / name).is_file() and
              (resources / name).read_bytes() == (source / 'PDF로 변환.workflow/Contents/Resources' / name).read_bytes()
              for name in localized), 'fresh install includes both native menu localizations')
    (resources / 'convert.sh').write_text('old conversion\n')
    check(run(home).returncode == 0 and (resources / 'convert.sh').read_bytes() == (source / 'convert.sh').read_bytes(), 'owned installation updated')
    for language in ('en', 'ko'):
        shutil.rmtree(resources / f'{language}.lproj')
    check(run(home).returncode == 0 and all((resources / name).is_file() for name in localized),
          'existing unlocalized installation gains both menu localizations')
    installed_before = (resources / 'convert.sh').read_bytes()
    localized_source = source / 'PDF로 변환.workflow/Contents/Resources/ko.lproj/ServicesMenu.strings'
    localized_source.rename(localized_source.with_suffix('.hidden'))
    check(run(home).returncode != 0 and (resources / 'convert.sh').read_bytes() == installed_before,
          'missing localization refuses before partial update')
    localized_source.with_suffix('.hidden').rename(localized_source)
    unrelated_locale = base / 'external-locale'
    shutil.copytree(resources / 'ko.lproj', unrelated_locale)
    locale_before = (unrelated_locale / 'ServicesMenu.strings').read_bytes()
    shutil.rmtree(resources / 'ko.lproj')
    (resources / 'ko.lproj').symlink_to(unrelated_locale, target_is_directory=True)
    check(run(home).returncode != 0 and (unrelated_locale / 'ServicesMenu.strings').read_bytes() == locale_before,
          'symlink localization folder rejected without external writes')
    (resources / 'ko.lproj').unlink()
    shutil.copytree(unrelated_locale, resources / 'ko.lproj')
    localized_file = resources / 'ko.lproj/ServicesMenu.strings'
    localized_file.unlink()
    localized_file.symlink_to(unrelated_locale / 'ServicesMenu.strings')
    check(run(home).returncode != 0 and (unrelated_locale / 'ServicesMenu.strings').read_bytes() == locale_before,
          'symlink localization file rejected without external writes')
    localized_file.unlink()
    shutil.copy2(localized_source, localized_file)

    outsider = base / 'external-resources'
    shutil.copytree(resources, outsider)
    before = (outsider / 'convert.sh').read_bytes()
    shutil.rmtree(resources)
    resources.symlink_to(outsider, target_is_directory=True)
    (source / 'convert.sh').write_text('changed installer source\n')
    check(run(home).returncode != 0 and (outsider / 'convert.sh').read_bytes() == before, 'symlink resource directory rejected without external writes')
    resources.unlink()
    shutil.copytree(outsider, resources)

    unrelated = base / 'unrelated-file'
    unrelated.write_text('unrelated sentinel\n')
    (resources / 'convert.sh').unlink()
    os.link(unrelated, resources / 'convert.sh')
    result = run(home)
    check(result.returncode == 0 and unrelated.read_text() == 'unrelated sentinel\n', 'updating hardlinked installed file preserves unrelated inode')

    missing_before = (resources / 'convert.sh').read_bytes()
    (source / 'convert.sh').write_text('must not install partial update\n')
    (source / 'image.js').rename(source / 'image.js.hidden')
    result = run(home)
    check(result.returncode != 0 and (resources / 'convert.sh').read_bytes() == missing_before, 'missing source helper refuses before partial update')
    (source / 'image.js.hidden').rename(source / 'image.js')

    # Every added resource participates in preflight and destination checks;
    # a missing helper must not partially replace an existing installation.
    for helper in ('csv.js', 'excel.applescript', 'dng.js', 'locale.sh', 'preferred-language.js'):
        installed_before = (resources / 'convert.sh').read_bytes()
        (source / helper).rename(source / (helper + '.hidden'))
        result = run(home)
        check(result.returncode != 0 and (resources / 'convert.sh').read_bytes() == installed_before, f'missing {helper} refuses before partial update')
        (source / (helper + '.hidden')).rename(source / helper)
        installed_helper = resources / helper
        if installed_helper.exists() or installed_helper.is_symlink():
            installed_helper.unlink()
        installed_helper.symlink_to(unrelated)
        result = run(home)
        check(result.returncode != 0 and installed_helper.is_symlink() and unrelated.read_text() == 'unrelated sentinel\n', f'symlink {helper} destination preserved')
        installed_helper.unlink()
        shutil.copy2(source / helper, installed_helper)

    for name, kind in [('conflict-home', 'directory'), ('symlink-home', 'symlink'), ('broken-home', 'broken')]:
        conflict_home = base / name
        conflict = conflict_home / 'Library/Services/PDF로 변환.workflow'
        conflict.parent.mkdir(parents=True)
        if kind == 'directory':
            conflict.mkdir()
            (conflict / 'sentinel').write_text('untouched')
        else:
            conflict.symlink_to(target if kind == 'symlink' else base / 'missing', target_is_directory=True)
        result = run(conflict_home)
        unchanged = (conflict / 'sentinel').read_text() == 'untouched' if kind == 'directory' else conflict.is_symlink()
        check(result.returncode != 0 and unchanged, f'{kind} name conflict preserved')

    legacy_home = base / 'legacy-home'
    legacy = legacy_home / 'Library/Services/PDF로 변환.workflow'
    legacy.parent.mkdir(parents=True)
    legacy.symlink_to(source / 'PDF로 변환.workflow', target_is_directory=True)
    result = run(legacy_home)
    check(result.returncode == 0 and not legacy.is_symlink() and (legacy / 'Contents/Resources/convert.sh').exists(), 'legacy exact-checkout symlink migrated')

for passed, description in checks:
    print(('PASS' if passed else 'FAIL') + ': ' + description)
raise SystemExit(0 if all(passed for passed, _ in checks) else 1)
