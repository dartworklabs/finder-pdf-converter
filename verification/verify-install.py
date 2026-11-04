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
    for name in ['install.sh', 'locale.sh', 'preferred-language.js', 'convert.sh', 'hancom.applescript', 'word.applescript', 'powerpoint.applescript', 'excel.applescript', 'image.js', 'dng.js', 'text.js', 'markdown.js', 'csv.js', 'print-fit.sh', 'print-fit.js', 'review-model.js', 'document-review.js']:
        shutil.copy2(REPO / name, source / name)
    shutil.copytree(REPO / 'PDF로 변환.workflow', source / 'PDF로 변환.workflow')
    shutil.copytree(REPO / '용지에 맞춰 인쇄.workflow', source / '용지에 맞춰 인쇄.workflow')

    shutil.copytree(REPO / 'PDF 합치기.workflow', source / 'PDF 합치기.workflow')

    def run(home):
        """Run the real installer with HOME isolated from the user's services."""
        return subprocess.run(['/bin/bash', str(source / 'install.sh')], env={**os.environ, 'HOME': str(home)}, capture_output=True, text=True)

    home = base / 'fresh-home'
    result = run(home)
    target = home / 'Library/Services/PDF로 변환.workflow'
    resources = target / 'Contents/Resources'
    check(result.returncode == 0 and all((resources / name).is_file() and (resources / name).read_bytes() == (source / name).read_bytes() for name in ('image.js', 'dng.js', 'text.js', 'markdown.js', 'csv.js', 'excel.applescript')), 'fresh alternate HOME install includes every renderer')
    check((target / 'Contents/project').is_symlink(), 'ownership marker installed')
    localized = ('en.lproj/InfoPlist.strings', 'ko.lproj/InfoPlist.strings')
    obsolete = ('en.lproj/ServicesMenu.strings', 'ko.lproj/ServicesMenu.strings')
    v1 = {f'{language}.lproj/ServicesMenu.strings':
          ('/* Finder and Services menu title; key matches NSMenuItem.default. */\n'
           f'"PDF로 변환" = "{title}";\n').encode()
          for language, title in (('en', 'Convert to PDF'), ('ko', 'PDF로 변환'))}
    check(all((resources / name).is_file() and
              (resources / name).read_bytes() == (source / 'PDF로 변환.workflow/Contents/Resources' / name).read_bytes()
              for name in localized) and
          all(not (resources / name).exists() for name in obsolete),
          'fresh install retains InfoPlist translations without menu strings')
    print_target = home / 'Library/Services/용지에 맞춰 인쇄.workflow'
    print_files = ('Info.plist', 'document.wflow', 'Resources/en.lproj/InfoPlist.strings', 'Resources/ko.lproj/InfoPlist.strings')
    check(all((print_target / 'Contents' / name).read_bytes() == (source / '용지에 맞춰 인쇄.workflow/Contents' / name).read_bytes() for name in print_files) and all((resources / name).read_bytes() == (source / name).read_bytes() for name in ('print-fit.sh', 'print-fit.js')), 'both actions and print helpers installed')
    merge_target = home / 'Library/Services/PDF 합치기.workflow'
    check(all((merge_target / 'Contents' / name).read_bytes() == (source / 'PDF 합치기.workflow/Contents' / name).read_bytes() for name in print_files), 'merge action installed with stable localized metadata')
    review = resources / 'Finder PDF Review.app'
    check((review / 'Contents/MacOS/applet').is_file() and (resources / 'review-app.sha256').is_file(), 'built-in compiler produces installed native review app and hash inventory')
    check(subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(review)], capture_output=True).returncode == 0, 'generated app signature remains valid after metadata creation')
    review_info = review / 'Contents/Info.plist'
    original_info = review_info.read_bytes()
    review_info.write_bytes(original_info + b'\n')
    check(run(home).returncode != 0 and review_info.read_bytes() == original_info + b'\n', 'modified generated helper blocks update without deleting changes')
    review_info.write_bytes(original_info)
    extra = review / 'Contents/Resources/unrelated.txt'
    extra.write_text('preserve unrelated file')
    check(run(home).returncode != 0 and extra.read_text() == 'preserve unrelated file', 'extra helper file blocks replacement')
    extra.unlink()
    extra.symlink_to(base / 'absent')
    check(run(home).returncode != 0 and extra.is_symlink(), 'linked helper member blocks replacement')
    extra.unlink()
    check(run(home).returncode == 0, 'unchanged owned helper can be upgraded')
    before = (resources / 'convert.sh').read_bytes()
    original_js = (source / 'document-review.js').read_bytes()
    (source / 'document-review.js').write_text('function run( { syntax error')
    check(run(home).returncode != 0 and (resources / 'convert.sh').read_bytes() == before, 'review compilation failure leaves installed resources unchanged')
    (source / 'document-review.js').write_bytes(original_js)
    conflict_home = base / 'merge-conflict-home'
    foreign = conflict_home / 'Library/Services/PDF 합치기.workflow'
    foreign.mkdir(parents=True)
    (foreign / 'sentinel').write_text('untouched')
    check(run(conflict_home).returncode != 0 and (foreign / 'sentinel').read_text() == 'untouched' and not (conflict_home / 'Library/Services/PDF로 변환.workflow').exists(), 'foreign merge action blocks entire installation')
    # A foreign print action must block all updates, including converter files.
    conflict_home = base / 'print-conflict-home'
    foreign = conflict_home / 'Library/Services/용지에 맞춰 인쇄.workflow'
    foreign.mkdir(parents=True)
    (foreign / 'sentinel').write_text('untouched')
    check(run(conflict_home).returncode != 0 and (foreign / 'sentinel').read_text() == 'untouched' and not (conflict_home / 'Library/Services/PDF로 변환.workflow').exists(), 'foreign print action blocks converter install')
    before = (resources / 'convert.sh').read_bytes()
    (source / 'convert.sh').write_text('new version\n')
    bad_print_file = print_target / 'Contents/document.wflow'
    bad_print_file.unlink()
    bad_print_file.symlink_to(base / 'missing')
    check(run(home).returncode != 0 and (resources / 'convert.sh').read_bytes() == before and bad_print_file.is_symlink(), 'print conflict blocks converter update')
    bad_print_file.unlink()
    shutil.copy2(source / '용지에 맞춰 인쇄.workflow/Contents/document.wflow', bad_print_file)
    (resources / 'convert.sh').write_text('old conversion\n')
    for name in obsolete:
        (resources / name).write_bytes(v1[name])
    check(run(home).returncode == 0 and all(not (resources / name).exists() for name in obsolete),
          'upgrade removes exact v1 menu strings')
    check((resources / 'convert.sh').read_bytes() == (source / 'convert.sh').read_bytes(),
          'upgrade restores conversion helper bytes')
    for language in ('en', 'ko'):
        shutil.rmtree(resources / f'{language}.lproj')
    check(run(home).returncode == 0 and all(
        (resources / name).is_file() and
        (resources / name).read_bytes() == (source / 'PDF로 변환.workflow/Contents/Resources' / name).read_bytes()
        for name in localized), 'upgrade restores missing localization directories and translations')
    for name in obsolete:
        path = resources / name
        for kind in ('different', 'symlink', 'directory', 'fifo'):
            if kind == 'different':
                path.write_text('unrelated content\n')
            elif kind == 'symlink':
                path.symlink_to(base / 'missing')
            elif kind == 'directory':
                path.mkdir()
            else:
                os.mkfifo(path)
            before = (resources / 'convert.sh').read_bytes()
            (source / 'convert.sh').write_text('changed before refusal\n')
            check(run(home).returncode != 0 and (resources / 'convert.sh').read_bytes() == before and
                  (path.exists() or path.is_symlink()), f'{kind} obsolete {name} preserved before update')
            if kind == 'directory':
                path.rmdir()
            else:
                path.unlink()
    localized_source = source / 'PDF로 변환.workflow/Contents/Resources/ko.lproj/InfoPlist.strings'
    localized_source.rename(localized_source.with_suffix('.hidden'))
    before = (resources / 'convert.sh').read_bytes()
    check(run(home).returncode != 0 and (resources / 'convert.sh').read_bytes() == before,
          'missing localization refuses before partial update')
    localized_source.with_suffix('.hidden').rename(localized_source)
    unrelated_locale = base / 'external-locale'
    shutil.copytree(resources / 'ko.lproj', unrelated_locale)
    locale_before = (unrelated_locale / 'InfoPlist.strings').read_bytes()
    shutil.rmtree(resources / 'ko.lproj')
    (resources / 'ko.lproj').symlink_to(unrelated_locale, target_is_directory=True)
    check(run(home).returncode != 0 and (unrelated_locale / 'InfoPlist.strings').read_bytes() == locale_before,
          'symlink localization folder rejected without external writes')
    (resources / 'ko.lproj').unlink()
    shutil.copytree(unrelated_locale, resources / 'ko.lproj')
    localized_file = resources / 'ko.lproj/InfoPlist.strings'
    localized_file.unlink()
    localized_file.symlink_to(unrelated_locale / 'InfoPlist.strings')
    check(run(home).returncode != 0 and (unrelated_locale / 'InfoPlist.strings').read_bytes() == locale_before,
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
    for helper in ('csv.js', 'excel.applescript', 'dng.js', 'locale.sh', 'preferred-language.js', 'print-fit.sh', 'print-fit.js', 'review-model.js', 'document-review.js'):
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
