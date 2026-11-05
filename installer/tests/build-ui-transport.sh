#!/bin/bash
# Build private native event-transport fixtures, never an installable release.
set -eu
umask 077
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
[ "$#" -eq 2 ] && [ "$1" = --output-dir ] || { printf '%s\n' 'Usage: build-ui-transport.sh --output-dir NEW_ABSOLUTE_DIRECTORY' >&2; exit 2; }
output=$2
case "$output" in /*) ;; *) exit 2 ;; esac
[ ! -e "$output" ] && [ ! -L "$output" ] || exit 1
mkdir "$output"
output=$(CDPATH='' cd -- "$output" && pwd -P)
for mode in inspect inspect-nested inspect-failure install; do
  bash "$root/installer/build-installer.sh" --output-dir "$output/$mode" > "$output/$mode-build.log" 2>&1
  original="$output/$mode/Finder PDF Converter Installer.app"
  name="Finder PDF UI $mode Test"
  app="$output/$mode/$name.app"
  mv "$original" "$app"
  rm -- "$output/$mode/Finder PDF Converter Installer.zip"
  node - "$mode" "$app" "$output/install-release" "$output/$mode-processes.json" "$root" <<'JS'
/** Replace only the copied app's public adapter with a fixed harmless UI fixture. */
const fs = require('node:fs');
const path = require('node:path');
const [mode, app, release, metadata, sourceRoot] = process.argv.slice(2);
/** Encode a literal path as one POSIX shell word; never use JSON as shell escaping. */
function shellWord(value) { return "'" + value.replace(/'/g, "'\\''") + "'"; }
const resources = path.join(app,'Contents/Resources');
let backend;
if (mode === 'inspect' || mode === 'inspect-nested' || mode === 'inspect-failure') {
    backend = `#!/bin/bash\ncase "\${1:-}" in\ninspect) exec /bin/sleep 60 ;;\ninstall|recover) printf '{"schemaVersion":1,"operation":"%s","outcome":{"kind":"invalid-request","code":"operation-failed"}}\\n' "$1"; exit 2 ;;\n*) exit 2 ;;\nesac\n`;
} else {
    backend = `#!/bin/bash
set -u
case "\${1:-}" in
inspect) printf '%s\\n' '{"schemaVersion":1,"operation":"inspect","outcome":{"kind":"fresh","apps":{"hwp":false,"word":false,"powerpoint":false,"excel":false}}}'; exit 0 ;;
install)
 release=${shellWord(release)}
 child=''
 # The only child is our owned short sleep; clean it up on interruption.
 cleanup() { local pending=$child; child=''; if [ -n "$pending" ]; then wait "$pending" 2>/dev/null || :; fi; }
 trap cleanup EXIT
 trap 'cleanup; exit 1' TERM INT
 deadline=$((SECONDS+120))
 while [ ! -f "$release" ] && [ "$SECONDS" -lt "$deadline" ]; do
   /bin/sleep 0.2 & child=$!
   wait "$child" || :
   child=''
 done
 printf '%s\\n' '{"schemaVersion":1,"operation":"install","outcome":{"kind":"installed"}}'
 exit 0 ;;
recover) printf '%s\\n' '{"schemaVersion":1,"operation":"recover","outcome":{"kind":"invalid-request","code":"operation-failed"}}'; exit 2 ;;
*) exit 2 ;;
esac
`;
}
if (mode === 'inspect-nested' || mode === 'inspect-failure') {
    backend = backend.replace('inspect) exec /bin/sleep 60 ;;',
        'inspect) here=$(cd -- "$(dirname -- "$0")" && pwd -P); exec /usr/bin/osascript -l JavaScript "$here/../../ui-transport-child.js" ;;');
    const source = `ObjC.import('Foundation');
ObjC.bindFunction('getpid',['int',[]]);ObjC.bindFunction('getpgid',['int',['int']]);
const task=$.NSTask.alloc.init;task.launchPath='/bin/bash';
task.arguments=$(['-c','for n in 1 2 3 4 5 6 7 8 9 10; do /bin/sleep 60 & /bin/sleep 0.01; done; wait']);
task.standardOutput=$.NSFileHandle.fileHandleWithNullDevice;task.standardError=$.NSFileHandle.fileHandleWithNullDevice;task.launch;
$(JSON.stringify({rootPID:Number($.getpid()),childPID:Number(task.processIdentifier),childGroup:Number($.getpgid(Number(task.processIdentifier)))})).writeToFileAtomicallyEncodingError(${JSON.stringify(metadata)},true,$.NSUTF8StringEncoding,null);
task.waitUntilExit;
`;
    fs.writeFileSync(path.join(resources,'ui-transport-child.js'),source);
}
fs.writeFileSync(path.join(resources,'payload/installer/managed-install.sh'),backend,{mode:0o600});
for (const locale of ['en','ko']) {
    const file = path.join(resources,locale+'.lproj/Installer.json');
    const strings = JSON.parse(fs.readFileSync(file,'utf8'));
    strings.window = 'UI transport test — '+mode;
    strings.product = 'UI transport test — '+mode;
    strings.developer = locale==='ko'?'UI 조작 시험 전용 · 설치 파일과 설정을 바꾸지 않습니다':'UI transport fixture · no installation or settings changes';
    fs.writeFileSync(file,JSON.stringify(strings,null,2)+'\n');
}
if (mode === 'inspect-failure') {
    const source='var FPDF_INSTALLER_PREVIEW_ONLY=false;\n'+fs.readFileSync(path.join(sourceRoot,'installer/model.js'),'utf8')+'\n'+fs.readFileSync(path.join(sourceRoot,'installer/ui.js'),'utf8')+'\nconst actualQuery=installerProcessSnapshot;let failedQuery=false;installerProcessSnapshot=function(pid,budget){if(!failedQuery){failedQuery=true;return {kind:"unavailable"};}return actualQuery(pid,budget);};\n';
    fs.writeFileSync(path.join(path.dirname(path.dirname(app)),mode+'-private-ui.js'),source);
}
fs.writeFileSync(path.join(resources,'developer-status.txt'),'PRIVATE UI TRANSPORT FIXTURE. Fixed harmless backend; never use as an installer.\n');
JS
  if [ "$mode" = inspect-failure ]; then
    /usr/bin/osacompile -l JavaScript -o "$app/Contents/Resources/Scripts/main.scpt" "$output/$mode-private-ui.js"
  fi
  payload="$app/Contents/Resources/payload"
  # Preserve the exact bounded inventory member set while updating its copied adapter hash.
  (cd "$payload" && /usr/bin/shasum -a 256 installer/managed-install.sh) > "$output/$mode-adapter.sha256"
  node - "$app" "$output/$mode-adapter.sha256" <<'JS'
/** Replace only the owned public adapter's manifest entry after a fixture edit. */
const fs = require('node:fs');
const path = require('node:path');
const [app, hashFile] = process.argv.slice(2);
const manifest=path.join(app,'Contents/Resources/payload.sha256');
const text=fs.readFileSync(manifest,'utf8');
fs.writeFileSync(manifest,text.replace(/^[a-f0-9]{64}  installer\/managed-install\.sh$/m,fs.readFileSync(hashFile,'utf8').trim()));
JS
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.wonjun-lab.finder-pdf-converter.transport.$mode" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $name" "$app/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Set :FPDFArtifactStatus private-ui-transport-test' "$app/Contents/Info.plist"
  /usr/bin/codesign --force --sign - "$app"
  /usr/bin/codesign --verify --strict "$app"
  (cd "$payload" && /usr/bin/shasum -a 256 -c ../payload.sha256) > "$output/$mode-manifest.log"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$output/$mode/$name.zip"
  printf '%s\n' "$app"
done
printf 'Release install fixture by creating: %s\n' "$output/install-release"
