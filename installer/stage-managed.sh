#!/bin/bash
# Private staging surface: build all workflow bundles under the fixed
# transaction directory, embedding the fixed final managed-source owner.
# It never changes live Services or the managed source. The caller owns the
# transaction lock and must validate the payload before invoking this script.
set -eu
umask 077

if [ "$#" -ne 0 ] || [ -z "${HOME:-}" ] || [ ! -d "$HOME" ] || [ -L "$HOME" ]; then
  printf '%s\n' 'Invalid staging request.' >&2
  exit 2
fi
home=$(CDPATH='' cd -P -- "$HOME" && printf '%s.' "$PWD")
home=${home%.}
support="$home/Library/Application Support/Finder PDF Converter"
txn="$support/transaction"
root="$txn/new-source"
owner="$support/source"
out="$txn/new-workflows"
for path in "$home/Library" "$home/Library/Application Support" "$support" "$txn" "$root"; do
  if [ ! -d "$path" ] || [ -L "$path" ]; then
    printf '%s\n' 'Unsafe staging directory.' >&2
    exit 1
  fi
done
if [ -e "$out" ] || [ -L "$out" ]; then
  printf '%s\n' 'Staging output already exists.' >&2
  exit 1
fi
if [ -e "$txn/stage-app.js" ] || [ -L "$txn/stage-app.js" ]; then
  printf '%s\n' 'Staging scratch file already exists.' >&2
  exit 1
fi
resources=(locale.sh preferred-language.js convert.sh conversion-session.sh conversion-session.js conversion-status.js hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js print-fit.sh print-fit.js print-panel.js review-model.js document-review.js)
workflows=('PDF로 변환.workflow' '용지에 맞춰 인쇄.workflow' 'PDF 합치기.workflow')
members=(Contents/Info.plist Contents/document.wflow Contents/Resources/en.lproj/InfoPlist.strings Contents/Resources/ko.lproj/InfoPlist.strings)

# Refuse links and hard links even if a caller missed a source-file check.
regular_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(/usr/bin/stat -f %l "$1")" = 1 ]
}
for file in "${resources[@]}"; do
  regular_file "$root/$file" || { printf '%s\n' 'Invalid staged resource.' >&2; exit 1; }
done
regular_file "$root/.finder-pdf-receipt.json" || { printf '%s\n' 'Invalid staged receipt.' >&2; exit 1; }
for workflow in "${workflows[@]}"; do
  for dir in "$root/$workflow" "$root/$workflow/Contents" "$root/$workflow/Contents/Resources" "$root/$workflow/Contents/Resources/en.lproj" "$root/$workflow/Contents/Resources/ko.lproj"; do
    [ -d "$dir" ] && [ ! -L "$dir" ] || { printf '%s\n' 'Invalid staged workflow directory.' >&2; exit 1; }
  done
  for file in "${members[@]}"; do
    regular_file "$root/$workflow/$file" || { printf '%s\n' 'Invalid staged workflow file.' >&2; exit 1; }
  done
done
mkdir "$out"
for workflow in "${workflows[@]}"; do
  dest="$out/$workflow"
  mkdir -p "$dest/Contents/Resources/en.lproj" "$dest/Contents/Resources/ko.lproj"
  for file in "${members[@]}"; do cp "$root/$workflow/$file" "$dest/$file"; done
  ln -s "$owner" "$dest/Contents/project"
done
convert="$out/${workflows[0]}/Contents/Resources"
for file in "${resources[@]}"; do cp "$root/$file" "$convert/$file"; done
app_names=('Finder PDF Review.app' 'Finder PDF Print.app')
app_inventories=(review-app.sha256 print-app.sha256)
app_sources=('review-model.js document-review.js' 'print-fit.js print-panel.js')
app_identifiers=(review print)
for ((index=0; index<${#app_names[@]}; index++)); do
  app="$convert/${app_names[$index]}"
  read -r -a sources <<< "${app_sources[$index]}"
  (set -C; cat "${sources[@]/#/$root/}" > "$txn/stage-app.js")
  /usr/bin/osacompile -l JavaScript -o "$app" "$txn/stage-app.js"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.wonjun-lab.finder-pdf-converter.${app_identifiers[$index]}" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :CFBundleDevelopmentRegion en' "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations array' "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:0 string en' "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:1 string ko' "$app/Contents/Info.plist"
  printf '%s' "$owner" > "$app/Contents/Resources/finder-pdf-owner"
  (cd "$root" && /usr/bin/shasum -a 256 "${sources[@]}") > "$app/Contents/Resources/finder-pdf-sources.sha256"
  (cd "$root" && /usr/bin/shasum -a 256 .finder-pdf-receipt.json) > "$app/Contents/Resources/finder-pdf-payload.sha256"
  /usr/bin/codesign --force --sign - "$app"
  (cd "$app" && /usr/bin/find -s . -type f -exec /usr/bin/shasum -a 256 {} \;) > "$convert/${app_inventories[$index]}"
  rm "$txn/stage-app.js"
done
