#!/bin/bash
# Public managed-install boundary. Arguments are passed as data, never shell code.
set -u
umask 077
here=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && printf '%s.' "$PWD")
here=${here%.}
home=$(CDPATH='' cd -P -- "${HOME:-/nonexistent}" && printf '%s.' "$PWD") || {
  case "${1:-}" in inspect|install|recover) printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"failed","code":"unsafe-path"}}\n' "$1" ;; *) printf '{"schemaVersion":1,"operation":"inspect","outcome":{"kind":"invalid-request","code":"unsafe-path"}}\n' ;; esac
  exit 1
}
home=${home%.}
if { [ "${1:-}" = install ] || [ "${1:-}" = recover ]; } && [ "$#" -eq 3 ] && [ "$2" = --source-root ] && [ -n "$3" ]; then
  support="$home/Library/Application Support/Finder PDF Converter"
  if [ ! -e "$support" ] && [ ! -L "$support" ]; then
    # Refuse an invalid or foreign installation before creating a lock scope.
    preflight=$(/usr/bin/osascript -l JavaScript "$here/managed-engine.js" "$here" "$home" inspect --source-root "$3")
    status=$?
    if [ "$status" -ne 0 ]; then
      printf '%s\n' "${preflight/\"operation\":\"inspect\"/\"operation\":\"$1\"}"
      exit "$status"
    fi
    if [ "$1" = recover ]; then printf '{"schemaVersion":1,"operation":"recover","outcome":{"kind":"recovered"}}\n'; exit 0; fi
  fi
  for dir in "$home/Library" "$home/Library/Application Support" "$home/Library/Application Support/Finder PDF Converter"; do
    if [ ! -e "$dir" ] && [ ! -L "$dir" ]; then mkdir "$dir" 2>/dev/null || [ -d "$dir" ] || { printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"failed","code":"write-failed"}}\n' "$1"; exit 1; }; fi
    if [ ! -d "$dir" ] || [ -L "$dir" ]; then printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"failed","code":"unsafe-path"}}\n' "$1"; exit 1; fi
  done
  if [ "$(/usr/bin/stat -f %u "$dir")" != "$(/usr/bin/id -u)" ] || [ $((8#$(/usr/bin/stat -f %Lp "$dir") & 077)) -ne 0 ]; then
    if [ "$1" = recover ]; then printf '{"schemaVersion":1,"operation":"recover","outcome":{"kind":"recovery-required","code":"recovery-conflict"}}\n'; exit 1; fi
    printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"failed","code":"unsafe-path"}}\n' "$1"; exit 1
  fi
  exec 9<"$dir" || { printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"failed","code":"write-failed"}}\n' "$1"; exit 1; }
  if ! /usr/bin/lockf -s -t 0 9; then printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"busy"}}\n' "$1"; exit 1; fi
fi
exec /usr/bin/osascript -l JavaScript "$here/managed-engine.js" "$here" "$home" "$@"
