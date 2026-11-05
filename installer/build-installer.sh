#!/bin/bash
# Build only a local developer artifact; never alter certificates or publish it.
set -eu
umask 077
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
output=''
preview=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir) [ "$#" -ge 2 ] || exit 2; output=$2; shift 2 ;;
    --preview-only) preview=1; shift ;;
    *) printf '%s\n' 'Usage: build-installer.sh --output-dir ABSOLUTE_PATH [--preview-only]' >&2; exit 2 ;;
  esac
done
while [ "$output" != / ] && [ "${output%/}" != "$output" ]; do output=${output%/}; done
case "$output" in /*) ;; *) printf '%s\n' 'An absolute output directory is required.' >&2; exit 2 ;; esac
# Refuse redirected output parents and source members; copied files are bounded.
# This is a build boundary, not an alternate managed-install entry point.
# Require an absolute path and refuse any symbolic-link ancestor.
check_parents() {
  local item=$1
  while [ "$item" != / ]; do
    [ ! -L "$item" ] || { printf '%s\n' 'Symbolic links are not accepted at the build boundary.' >&2; return 1; }
    item=$(dirname -- "$item")
  done
}
check_parents "$output"
mkdir -p "$output"
[ -d "$output" ] && [ "$(/usr/bin/stat -f %u "$output")" = "$(id -u)" ] || exit 1
name='Finder PDF Converter.app'
[ "$preview" -eq 0 ] || name='Finder PDF Converter Preview.app'
[ ! -e "$output/$name" ] && [ ! -L "$output/$name" ] && [ ! -e "$output/${name%.app}.zip" ] && [ ! -L "$output/${name%.app}.zip" ] || { printf '%s\n' 'Build output already exists; choose a new output directory.' >&2; exit 1; }
stage=$(mktemp -d "$output/.finder-pdf-build.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
app="$stage/$name"
printf 'var FPDF_INSTALLER_PREVIEW_ONLY = %s;\n' "$([ "$preview" -eq 1 ] && printf true || printf false)" > "$stage/app.js"
cat "$root/installer/model.js" "$root/installer/ui.js" >> "$stage/app.js"
/usr/bin/osacompile -s -l JavaScript -o "$app" "$stage/app.js"
resources="$app/Contents/Resources"
for language in en ko; do
  mkdir "$resources/$language.lproj"
  cp "$root/installer/resources/$language.lproj/Installer.json" "$resources/$language.lproj/Installer.json"
done
printf '%s\n' 'Local developer artifact. Ad-hoc signed only; public-release trust is unverified.' > "$resources/developer-status.txt"
if [ "$preview" -eq 0 ]; then
  # Login assets have the same bounded, non-redirected source contract as payload members.
  for file in installer/login-agent.plist installer/login-helper.m; do
    source_file="$root/$file"
    check_parents "$source_file"
    [ -f "$source_file" ] && [ ! -L "$source_file" ] && [ "$(/usr/bin/stat -f %l "$source_file")" -eq 1 ] || { printf 'Invalid login asset: %s\n' "$file" >&2; exit 1; }
    [ "$(/usr/bin/stat -f %z "$source_file")" -le 2097152 ] || { printf 'Oversized login asset: %s\n' "$file" >&2; exit 1; }
  done
  mkdir -p "$app/Contents/Library/LaunchAgents"
  cp "$root/installer/login-agent.plist" "$app/Contents/Library/LaunchAgents/com.wonjun-lab.finder-pdf-converter.login.plist"
  # CLT is a build-time dependency; the compiled helper ships inside the app.
  clang=$(/usr/bin/xcrun --find clang)
  sdk=$(/usr/bin/xcrun --sdk macosx --show-sdk-path)
  "$clang" -fobjc-arc -arch arm64 -arch x86_64 -mmacosx-version-min=13.0 \
    -isysroot "$sdk" -framework Foundation -framework AppKit \
    "$root/installer/login-helper.m" -o "$app/Contents/MacOS/fpdf-login-helper"
  /usr/bin/codesign --force --sign - "$app/Contents/MacOS/fpdf-login-helper"
  mkdir "$resources/payload"
  files=(locale.sh preferred-language.js convert.sh conversion-session.sh conversion-session.js conversion-status.js hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js print-fit.sh print-fit.js print-panel.js review-model.js document-review.js install.sh doctor.sh installer/managed-install.sh installer/managed-engine.js installer/stage-managed.sh)
  for workflow in 'PDF로 변환.workflow' '용지에 맞춰 인쇄.workflow' 'PDF 합치기.workflow'; do
    for member in Contents/Info.plist Contents/document.wflow Contents/Resources/en.lproj/InfoPlist.strings Contents/Resources/ko.lproj/InfoPlist.strings; do
      files+=("$workflow/$member")
    done
  done
  total=0
  for file in "${files[@]}"; do
    source_file="$root/$file"
    check_parents "$source_file"
    [ -f "$source_file" ] && [ ! -L "$source_file" ] && [ "$(/usr/bin/stat -f %l "$source_file")" -eq 1 ] || { printf 'Invalid payload member: %s\n' "$file" >&2; exit 1; }
    size=$(/usr/bin/stat -f %z "$source_file")
    [ "$size" -le 2097152 ] || exit 1
    total=$((total+size)); [ "$total" -le 10485760 ] || exit 1
    mkdir -p "$resources/payload/$(dirname -- "$file")"
    cp -P -X "$source_file" "$resources/payload/$file"
    [ -f "$resources/payload/$file" ] && [ ! -L "$resources/payload/$file" ] || exit 1
  done
  (cd "$resources/payload" && /usr/bin/shasum -a 256 "${files[@]}") > "$resources/payload.sha256"
fi
bundle_id='com.wonjun-lab.finder-pdf-converter.installer'
[ "$preview" -eq 0 ] || bundle_id="$bundle_id.preview"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $bundle_id" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Finder PDF Converter' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDevelopmentRegion en' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations array' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:0 string en' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:1 string ko' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :FPDFArtifactStatus string local-developer-untrusted' "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :FPDFPreviewOnly bool $([ "$preview" -eq 1 ] && printf true || printf false)" "$app/Contents/Info.plist"
# Last write to the app is its own ad-hoc signature, after all payload/metadata.
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --strict "$app"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$stage/${name%.app}.zip"
mv "$app" "$output/$name"
mv "$stage/${name%.app}.zip" "$output/${name%.app}.zip"
printf '%s\n' "$output/$name" "$output/${name%.app}.zip"
