#!/bin/bash
# Read-only installation diagnostics. No apps launch and no permissions change.
# Exit 0: installed files match; 1: missing/different files; 2: unsupported use.
set -eu

if [ "$#" -ne 0 ]; then
  printf '%s\n' '사용법: bash ./doctor.sh' >&2
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
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
target="$HOME/Library/Services/PDF로 변환.workflow"
resources=(convert.sh hancom.applescript word.applescript powerpoint.applescript excel.applescript image.js dng.js text.js markdown.js csv.js)
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
