#!/bin/bash
# Exercise the real text and Markdown adapters through the batch entry point.
set -eu
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH='' cd -- "$here/.." && pwd)
workspace=$(/usr/bin/mktemp -d /private/tmp/fpdf-text-check.XXXXXX)
trap '/bin/rm -r -- "$workspace"' EXIT
export FPDF_TEXT_TEST="$workspace"
/usr/bin/python3 - <<'PY'
import os
from pathlib import Path
p = Path(os.environ['FPDF_TEXT_TEST'])
(p / '긴 문서.TXT').write_text(('한글 문장과 English text 12345\n' * 250) + '끝마커 LATEKOREANMARKER\n', encoding='utf-8')
(p / '외부.txt').write_text('EXTERNALSECRETMARKER', encoding='utf-8')
(p / '문서.MD').write_text('# 제목\n\n본문 **강조**\n\n<script>HTML_LITERAL_MARKER</script>\n\n<img src="file://' + str(p / '외부.txt') + '">\n', encoding='utf-8')
(p / '별칭.MARKDOWN').write_text('# 별칭\n\nALIASMARKER\n', encoding='utf-8')
(p / '잘못된.txt').write_bytes(b'bad utf8: \xff\xfe')
PY
before=$(/usr/bin/shasum -a 256 "$workspace"/*.TXT "$workspace"/*.MD "$workspace"/*.MARKDOWN "$workspace"/*.txt)
set +e
/bin/bash "$root/convert.sh" --no-dialog -- "$workspace/긴 문서.TXT" "$workspace/문서.MD" "$workspace/별칭.MARKDOWN" "$workspace/잘못된.txt" > "$workspace/result.log"
status=$?
set -e
[[ $status == 1 ]] || fail 'malformed input did not fail batch'
[[ -s "$workspace/긴 문서.pdf" && -s "$workspace/문서.pdf" && -s "$workspace/별칭.pdf" && ! -e "$workspace/잘못된.pdf" ]] || fail 'unexpected outputs'
/usr/bin/grep -Eq '^(완료 3개 · 건너뜀 0개 · 실패 1개|Completed: 3 · Skipped: 0 · Failed: 1)$' "$workspace/result.log" || fail 'unexpected batch summary'
[[ $(/usr/bin/shasum -a 256 "$workspace"/*.TXT "$workspace"/*.MD "$workspace"/*.MARKDOWN "$workspace"/*.txt) == "$before" ]] || fail 'source changed'
/usr/bin/osascript -l JavaScript - "$workspace" <<'JAVASCRIPT'
ObjC.import('Foundation');
ObjC.import('PDFKit');
/** Open a PDF and read its independently extracted text and page count. */
function readPDF(path) {
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(path));
    if (!doc || doc.isNil()) throw Error('PDF cannot be opened');
    return {pages: Number(doc.pageCount), text: ObjC.unwrap(doc.string) || ''};
}
/** Check late Korean content, literal raw HTML, and no external-file content. */
function run(argv) {
    const text = readPDF(argv[0] + '/긴 문서.pdf');
    if (text.pages < 2 || !text.text.includes('LATEKOREANMARKER') || !text.text.includes('한글')) throw Error('multipage text lost content');
    const md = readPDF(argv[0] + '/문서.pdf');
    const compact = md.text.replace(/\s/g, '');
    if (!compact.includes('<script>HTML_LITERAL_MARKER</script>') || compact.includes('EXTERNALSECRETMARKER')) throw Error('raw HTML or external content handling failed');
    if (!readPDF(argv[0] + '/별칭.pdf').text.replace(/\s/g, '').includes('ALIASMARKER')) throw Error('markdown extension failed');
}
JAVASCRIPT
pdf_before=$(/usr/bin/shasum -a 256 "$workspace"/*.pdf)
/bin/bash "$root/convert.sh" --no-dialog -- "$workspace/긴 문서.TXT" "$workspace/문서.MD" "$workspace/별칭.MARKDOWN" > "$workspace/repeat.log"
/usr/bin/grep -Eq '^(완료 0개 · 건너뜀 3개 · 실패 0개|Completed: 0 · Skipped: 3 · Failed: 0)$' "$workspace/repeat.log" || fail 'repeat did not skip existing PDFs'
[[ $(/usr/bin/shasum -a 256 "$workspace"/*.pdf) == "$pdf_before" ]] || fail 'repeat changed PDFs'
printf '%s\n' 'PASS: Korean multipage content, Markdown aliases and literal HTML, malformed UTF-8, original preservation, repeat safety'
