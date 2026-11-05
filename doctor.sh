#!/bin/bash
# Read-only installation diagnostics. No apps launch and no permissions change.
# Exit 0: installed files match; 1: missing/different files; 2: unsupported use.
set -eu

if [ "$#" -ne 0 ] && { [ "$#" -ne 2 ] || [ "$1" != --source-root ]; }; then
  printf '%s\n' '사용법: bash ./doctor.sh [--source-root PATH]' >&2
  exit 2
fi
if [ "$(/usr/bin/uname -s)" != Darwin ]; then
  printf '%s\n' '확인 불가: macOS에서 실행해 주세요.' >&2
  exit 2
fi
if [ -z "${HOME:-}" ]; then
  printf '%s\n' '확인 불가: HOME이 설정되어 있지 않습니다.' >&2
  exit 2
fi
if [ "$#" -eq 2 ]; then
  [ -d "$2" ] && [ ! -L "$2" ] || exit 1
  # The trusted caller has established the exact physical owner spelling.
  # Retain its bytes: macOS may return a decomposed spelling from getcwd.
  root=$2
else
  root=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && printf '%s.' "$PWD")
  root=${root%.}
fi
target="$HOME/Library/Services/PDF로 변환.workflow"
resources=(locale.sh preferred-language.js convert.sh conversion-session.sh conversion-session.js conversion-status.js hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js print-fit.sh print-fit.js print-panel.js review-model.js document-review.js)
status=0
printf '%s\n' '확인: macOS'

# Compare each installed regular file with this checkout without printing paths.
# Missing, unreadable, linked, or different files make the diagnosis fail.
check_file() {
  local source_file="$1" installed_file="$2" label="$3"
  if [ ! -f "$source_file" ] || [ -L "$source_file" ]; then
    printf '확인 불가: 원본 파일 없음 또는 링크 — %s\n' "$label"
    status=1
  elif [ ! -f "$installed_file" ] || [ -L "$installed_file" ]; then
    printf '설치 확인 필요: 파일 없음 또는 링크 — %s\n' "$label"
    status=1
  elif /usr/bin/cmp -s "$source_file" "$installed_file"; then
    printf '일치: %s\n' "$label"
  else
    printf '설치 확인 필요: 내용 다름 또는 읽기 실패 — %s\n' "$label"
    status=1
  fi
}

if [ ! -d "$target" ] || [ -L "$target" ] || [ -L "$target/Contents" ] || [ -L "$target/Contents/Resources" ]; then
  printf '%s\n' '설치 확인 필요: 빠른 동작이 없거나 폴더가 링크입니다.'
  status=1
else
  for file in Info.plist document.wflow; do
    check_file "$root/PDF로 변환.workflow/Contents/$file" "$target/Contents/$file" "$file"
  done
  for file in "${resources[@]}"; do
    check_file "$root/$file" "$target/Contents/Resources/$file" "$file"
  done
  for directory in en.lproj ko.lproj; do
    if [ ! -d "$target/Contents/Resources/$directory" ] || [ -L "$target/Contents/Resources/$directory" ]; then
      printf '설치 확인 필요: 번역 폴더 없음 또는 링크 — %s\n' "$directory"
      status=1
    else
      check_file "$root/PDF로 변환.workflow/Contents/Resources/$directory/InfoPlist.strings" "$target/Contents/Resources/$directory/InfoPlist.strings" "$directory/InfoPlist.strings"
      old="$target/Contents/Resources/$directory/ServicesMenu.strings"
      if [ -e "$old" ] || [ -L "$old" ]; then
        printf '설치 확인 필요: 오래된 메뉴 번역 파일 — %s/ServicesMenu.strings\n' "$directory"
        status=1
      fi
    fi
  done
fi

# Check the separately registered print action and its localized metadata.
print_target="$HOME/Library/Services/용지에 맞춰 인쇄.workflow"
if [ ! -d "$print_target" ] || [ -L "$print_target" ] || [ ! -d "$print_target/Contents" ] || [ -L "$print_target/Contents" ] || [ ! -d "$print_target/Contents/Resources" ] || [ -L "$print_target/Contents/Resources" ]; then
  printf '%s\n' '설치 확인 필요: 인쇄 빠른 동작이 없거나 폴더가 링크입니다.'
  status=1
else
  for file in Info.plist document.wflow; do
    check_file "$root/용지에 맞춰 인쇄.workflow/Contents/$file" "$print_target/Contents/$file" "인쇄/$file"
  done
  for directory in en.lproj ko.lproj; do
    if [ ! -d "$print_target/Contents/Resources/$directory" ] || [ -L "$print_target/Contents/Resources/$directory" ]; then
      printf '설치 확인 필요: 인쇄 번역 폴더 없음 또는 링크 — %s\n' "$directory"
      status=1
    else
      check_file "$root/용지에 맞춰 인쇄.workflow/Contents/Resources/$directory/InfoPlist.strings" "$print_target/Contents/Resources/$directory/InfoPlist.strings" "인쇄/$directory/InfoPlist.strings"
    fi
  done
fi

# Inspect each generated host's exact inventory, source hashes, and signature
# without recompiling, launching, or writing diagnostic files.
app_names=("Finder PDF Review.app" "Finder PDF Print.app")
app_inventories=(review-app.sha256 print-app.sha256)
app_sources=("review-model.js document-review.js" "print-fit.js print-panel.js")
for ((index=0; index<${#app_names[@]}; index++)); do
  app="$target/Contents/Resources/${app_names[$index]}"
  inventory="$target/Contents/Resources/${app_inventories[$index]}"
  read -r -a sources <<< "${app_sources[$index]}"
  if [ -L "$app" ] || [ ! -d "$app" ] || [ -L "$inventory" ] || [ ! -f "$inventory" ] ||
     [ -n "$(/usr/bin/find "$app" ! -type f ! -type d -print 2>/dev/null)" ] ||
     ! cmp -s "$app/Contents/Resources/finder-pdf-owner" <(printf '%s' "$root") ||
     ! cmp -s "$inventory" <(cd "$app" && /usr/bin/find -s . -type f -exec /usr/bin/shasum -a 256 {} \; 2>/dev/null) ||
     ! cmp -s "$app/Contents/Resources/finder-pdf-sources.sha256" <(cd "$root" && /usr/bin/shasum -a 256 "${sources[@]}" 2>/dev/null) ||
     ! /usr/bin/codesign --verify --strict "$app" >/dev/null 2>&1; then
    printf '설치 확인 필요: 생성 앱 없음·소유권·내용·원본·서명 차이 — %s\n' "${app_names[$index]}"
    status=1
  else
    printf '일치: 생성 앱과 원본 해시·서명 — %s\n' "${app_names[$index]}"
  fi
done

# Check the separately registered merge action and its localized metadata.
merge_target="$HOME/Library/Services/PDF 합치기.workflow"
if [ ! -d "$merge_target" ] || [ -L "$merge_target" ] || [ ! -d "$merge_target/Contents" ] || [ -L "$merge_target/Contents" ] || [ ! -d "$merge_target/Contents/Resources" ] || [ -L "$merge_target/Contents/Resources" ]; then
  printf '%s\n' '설치 확인 필요: 합치기 빠른 동작이 없거나 폴더가 링크입니다.'
  status=1
else
  for file in Info.plist document.wflow; do
    check_file "$root/PDF 합치기.workflow/Contents/$file" "$merge_target/Contents/$file" "합치기/$file"
  done
  for directory in en.lproj ko.lproj; do
    if [ ! -d "$merge_target/Contents/Resources/$directory" ] || [ -L "$merge_target/Contents/Resources/$directory" ]; then
      printf '설치 확인 필요: 합치기 번역 폴더 없음 또는 링크 — %s\n' "$directory"
      status=1
    else
      check_file "$root/PDF 합치기.workflow/Contents/Resources/$directory/InfoPlist.strings" "$merge_target/Contents/Resources/$directory/InfoPlist.strings" "합치기/$directory/InfoPlist.strings"
    fi
  done
fi

# Apps are optional per input format. Check standard locations, never launch them.
printf '%s\n' '앱 확인(선택 항목, /Applications 및 ~/Applications):'
for app in 'Hancom Office HWP' 'Microsoft Word' 'Microsoft PowerPoint' 'Microsoft Excel'; do
  if [ -d "/Applications/$app.app" ] || [ -d "$HOME/Applications/$app.app" ]; then
    printf '발견: %s\n' "$app"
  else
    printf '미발견: %s (다른 위치의 설치 여부는 직접 확인)\n' "$app"
  fi
done
printf '%s\n' '앱 실행·라이선스·권한·실제 변환 성공 여부는 이 점검으로 확인하지 않습니다.'
exit "$status"
