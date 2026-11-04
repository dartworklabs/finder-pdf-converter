#!/bin/bash
# Exercise native CSV rendering through publication without opening Office.
set -eu
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH='' cd -- "$here/.." && pwd)
workspace=$(/usr/bin/mktemp -d /private/tmp/fpdf-csv-check.XXXXXX)
trap '/bin/rm -r -- "$workspace"' EXIT
export FPDF_CSV_TEST="$workspace"
/usr/bin/python3 - <<'PY'
"""Build independent source records, literal formulas and a malformed record."""
import csv, os
from pathlib import Path
p = Path(os.environ['FPDF_CSV_TEST'])
with (p / 'quoted.CSV').open('w', encoding='utf-8', newline='') as f:
    csv.writer(f).writerows([['한글 FIRSTROW', 'comma,value', 'quote "value"'], ['MULTILINE\nLATEFIELD', '=SUM(1,2)', '<b>LITERALHTML</b>']])
with (p / 'wide.csv').open('w', encoding='cp949', newline='') as f:
    csv.writer(f).writerows([['한글 첫째', 'two', 'three', 'four', 'five', 'LASTWIDEMARKER']])
(p / 'malformed.csv').write_text('"never closed', encoding='utf-8')
(p / 'empty.csv').write_bytes(b'')
PY
before=$(/usr/bin/shasum -a 256 "$workspace"/*.CSV "$workspace"/*.csv)
set +e
/bin/bash "$root/convert.sh" --no-dialog -- "$workspace/quoted.CSV" "$workspace/wide.csv" "$workspace/malformed.csv" "$workspace/empty.csv" > "$workspace/result.log"
status=$?
set -e
[[ $status == 1 ]] || fail 'malformed CSV did not fail batch'
[[ -s "$workspace/quoted.pdf" && -s "$workspace/wide.pdf" && -s "$workspace/empty.pdf" && ! -e "$workspace/malformed.pdf" ]] || fail 'CSV outputs differ from contract'
/usr/bin/grep -q '완료 3개 · 건너뜀 0개 · 실패 1개' "$workspace/result.log" || fail 'CSV batch summary differs'
[[ $(/usr/bin/shasum -a 256 "$workspace"/*.CSV "$workspace"/*.csv) == "$before" ]] || fail 'CSV source changed'
/usr/bin/osascript -l JavaScript - "$workspace" <<'JS'
ObjC.import('Foundation');
ObjC.import('PDFKit');
/** Read real exported text independently of parser and renderer internals. */
function run(argv) {
    function text(name) {
        const pdf = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0] + '/' + name + '.pdf'));
        if (!pdf || pdf.isNil() || Number(pdf.pageCount) < 1) throw Error('CSV PDF unreadable');
        return ObjC.unwrap(pdf.string).replace(/\s/g, '');
    }
    const quoted = text('quoted');
    ['한글FIRSTROW', 'comma,value', 'quote"value"', 'MULTILINE', 'LATEFIELD', '=SUM(1,2)', '<b>LITERALHTML</b>'].forEach(function(marker) {
        if (quoted.indexOf(marker) < 0) throw Error('CSV content lost: ' + marker);
    });
    const wide = text('wide');
    if (wide.indexOf('한글첫째') < 0 || wide.indexOf('LASTWIDEMARKER') < 0) throw Error('wide CP949 CSV lost content');
    text('empty');
}
JS
pdf_before=$(/usr/bin/shasum -a 256 "$workspace"/*.pdf)
/bin/bash "$root/convert.sh" --no-dialog -- "$workspace/quoted.CSV" "$workspace/wide.csv" "$workspace/empty.csv" > "$workspace/repeat.log"
/usr/bin/grep -q '완료 0개 · 건너뜀 3개 · 실패 0개' "$workspace/repeat.log" || fail 'CSV existing PDF not skipped'
[[ $(/usr/bin/shasum -a 256 "$workspace"/*.pdf) == "$pdf_before" ]] || fail 'CSV existing PDF changed'
printf '%s\n' 'PASS: CSV quoted/multiline/Korean/CP949/wide/literal fields, malformed rejection, empty file, original preservation, repeat safety'
