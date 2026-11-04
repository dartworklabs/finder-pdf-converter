#!/bin/bash
# Install a Finder service bundle owned by this checkout; preserve name conflicts.
set -eu
umask 077
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
source="$root/PDF로 변환.workflow"
target="$HOME/Library/Services/PDF로 변환.workflow"
print_source="$root/용지에 맞춰 인쇄.workflow"
print_target="$HOME/Library/Services/용지에 맞춰 인쇄.workflow"
merge_source="$root/PDF 합치기.workflow"
merge_target="$HOME/Library/Services/PDF 합치기.workflow"
review_name="Finder PDF Review.app"
review_inventory="review-app.sha256"
resources=(locale.sh preferred-language.js convert.sh hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js print-fit.sh print-fit.js review-model.js document-review.js)
localizations=(en.lproj ko.lproj)
bundle_resources=(en.lproj/InfoPlist.strings ko.lproj/InfoPlist.strings)
obsolete_resources=(en.lproj/ServicesMenu.strings ko.lproj/ServicesMenu.strings)
for directory in Resources Resources/en.lproj Resources/ko.lproj; do
  if [ ! -d "$source/Contents/$directory" ] || [ -L "$source/Contents/$directory" ]; then
    printf '%s\n' "번역 폴더가 없거나 링크여서 설치할 수 없습니다: $directory" >&2
    exit 1
  fi
done
for file in "${bundle_resources[@]}"; do
  if [ ! -f "$source/Contents/Resources/$file" ] || [ -L "$source/Contents/Resources/$file" ]; then
    printf '%s\n' "번역 파일이 없거나 링크여서 설치할 수 없습니다: $file" >&2
    exit 1
  fi
done
# Validate the second bundle before either installed action can change.
for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
  if [ ! -f "$print_source/Contents/$file" ] || [ -L "$print_source/Contents/$file" ]; then
    printf '%s\n' "인쇄 빠른 동작 파일이 없거나 링크입니다: $file" >&2
    exit 1
  fi
done
for directory in Contents Contents/Resources Contents/Resources/en.lproj Contents/Resources/ko.lproj; do
  if [ ! -d "$print_source/$directory" ] || [ -L "$print_source/$directory" ]; then
    printf '%s\n' "인쇄 빠른 동작 폴더가 없거나 링크입니다: $directory" >&2
    exit 1
  fi
done
# The merge action must also be complete before any installation is changed.
for directory in Contents Contents/Resources Contents/Resources/en.lproj Contents/Resources/ko.lproj; do
  if [ ! -d "$merge_source/$directory" ] || [ -L "$merge_source/$directory" ]; then
    printf '%s\n' "합치기 빠른 동작 폴더가 없거나 링크입니다: $directory" >&2; exit 1
  fi
done
for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
  if [ ! -f "$merge_source/Contents/$file" ] || [ -L "$merge_source/Contents/$file" ]; then
    printf '%s\n' "합치기 빠른 동작 파일이 없거나 링크입니다: $file" >&2; exit 1
  fi
done
for file in "${resources[@]}"; do
  if [ ! -f "$root/$file" ] || [ -L "$root/$file" ]; then
    printf '%s\n' "실행 파일이 없어 설치할 수 없습니다: $file" >&2
    exit 1
  fi
done
for file in Info.plist document.wflow; do
  if [ ! -f "$source/Contents/$file" ] || [ -L "$source/Contents/$file" ]; then
    printf '%s\n' "빠른 동작 파일이 없어 설치할 수 없습니다: $file" >&2
    exit 1
  fi
done
mkdir -p "$HOME/Library/Services"
# Build all replacement files first. A failed copy leaves the installed version
# untouched; renaming each staged file avoids following existing file hardlinks.
stage=$(mktemp -d "$HOME/Library/Services/.finder-pdf-install.XXXXXX")
trap 'rm -r -- "$stage"' EXIT
mkdir "$stage/Contents" "$stage/Contents/Resources"
for file in "${resources[@]}"; do
  cp "$root/$file" "$stage/Contents/Resources/$file"
done
for directory in "${localizations[@]}"; do
  mkdir "$stage/Contents/Resources/$directory"
done
for file in "${bundle_resources[@]}"; do
  cp "$source/Contents/Resources/$file" "$stage/Contents/Resources/$file"
done
cp "$source/Contents/Info.plist" "$source/Contents/document.wflow" "$stage/Contents/"
ln -s "$root" "$stage/Contents/project"
mkdir -p "$stage/print/Contents/Resources/en.lproj" "$stage/print/Contents/Resources/ko.lproj"
for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
  cp "$print_source/Contents/$file" "$stage/print/Contents/$file"
done
ln -s "$root" "$stage/print/Contents/project"
mkdir -p "$stage/merge/Contents/Resources/en.lproj" "$stage/merge/Contents/Resources/ko.lproj"
for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
  cp "$merge_source/Contents/$file" "$stage/merge/Contents/$file"
done
ln -s "$root" "$stage/merge/Contents/project"
# Build the Cocoa review application using only macOS's built-in compiler.
# Compilation failure is detected while every installed bundle is untouched.
cat "$root/review-model.js" "$root/document-review.js" > "$stage/review.js"
/usr/bin/osacompile -l JavaScript -o "$stage/Contents/Resources/$review_name" "$stage/review.js"
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.wonjun-lab.finder-pdf-converter.review' "$stage/Contents/Resources/$review_name/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDevelopmentRegion en' "$stage/Contents/Resources/$review_name/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations array' "$stage/Contents/Resources/$review_name/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:0 string en' "$stage/Contents/Resources/$review_name/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Add :CFBundleLocalizations:1 string ko' "$stage/Contents/Resources/$review_name/Contents/Info.plist"
printf '%s' "$root" > "$stage/Contents/Resources/$review_name/Contents/Resources/finder-pdf-owner"
(cd "$root" && /usr/bin/shasum -a 256 review-model.js document-review.js) > "$stage/Contents/Resources/$review_name/Contents/Resources/finder-pdf-sources.sha256"
/usr/bin/codesign --force --sign - "$stage/Contents/Resources/$review_name"
# Inventory every generated file by relative path; generated app bytes are not
# tracked in git. Extra, changed, linked, or special entries block replacement.
(cd "$stage/Contents/Resources/$review_name" && /usr/bin/find -s . -type f -exec /usr/bin/shasum -a 256 {} \;) > "$stage/Contents/Resources/$review_inventory"

# Reject foreign or redirected print bundles before modifying the converter.
if [ -e "$print_target" ] || [ -L "$print_target" ]; then
  if [ -L "$print_target" ] || [ ! -d "$print_target" ] || [ -L "$print_target/Contents" ] || [ ! -d "$print_target/Contents" ] || [ ! -L "$print_target/Contents/project" ] || [ "$(readlink "$print_target/Contents/project")" != "$root" ]; then
    printf '%s\n' "기존 인쇄 빠른 동작이 있어 설치하지 않았습니다: $print_target" >&2
    exit 1
  fi
  for directory in Resources Resources/en.lproj Resources/ko.lproj; do
    if [ -L "$print_target/Contents/$directory" ] || { [ -e "$print_target/Contents/$directory" ] && [ ! -d "$print_target/Contents/$directory" ]; }; then
      printf '%s\n' "인쇄 빠른 동작 폴더가 변경되었습니다: $directory" >&2
      exit 1
    fi
  done
  for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
    if [ -L "$print_target/Contents/$file" ] || { [ -e "$print_target/Contents/$file" ] && [ ! -f "$print_target/Contents/$file" ]; }; then
      printf '%s\n' "인쇄 빠른 동작 파일 위치가 변경되었습니다: $file" >&2
      exit 1
    fi
  done
fi
# Reject foreign or redirected merge bundles before modifying the converter.
if [ -e "$merge_target" ] || [ -L "$merge_target" ]; then
  if [ -L "$merge_target" ] || [ ! -d "$merge_target" ] || [ -L "$merge_target/Contents" ] || [ ! -d "$merge_target/Contents" ] || [ ! -L "$merge_target/Contents/project" ] || [ "$(readlink "$merge_target/Contents/project")" != "$root" ]; then
    printf '%s\n' "기존 합치기 빠른 동작이 있어 설치하지 않았습니다: $merge_target" >&2
    exit 1
  fi
  for directory in Resources Resources/en.lproj Resources/ko.lproj; do
    if [ -L "$merge_target/Contents/$directory" ] || { [ -e "$merge_target/Contents/$directory" ] && [ ! -d "$merge_target/Contents/$directory" ]; }; then
      printf '%s\n' "합치기 빠른 동작 폴더가 변경되었습니다: $directory" >&2
      exit 1
    fi
  done
  for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
    if [ -L "$merge_target/Contents/$file" ] || { [ -e "$merge_target/Contents/$file" ] && [ ! -f "$merge_target/Contents/$file" ]; }; then
      printf '%s\n' "합치기 빠른 동작 파일 위치가 변경되었습니다: $file" >&2
      exit 1
    fi
  done
fi
# Replace only the legacy symlink produced for this exact checkout.
if [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]; then
  unlink "$target"
fi
if [ ! -L "$target" ] && [ -d "$target" ] && [ ! -L "$target/Contents" ] && [ -d "$target/Contents" ] && [ -L "$target/Contents/project" ] && [ "$(readlink "$target/Contents/project")" = "$root" ]; then
  if [ -L "$target/Contents/Resources" ] || { [ -e "$target/Contents/Resources" ] && [ ! -d "$target/Contents/Resources" ]; }; then
    printf '%s\n' "실행 파일 폴더가 변경되어 설치하지 않았습니다: $target/Contents/Resources" >&2
    exit 1
  fi
  for directory in "${localizations[@]}"; do
    if [ -L "$target/Contents/Resources/$directory" ] || { [ -e "$target/Contents/Resources/$directory" ] && [ ! -d "$target/Contents/Resources/$directory" ]; }; then
      printf '%s\n' "번역 폴더가 변경되어 설치하지 않았습니다: $directory" >&2
      exit 1
    fi
  done
  for file in "${resources[@]}"; do
    if [ -L "$target/Contents/Resources/$file" ] || [ -d "$target/Contents/Resources/$file" ]; then
      printf '%s\n' "실행 파일 위치가 변경되어 설치하지 않았습니다: $file" >&2
      exit 1
    fi
  done
  for file in "${bundle_resources[@]}"; do
    if [ -L "$target/Contents/Resources/$file" ] || [ -d "$target/Contents/Resources/$file" ]; then
      printf '%s\n' "번역 파일 위치가 변경되어 설치하지 않았습니다: $file" >&2
      exit 1
    fi
  done
  # Only the exact files installed by v1 are ours to remove. Check both
  # before replacing anything, including broken links and special files.
  for file in "${obsolete_resources[@]}"; do
    old="$target/Contents/Resources/$file"
    if [ -e "$old" ] || [ -L "$old" ]; then
      case "$file" in
        en.lproj/*) title='Convert to PDF' ;;
        ko.lproj/*) title='PDF로 변환' ;;
      esac
      printf '/* Finder and Services menu title; key matches NSMenuItem.default. */\n"PDF로 변환" = "%s";\n' "$title" > "$stage/old-menu.strings"
      if [ -L "$old" ] || [ ! -f "$old" ] || ! cmp -s "$old" "$stage/old-menu.strings"; then
        printf '%s\n' "기존 메뉴 번역 파일이 변경되어 설치하지 않았습니다: $file" >&2
        exit 1
      fi
    fi
  done
  for file in Info.plist document.wflow; do
    if [ -L "$target/Contents/$file" ] || [ -d "$target/Contents/$file" ]; then
      printf '%s\n' "빠른 동작 파일 위치가 변경되어 설치하지 않았습니다: $file" >&2
      exit 1
    fi
  done
  review_installed="$target/Contents/Resources/$review_name"
  inventory_installed="$target/Contents/Resources/$review_inventory"
  if [ -e "$review_installed" ] || [ -L "$review_installed" ] || [ -e "$inventory_installed" ] || [ -L "$inventory_installed" ]; then
    if [ -L "$review_installed" ] || [ ! -d "$review_installed" ] || [ -L "$inventory_installed" ] || [ ! -f "$inventory_installed" ] ||
       [ -n "$(/usr/bin/find "$review_installed" ! -type f ! -type d -print)" ] ||
       ! cmp -s "$review_installed/Contents/Resources/finder-pdf-owner" "$stage/Contents/Resources/$review_name/Contents/Resources/finder-pdf-owner"; then
      printf '%s\n' '검토 앱이 없거나 소유권·파일 형식이 바뀌어 설치하지 않았습니다.' >&2; exit 1
    fi
    (cd "$review_installed" && /usr/bin/find -s . -type f -exec /usr/bin/shasum -a 256 {} \;) > "$stage/existing-review.sha256"
    if ! cmp -s "$inventory_installed" "$stage/existing-review.sha256"; then
      printf '%s\n' '검토 앱 내용이 바뀌어 설치하지 않았습니다.' >&2; exit 1
    fi
  fi
  mkdir -p "$target/Contents/Resources"
  for file in "${obsolete_resources[@]}"; do
    if [ -f "$target/Contents/Resources/$file" ]; then
      rm -- "$target/Contents/Resources/$file"
    fi
  done
  for file in "${resources[@]}"; do
    mv -f "$stage/Contents/Resources/$file" "$target/Contents/Resources/$file"
  done
  if [ -d "$review_installed" ]; then mv "$review_installed" "$stage/previous-review.app"; fi
  mv "$stage/Contents/Resources/$review_name" "$target/Contents/Resources/$review_name"
  mv -f "$stage/Contents/Resources/$review_inventory" "$target/Contents/Resources/$review_inventory"
  for directory in "${localizations[@]}"; do
    mkdir -p "$target/Contents/Resources/$directory"
  done
  for file in "${bundle_resources[@]}"; do
    mv -f "$stage/Contents/Resources/$file" "$target/Contents/Resources/$file"
  done
  mv -f "$stage/Contents/Info.plist" "$target/Contents/Info.plist"
  mv -f "$stage/Contents/document.wflow" "$target/Contents/document.wflow"
  printf '%s\n' '설치를 갱신했습니다.'
elif [ -e "$target" ] || [ -L "$target" ]; then
  printf '%s\n' "기존 항목이 있어 설치하지 않았습니다: $target" >&2
  exit 1
else
  mkdir "$target"
  mv "$stage/Contents" "$target/Contents"
  printf '%s\n' "설치했습니다: $target"
fi
if [ -d "$print_target" ]; then
  mkdir -p "$print_target/Contents/Resources/en.lproj" "$print_target/Contents/Resources/ko.lproj"
  for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
    mv -f "$stage/print/Contents/$file" "$print_target/Contents/$file"
  done
  printf '%s\n' '인쇄 빠른 동작을 갱신했습니다.'
else
  mv "$stage/print" "$print_target"
  printf '%s\n' "설치했습니다: $print_target"
fi
if [ -d "$merge_target" ]; then
  mkdir -p "$merge_target/Contents/Resources/en.lproj" "$merge_target/Contents/Resources/ko.lproj"
  for file in Info.plist document.wflow Resources/en.lproj/InfoPlist.strings Resources/ko.lproj/InfoPlist.strings; do
    mv -f "$stage/merge/Contents/$file" "$merge_target/Contents/$file"
  done
  printf '%s\n' '합치기 빠른 동작을 갱신했습니다.'
else
  mv "$stage/merge" "$merge_target"
  printf '%s\n' "설치했습니다: $merge_target"
fi
/System/Library/CoreServices/pbs -flush
/System/Library/CoreServices/pbs -update
