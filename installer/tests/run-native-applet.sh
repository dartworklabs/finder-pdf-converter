#!/bin/bash
# Use osascript locally. The hosted native fixtures step opts in to a signed applet.
set -eu
stage=$1
script=$2
case "${FINDER_PDF_CI_NATIVE_APPLET-0}" in
    0) exec /usr/bin/osascript -l JavaScript "$script" ;;
    1)
        if [[ ${CI-} != true || ${GITHUB_ACTIONS-} != true || ${RUNNER_OS-} != macOS ||
              ${RUNNER_ENVIRONMENT-} != github-hosted ]]; then
            echo 'Native assertion applet requires a GitHub-hosted macOS Actions runner' >&2
            exit 1
        fi
        ;;
    *) echo 'FINDER_PDF_CI_NATIVE_APPLET must be 0 or 1' >&2; exit 1 ;;
esac
marker="$stage/assertions-complete"
applet="$stage/NativeAssertions.app"
rm -f -- "$marker"
# Applet console.log is routed to the system log instead of its stdout. Keep
# the existing test output and its downstream log assertion visible to bash.
cat > "$stage/applet-source.js" <<'JXA'
ObjC.import('Foundation');
console.log = function(value) {
    const text=String(value)+'\n';
    const data=$(text).dataUsingEncoding($.NSUTF8StringEncoding);
    $.NSFileHandle.fileHandleWithStandardOutput.writeData(data);
};
JXA
cat "$script" >> "$stage/applet-source.js"
script="$stage/applet-source.js"
# The original assertions execute at top level. Only reaching run after they
# finish can write this marker; exit prevents the stay-open applet from hanging.
cat >> "$script" <<'JXA'
ObjC.bindFunction('exit', ['void', ['int']]);
run = function() {
    const marker=$.NSProcessInfo.processInfo.environment.objectForKey('FPDF_ASSERTIONS_MARKER');
    if (!marker || !$('complete').writeToFileAtomicallyEncodingError(marker,true,$.NSUTF8StringEncoding,null)) $.exit(2);
    $.exit(0);
};
JXA
/usr/bin/osacompile -s -l JavaScript -o "$applet" "$script"
/usr/bin/codesign --force --sign - "$applet"
/usr/bin/codesign --verify --strict "$applet"
# Terminate only the applet process group. VM teardown contains separate task
# groups and synthetic preferences left behind by forced termination.
FPDF_ASSERTIONS_MARKER="$marker" /usr/bin/python3 - "$applet/Contents/MacOS/applet" <<'PYTHON'
import os
import signal
import subprocess
import sys

process = subprocess.Popen([sys.argv[1]], start_new_session=True)
def interrupt(_signum, _frame):
    raise KeyboardInterrupt
signal.signal(signal.SIGTERM, interrupt)
signal.signal(signal.SIGHUP, interrupt)
try:
    result = process.wait(timeout=60)
except (subprocess.TimeoutExpired, KeyboardInterrupt):
    print('Native assertion applet timed out or was interrupted', file=sys.stderr)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()
    sys.exit(1)
if result:
    sys.exit(result if result > 0 else 1)
PYTHON
/usr/bin/grep -Fxq complete "$marker" 2>/dev/null || { echo 'Native assertion applet exited without completing assertions' >&2; exit 1; }
