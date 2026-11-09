#!/bin/bash
# Require the native compiler, GUI bootstrap and an actual AppKit control.
set -eu
for tool in osascript osacompile xcrun clang codesign ditto plutil lipo open launchctl swift; do
  command -v "$tool" >/dev/null || { printf 'Missing native tool: %s\n' "$tool" >&2; exit 1; }
done
[ "$(uname -m)" = arm64 ] || { echo 'Expected arm64 runner' >&2; exit 1; }
launchctl print "gui/$(id -u)" >/dev/null
swift -e 'import AppKit; let app = NSApplication.shared; let button = NSButton(); button.title = "fixture"; precondition(button.title == "fixture"); print("PASS: AppKit application and control")'
echo 'PASS: GUI bootstrap and native tools; LaunchServices exercised by existing background fixture'
