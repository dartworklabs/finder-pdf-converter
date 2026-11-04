#!/bin/bash
# Install a Finder service bundle owned by this checkout; preserve name conflicts.
set -eu
umask 077
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
source="$root/PDF로 변환.workflow"
target="$HOME/Library/Services/PDF로 변환.workflow"
resources=(locale.sh preferred-language.js convert.sh hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js)
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
  mkdir -p "$target/Contents/Resources"
  for file in "${obsolete_resources[@]}"; do
    if [ -f "$target/Contents/Resources/$file" ]; then
      rm -- "$target/Contents/Resources/$file"
    fi
  done
  for file in "${resources[@]}"; do
    mv -f "$stage/Contents/Resources/$file" "$target/Contents/Resources/$file"
  done
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
/System/Library/CoreServices/pbs -flush
/System/Library/CoreServices/pbs -update
