#!/bin/bash
# Exercise real conversion + native proof rendering. Every invocation uses
# --proof, so even a failed assertion cannot physically submit a print job.
# Optional argument supplies a batch entry mutation; helpers stay real.
set -eu
here=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd)
entry=${1:-$here/../print-fit.sh}
workspace=$(/usr/bin/mktemp -d /private/tmp/fpdf-fit-check.XXXXXX)
trap '/bin/rm -r -- "$workspace"' EXIT

# Fail explicitly because Bash 3.2 errexit does not cover every [[ ]] context.
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
mkdir "$workspace/app" "$workspace/docs" "$workspace/docs/other"
for helper in convert.sh print-fit.js locale.sh preferred-language.js text.js markdown.js csv.js; do
    cp "$here/../$helper" "$workspace/app/"
done
cp "$entry" "$workspace/app/print-fit.sh"
run="$workspace/app/print-fit.sh"
docs="$workspace/docs"
printf 'FIRSTPRIVATEINPUT' > "$docs/same.txt"
printf 'SECONDPRIVATEINPUT' > "$docs/other/same.txt"
printf 'THIRDPRIVATEINPUT' > "$docs/same.md"
printf 'adjacent PDF sentinel' > "$docs/same.pdf"
cp "$here/blank.pdf" "$docs/selected.PDF"
before=$(/usr/bin/shasum -a 256 "$docs/same.txt" "$docs/other/same.txt" "$docs/same.md" "$docs/same.pdf" "$docs/selected.PDF")
/bin/bash "$run" --proof "$workspace/batch.pdf" -- "$docs/same.txt" "$docs/other/same.txt" "$docs/same.md" "$docs/selected.PDF" >"$workspace/stdout" 2>"$workspace/stderr" || fail 'real mixed-format proof failed'
[[ -s "$workspace/batch.pdf" ]] || fail 'mixed proof missing'
[[ $(/usr/bin/shasum -a 256 "$docs/same.txt" "$docs/other/same.txt" "$docs/same.md" "$docs/same.pdf" "$docs/selected.PDF") == "$before" ]] || fail 'source or adjacent PDF changed'
[[ ! -e "$docs/other/same.pdf" ]] || fail 'conversion wrote beside original'
/usr/bin/osascript -l JavaScript - "$workspace/batch.pdf" <<'JXA' >/dev/null
ObjC.import('Foundation'); ObjC.import('PDFKit');
/** Assert ordered source text in the real four-page proof, including duplicate names. */
function run(argv) {
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
    if (doc.isNil() || Number(doc.pageCount) !== 4) throw Error('Expected every selected page exactly once');
    ['FIRSTPRIVATEINPUT', 'SECONDPRIVATEINPUT', 'THIRDPRIVATEINPUT'].forEach((text, index) => {
        const pageText = ObjC.unwrap(doc.pageAtIndex(index).string) || '';
        if (!pageText.includes(text)) throw Error('Input order or basename isolation lost at page ' + index);
    });
}
JXA

# A bad late member rejects the entire batch and preserves any original PDF.
printf 'unsupported bytes' > "$docs/unsupported.bin"
printf 'not a PDF' > "$docs/broken.pdf"
printf '\000damaged text' > "$docs/broken.txt"
ln -s "$docs/same.txt" "$docs/symlink.txt"
mkdir "$docs/folder.txt"
for bad in "$docs/unsupported.bin" "$docs/broken.pdf" "$docs/broken.txt" "$docs/symlink.txt" "$docs/folder.txt" "$docs/missing.txt"; do
    set +e
    /bin/bash "$run" --proof "$workspace/rejected.pdf" -- "$docs/selected.PDF" "$bad" >"$workspace/stdout" 2>"$workspace/stderr"
    status=$?
    set -e
    [[ $status == 1 && ! -e "$workspace/rejected.pdf" ]] || fail "partial/invalid batch accepted: ${bad##*/}"
    [[ -s "$workspace/stderr" ]] || fail 'failure had no diagnostic'
done

# Malformed options cannot consume a selected filename or fall through to print.
for mode in unknown missing-proof no-input; do
    case $mode in
        unknown) args=(--proof "$workspace/rejected.pdf" --unknown -- "$docs/selected.PDF") ;;
        missing-proof) args=(--proof) ;;
        no-input) args=(--proof "$workspace/rejected.pdf" --) ;;
    esac
    set +e
    /bin/bash "$run" "${args[@]}" >"$workspace/stdout" 2>"$workspace/stderr"
    status=$?
    set -e
    [[ $status == 2 && ! -e "$workspace/rejected.pdf" ]] || fail "unsafe option handling: $mode"
done
printf 'keep existing proof' > "$workspace/existing.pdf"
ln -s "$workspace/missing.pdf" "$workspace/proof-link.pdf"
for occupied in "$workspace/existing.pdf" "$workspace/proof-link.pdf"; do
    set +e
    /bin/bash "$run" --proof "$occupied" -- "$docs/selected.PDF" >"$workspace/stdout" 2>"$workspace/stderr"
    status=$?
    set -e
    [[ $status == 2 ]] || fail 'occupied proof accepted'
done
[[ $(cat "$workspace/existing.pdf") == 'keep existing proof' && -L "$workspace/proof-link.pdf" ]] || fail 'occupied proof changed'

# Seeded names cover shell punctuation, option-shaped names, and trailing
# newlines in parents and files. Their text must survive through the real proof.
RANDOM=4137
for ((index=0; index<4; index++)); do
    parent="$docs/이름 $RANDOM ' \$"$'\n'
    mkdir "$parent"
    source="$parent/--proof [$index] \$ '"$'\n.txt'
    printf 'GENERATED_%s' "$index" > "$source"
    expected=$(/usr/bin/shasum -a 256 "$source")
    /bin/bash "$run" --proof "$workspace/generated-$index.pdf" -- "$source" >"$workspace/stdout" 2>"$workspace/stderr" || fail 'generated path rejected'
    [[ $(/usr/bin/shasum -a 256 "$source") == "$expected" && -s "$workspace/generated-$index.pdf" ]] || fail 'generated path input changed or proof missing'
    [[ ! -e ${source%.*}.pdf ]] || fail 'generated input published adjacent PDF'
done
# Inject a competing writer at the owned renderer boundary, after the real
# native proof is complete but before the batch can publish the requested name.
# This keeps the real conversion/render path while deterministically racing save.
/usr/bin/python3 - "$workspace/app/print-fit.js" <<'PYTEST'
from pathlib import Path
import sys
path = Path(sys.argv[1])
source = path.read_text().replace('function run(argv)', 'function nativeProofRun(argv)')
source += """
/** Let a competing writer claim the final name after real proof rendering. */
function run(argv) {
    nativeProofRun(argv);
    const path = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_TEST_PROOF_RACE_PATH'));
    if (!path || !$.NSString.alloc.initWithUTF8String('competing writer').writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null)) throw Error('Race fixture failed');
}
"""
path.write_text(source)
PYTEST
set +e
FPDF_TEST_PROOF_RACE_PATH="$workspace/race.pdf" /bin/bash "$run" --proof "$workspace/race.pdf" -- "$docs/selected.PDF" >"$workspace/stdout" 2>"$workspace/stderr"
status=$?
set -e
[[ $status == 1 && $(cat "$workspace/race.pdf") == 'competing writer' ]] || fail 'racing proof writer overwritten'
[[ -z $(find "$workspace" -name '.fpdf-proof.*' -print) ]] || fail 'proof staging leaked after publication failure'
printf 'PASS: private all-or-nothing print batch, order, proof and paths\n'
