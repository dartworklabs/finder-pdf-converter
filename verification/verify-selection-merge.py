#!/usr/bin/env python3
"""Exercise native selection and untransformed PDF merging without submitting a print job."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import pymupdf as fitz

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'print-fit.js'


def invoke(selection, output, paths):
    """Run the real JXA entry point with the private selection and destination."""
    return subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(SCRIPT), '--selection', str(selection),
                           '--merge', str(output), '--', *(str(p) for p in paths)], capture_output=True, text=True)


def main():
    """Verify original page order and geometry and reject invalid batches without output."""
    with tempfile.TemporaryDirectory(prefix='selection-merge-') as temp:
        root = Path(temp)
        paths = []
        for group in range(2):
            directory = root / str(group)
            directory.mkdir()
            path = directory / '동일 이름.pdf'
            doc = fitz.open()
            for page_num in range(2):
                page = doc.new_page(width=400 + 100 * group, height=500 + 50 * page_num)
                page.insert_text((80, 100), f'group-{group}-page-{page_num}')
                page.set_cropbox(fitz.Rect(20, 30, page.mediabox.width - 40, page.mediabox.height - 50))
                page.set_rotation((group * 2 + page_num) * 90)
                page.add_text_annot((100, 120), 'annotation')
            doc.save(path)
            doc.close()
            paths.append(path)
        selection = root / 'selection.json'
        output = root / 'output.pdf'
        valid = {'version': 1, 'cancelled': False, 'files': [{'index': 1, 'pages': [2, 1], 'name': '원본 문서.docx'}, {'index': 0, 'pages': [2]}]}
        selection.write_text(json.dumps(valid))
        result = invoke(selection, output, paths)
        assert result.returncode == 0, result.stderr
        with fitz.open(output) as actual:
            assert len(actual) == 3
            assert actual.get_toc() == [[1, '원본 문서.docx', 1], [1, '동일 이름.pdf', 3]]
            for page, (index, number) in zip(actual, [(1, 1), (1, 0), (0, 1)]):
                with fitz.open(paths[index]) as source:
                    expected = source[number]
                    assert page.mediabox == expected.mediabox
                    assert page.cropbox == expected.cropbox
                    assert page.rotation == expected.rotation
                    assert page.get_text() == expected.get_text()
                    assert [a.info['content'] for a in page.annots()] == ['annotation']
        existing = output.read_bytes()
        assert invoke(selection, output, paths).returncode != 0
        assert output.read_bytes() == existing
        output.unlink()
        for files in ([{'index': 0, 'pages': [1, 1]}], [{'index': 0, 'pages': [1]}, {'index': 0, 'pages': [2]}],
                      [{'index': 2, 'pages': [1]}], [{'index': 0, 'pages': [0]}], [{'index': 0, 'pages': [3]}],
                      [{'index': 0, 'pages': [1.5]}], [{'index': 0, 'pages': []}], []):
            selection.write_text(json.dumps({**valid, 'files': files}))
            assert invoke(selection, output, paths).returncode != 0, files
            assert not output.exists()
        selection.write_text(json.dumps(valid))
        bad = root / 'bad.pdf'
        bad.write_text('not a PDF')
        assert invoke(selection, output, [paths[0], bad]).returncode != 0
        assert not output.exists()
        encrypted = root / 'encrypted.pdf'
        with fitz.open(paths[1]) as doc:
            doc.save(encrypted, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='secret')
        assert invoke(selection, output, [paths[0], encrypted]).returncode != 0
        assert not output.exists()
        restricted = root / 'restricted.pdf'
        with fitz.open(paths[1]) as doc:
            doc.save(restricted, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='', permissions=fitz.PDF_PERM_PRINT)
        assert invoke(selection, output, [paths[0], restricted]).returncode != 0
        assert not output.exists()
    print('PASS: selected original pages, geometry, annotations, ordering and invalid inputs')


if __name__ == '__main__':
    main()
