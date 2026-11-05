# Management app and static menu: review and verification

On 2026-11-05 the owner reviewed the actual before/after rendering and static
glyph and chose “현재 구성 유지”. See the [before/after image](before-after-ko.png)
and [glyph image](static-glyph-native.png). This records the visual decision;
other checks remain separate.

The [native appearance matrix](native-appearances.png) shows compiled inert
preview windows in English and Korean, each in light and dark mode. All four
were visually reviewed for clipping and overlap, and their owned processes
exited normally. Preview mode has no backend, preference, or login-service
access; these images are evidence of rendering, not installation or conversion.

## Actual manager and login-service checks

The retained, locally built app was exercised through its native controls. The
login choice registered successfully and macOS reported it enabled. Its owned
short-lived helper ran and exited without opening a duplicate manager. With the
menu enabled, closing the window retained the app; reopening it showed the
window and refreshed inspection. A separate compiled-app regression verified
that reopening kept the same process. Quit completed normally.

An owned login-helper launch with the menu enabled started the manager in the
background without an inspection task. Manual opening then showed the window.
With the menu disabled, another owned helper launch exited without leaving a
manager process. The English interface was also opened. Unregistering through
the UI returned the service to the disabled state without terminating the
manager. Final cleanup left no owned manager process and restored the menu
preference to its initial empty state.

The exercise exposed three native integration defects that were fixed and
covered by regression checks:

- The Objective-C bridge returned the service status as a string. The app now
  accepts only the canonical status values and distinguishes an unreadable
  status from a service that has not been set up.
- The native checkbox's first click entered its mixed state. Registration and
  unregistration now follow the confirmed service state, including approval
  pending, rather than that transient checkbox value.
- Replacing the applet delegate interrupted its Apple Event handling. The
  controller now forwards unhandled events to the retained applet delegate,
  while keeping the existing window and termination guards.

## Finder checks

With the manager absent and menu off, actual Finder Quick Actions converted two
PNG files to PDFs, merged two PDF pages, and printed two A4 pages to a local
loopback IPP capture. No physical printer was used. The resulting owned
sessions were closed normally and removed. The four inspected printing
preference domains, printer options, queues, and default printer matched their
pre-test state, including the two recent records checked.

## Local verification

The final source passed the model, dependency-boundary, package, and focused
native checks, TypeScript checking, Biome lint for the six configured files,
and shell syntax checks for each touched script. The frozen 37-file payload
matched its baseline, and an independent source review passed. These are local
checks; this repository has no configured CI gate for them. The actual manager
and Finder checks above were performed separately.

## Limits

These checks do not establish an Intel runtime result, a minimum supported macOS
version, actual logout/login-cycle behavior, or an actual user denial of login
approval. The helper was built for both arm64 and x86_64; execution was tested
on the current Mac architecture. Commit, push, and merge are separate from
these verification results. The app is a
local ad-hoc signed build, not an Apple-notarized public release. No logout,
restart, or physical print was performed.
