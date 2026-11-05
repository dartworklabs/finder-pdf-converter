"""Verify private staging creates signed workflows without touching live paths."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / 'installer/stage-managed.sh'
RESOURCES = ('locale.sh', 'preferred-language.js', 'convert.sh', 'conversion-session.sh',
             'conversion-session.js', 'conversion-status.js', 'hancom.applescript',
             'word.applescript', 'powerpoint.applescript', 'excel.applescript', 'image.js',
             'dng.js', 'text.js', 'markdown.js', 'csv.js', 'print-fit.sh', 'print-fit.js',
             'print-panel.js', 'review-model.js', 'document-review.js')
WORKFLOWS = ('PDF로 변환.workflow', '용지에 맞춰 인쇄.workflow', 'PDF 합치기.workflow')


def main():
    """Staging binds the future stable owner even for unusual source paths."""
    with tempfile.TemporaryDirectory(prefix='fpdf-stage-') as temp:
        home = Path(temp) / "한글 'quoted'\nuser"
        home.mkdir()
        support = home / 'Library/Application Support/Finder PDF Converter'
        source = support / 'transaction/new-source'
        source.mkdir(parents=True)
        for name in RESOURCES:
            shutil.copy2(REPO / name, source / name)
        (source / '.finder-pdf-receipt.json').write_text('[]')
        for name in WORKFLOWS:
            shutil.copytree(REPO / name, source / name)
        result = subprocess.run(['/bin/bash', str(SCRIPT)], check=False, env={**os.environ, 'HOME': str(home)},
                                capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        staged = support / 'transaction/new-workflows'
        owner = str((support / 'source').resolve())
        assert not (home / 'Library/Services').exists()
        assert not (support / 'source').exists()
        for name in WORKFLOWS:
            assert os.readlink(staged / name / 'Contents/project') == owner
        resources = staged / WORKFLOWS[0] / 'Contents/Resources'
        for name in ('Finder PDF Review.app', 'Finder PDF Print.app'):
            app = resources / name
            assert (app / 'Contents/Resources/finder-pdf-owner').read_text() == owner
            assert subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(app)], check=False,
                                  capture_output=True).returncode == 0
        retry = subprocess.run(['/bin/bash', str(SCRIPT)], check=False, env={**os.environ, 'HOME': str(home)},
                               capture_output=True, text=True)
        assert retry.returncode != 0 and os.readlink(staged / WORKFLOWS[0] / 'Contents/project') == owner
        shutil.rmtree(staged)
        resource = source / 'convert.sh'
        resource.unlink()
        outside = home / 'outside'
        outside.write_text('sentinel')
        os.link(outside, resource)
        refused = subprocess.run(['/bin/bash', str(SCRIPT)], check=False, env={**os.environ, 'HOME': str(home)},
                                 capture_output=True, text=True)
        assert refused.returncode != 0 and outside.read_text() == 'sentinel' and not staged.exists()
        print('PASS: staging keeps live paths untouched and embeds the stable owner before signing')
        print('PASS: existing output and hardlinked input are refused without changing them')


if __name__ == '__main__':
    main()
