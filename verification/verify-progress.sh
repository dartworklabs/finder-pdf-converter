#!/bin/bash
# Exercise actual conversion, status and cancellation using an owned adapter.
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH='' cd -- "$here/.." && pwd)
work=$(/usr/bin/mktemp -d /private/tmp/fpdf-progress.XXXXXX)
trap '/bin/rm -r -- "$work"' EXIT
mkdir "$work/app" "$work/docs" "$work/status" "$work/other"
chmod 700 "$work/status"
cp "$root/convert.sh" "$root/locale.sh" "$root/preferred-language.js" "$root/conversion-status.js" "$root/conversion-session.js" "$work/app/"
export FPDF_FIXTURE="$here/blank.pdf" FPDF_READY="$work/ready"
cat > "$work/app/word.applescript" <<'APPLE'
on run argv
  set s to read (POSIX file (item 1 of argv))
  if s starts with "FAIL" then error "fixture failure"
  if s starts with "SLOW" then
    do shell script "/usr/bin/touch " & quoted form of (system attribute "FPDF_READY")
    delay 2
  end if
  do shell script "/bin/cp " & quoted form of (system attribute "FPDF_FIXTURE") & " " & quoted form of (item 2 of argv)
end run
APPLE
printf SLOW > "$work/docs/한글
one.docx"
printf FAIL > "$work/docs/fail.docx"
printf PASS > "$work/other/fail.docx"
/bin/bash "$work/app/convert.sh" --no-dialog --progress-dir "$work/status" -- "$work/docs/한글
one.docx" "$work/docs/fail.docx" "$work/other/fail.docx" > "$work/out" &
pid=$!
for ((i=0;i<100;i++)); do [[ ! -e $FPDF_READY ]] || break; sleep 0.05; done
[[ -e $FPDF_READY ]] || exit 1
touch "$work/status/cancel"
set +e; wait "$pid"; code=$?; set -e
[[ $code == 130 && -s "$work/docs/한글
one.pdf" && ! -e "$work/docs/fail.pdf" && ! -e "$work/other/fail.pdf" ]] || exit 1
/usr/bin/osascript -l JavaScript - "$work/status/status.json" <<'JXA'
ObjC.import('Foundation');
function run(a) { const s=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(a[0],4,null))); if(s.phase!=='cancelled'||s.items[0].status!=='completed'||s.items[1].status!=='cancelled'||s.items[2].status!=='cancelled'||s.items[0].name!=='한글\none.docx') throw Error('cancellation state'); }
JXA
rm "$work/status/cancel"
set +e
/bin/bash "$work/app/convert.sh" --no-dialog --progress-dir "$work/status" --attempt 2 --indices 2,3 -- "$work/docs/fail.docx" "$work/other/fail.docx" > "$work/out2"
code=$?
set -e
[[ $code == 1 && -s "$work/other/fail.pdf" && ! -e "$work/docs/fail.pdf" ]] || exit 1
[[ $(/usr/bin/osascript -l JavaScript "$work/app/conversion-status.js" failed "$work/status/status.json") == 2 ]] || exit 1
printf '{"version":1,"attempt":1,"action":"retry"}' > "$work/command"
if /usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" command "$work/command" 2 >/dev/null 2>&1; then exit 1; fi
printf PASS > "$work/docs/fail.docx"
/bin/bash "$work/app/convert.sh" --no-dialog --progress-dir "$work/status" --attempt 3 --indices 2 -- "$work/docs/fail.docx" > "$work/out3"
[[ -s "$work/docs/fail.pdf" ]] || exit 1
/bin/bash "$work/app/convert.sh" --no-dialog --progress-dir "$work/status" --attempt 4 --prepare-pdfs print -- "$here/blank.pdf" > "$work/out4"
# A failed refresh leaves the selected snapshot untouched; a repaired source
# is then copied without touching the other snapshot.
printf old > "$work/docs/snapshot.docx"
printf untouched > "$work/other/snapshot.docx"
printf '[{"source":"%s/docs/source.docx","snapshot":"%s/docs/snapshot.docx"}]' "$work" "$work" > "$work/map.json"
if /usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map.json" "$work/docs/snapshot.docx" >/dev/null 2>&1; then exit 1; fi
[[ $(cat "$work/docs/snapshot.docx") == old ]] || exit 1
printf repaired > "$work/docs/source.docx"
/usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map.json" "$work/docs/snapshot.docx"
[[ $(cat "$work/docs/snapshot.docx") == repaired && $(cat "$work/other/snapshot.docx") == untouched ]] || exit 1
# A valid near-limit filename must still allow a short temporary copy.
long_name=$(/usr/bin/printf '文%.0s' {1..70})$'\n| document.pdf'
printf old > "$work/docs/$long_name"
/usr/bin/python3 - "$work/map-long.json" "$work/docs/source.docx" "$work/docs/$long_name" <<'PYTHON'
import json, sys
with open(sys.argv[1], 'w', encoding='utf-8') as output:
    json.dump([{'source': sys.argv[2], 'snapshot': sys.argv[3]}], output)
PYTHON
/usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map-long.json" "$work/docs/$long_name"
[[ $(cat "$work/docs/$long_name") == repaired ]] || exit 1
# The copied bytes do not inherit Finder metadata from the source.
/usr/bin/xattr -w org.example.fpdf fixture "$work/docs/source.docx"
/usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map.json" "$work/docs/snapshot.docx"
if /usr/bin/xattr -p org.example.fpdf "$work/docs/snapshot.docx" >/dev/null 2>&1; then exit 1; fi
# Source and snapshot symlinks are rejected without following or replacing them.
ln -s "$work/docs/source.docx" "$work/docs/source-link.docx"
printf '[{"source":"%s/docs/source-link.docx","snapshot":"%s/docs/snapshot.docx"}]' "$work" "$work" > "$work/map-link.json"
if /usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map-link.json" "$work/docs/snapshot.docx" >/dev/null 2>&1; then exit 1; fi
[[ $(cat "$work/docs/snapshot.docx") == repaired ]] || exit 1
ln -s "$work/docs/snapshot.docx" "$work/docs/snapshot-link.docx"
printf '[{"source":"%s/docs/source.docx","snapshot":"%s/docs/snapshot-link.docx"}]' "$work" "$work" > "$work/map-link.json"
if /usr/bin/osascript -l JavaScript "$work/app/conversion-session.js" refresh "$work/map-link.json" "$work/docs/snapshot-link.docx" >/dev/null 2>&1; then exit 1; fi
[[ -L "$work/docs/snapshot-link.docx" && $(cat "$work/docs/snapshot.docx") == repaired ]] || exit 1
printf 'PASS: progress, safe cancellation, failed indices, stale command, retry, PDF preparation and snapshot refresh\n'
