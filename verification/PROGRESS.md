# Progress, cancellation and failed-only retry verification

Recorded on 2026-11-05 with macOS 26.6.2 (25G83), Python 3.9.6 and Node.js 26.5.0. This record distinguishes actual Finder/native-window checks from automated fixtures. No physical print job was submitted.

## Automated checks

Run from the repository folder on macOS with Python 3 and Node.js:

```sh
bash verification/verify-progress.sh
python3 verification/verify-refresh-messages.py
python3 verification/verify-session-lifecycle.py
node verification/verify-progress-ui.js
python3 verification/verify-preparation-entry.py
python3 verification/verify-print-host-entry.py
python3 verification/verify-print-panel.py
python3 verification/verify-print-capture.py
python3 verification/verify-report.py
python3 verification/verify-install.py
python3 verification/verify-doctor.py
bash verification/verify-print-fit-batch.sh
```

The checks above passed. The native-host follow-up reran install, doctor, preparation entry, print-host entry, and headless print/merge checks sequentially; the focused launch-gap signal regression also passed after its fix. The last command needs a default printer for proof rendering; it submits no job. These are manual verification commands, not CI merge gates.

| Check | What runs for real | Fixture boundary |
| --- | --- | --- |
| Progress | Converter, status, PDF validation, refresh | Owned export adapter; no Office app |
| Refresh guidance | Absolute helper errors, English/Korean missing/access-denied messages, snapshot preservation, spoof rejection | Disposable file permissions/missing source |
| Session lifecycle | Supervisor and attempt-bound commands | Converter/monitor processes |
| Progress UI | Parser and controller decisions | Native controls/file adapters |
| Preparation entry | Snapshots, refresh map, outcomes | Session/review/renderer adapters |
| Result transport | UTF-8 decoding, large summaries, Finder entry | Alerts/session adapter |
| Install/doctor | Review/print app compilation/signatures, independent inventories, upgrade/ownership guards, read-only comparisons | Disposable homes |
| Print host entry | Reviewed selection/snapshots, closed completion/cancellation/error results, fail-closed malformed/missing outcomes, signal lifetime and cleanup | Owned launch adapters; legacy renderer rejects all calls |
| Print host protocol | Private-directory/path and manifest validation, atomic result serialization, operation outcome forwarding | Harmless renderer stub; no native panel |
| Print/merge batch | Conversion, native PDF rendering, selection, exclusive save | No interactive windows |
| Capture harness | English/Korean exact-queue identity parsing and generated PDF fixture structure | No queue creation or printing |

Acknowledged file failures/cancellation close without a second Finder error; setup alerts and headless failure codes remain. Preparation failures cannot advance to review.

Assertions cover active-file cancellation, failed-only refresh, stale commands, child failures/disappearance, session/parent termination, late cancellation, invalid status and cleanup. Progress accepts 1,001 items; review retains its separate 1,000-input limit.

Disposable mutations were rejected for bypassing preparation, dropping Finder paths, overwriting late cancel, restoring the progress count cap, stopping error-state polling, removing final cancellation checks, or removing parent-to-session termination forwarding.

The dedicated native print host follow-up passed isolated install and doctor checks,
including the review-only upgrade and refusal of modified, foreign, extra-file,
and linked print apps. Entry tests passed completed/cancelled/error results and
rejected missing, linked, duplicate-key, unknown-field, oversized and generated
malformed results. TERM in the launch/PID-registration gap was deferred until that PID was
recorded; TERM and a subsequent HUP waited for the owned app lifetime before
removing snapshots; no outcome invoked the old renderer a second time. The new entry test
failed against the previous unbundled entry on its completed-native-outcome
assertion. Removing signal deferral reproduced premature snapshot cleanup in
the widened launch gap; bypassing the print-app update guard, skipping its
diagnostics, and treating `error` as success also failed their assertions.
These checks use dummy launch adapters and do not establish native
print-panel behavior.

## Actual Finder checks

Repeat through Finder's context menu in English and Korean, using disposable files. For conversion, use two UTF-8 TXT files and an unterminated quoted CSV field, then repair the CSV. For merge, pair an invalid PDF placeholder with a labelled three-page PDF; repair the placeholder to a one-page PDF. Save edits before retrying.

| Journey | Observed result |
| --- | --- |
| Convert: two valid TXT files and one malformed CSV; repair the CSV, then Retry Failed | Passed in both languages: attempt 2 had only the failure (`total: 1`); successful PDFs retained SHA-256 hashes and modification times. |
| Convert: 100 TXT files; press Cancel while running | Passed: Korean 25 completed/75 cancelled; English 16/84. PDF counts matched completions with no later output. Counts depend on click timing. |
| Merge: invalid PDF plus a valid three-page PDF; repair the invalid original without replacing its file identity, then retry | Both passed four-page review. Korean: successful snapshot hash/mtime unchanged; pages `3,1` plus Move Up saved the expected three-page order. English: all four expected pages saved. |
| Selected original renamed and recreated before retry | Latest Korean check passed: retry automatically opened one repaired page before activation, then review Cancel closed cleanly. Earlier English replacement access was denied (`Operation not permitted`) without review/output; fresh Finder selection recovered. This macOS restriction is conditional; permissions stayed unchanged. |
| Close a preparation failure result with Done | Passed in Finder: the action closed without review, saving, or a second generic Finder error. |
| Print to Fit: actual Finder review → dedicated native panel → Cancel | Passed in English and Korean. The native Cancel button closed the print app and action, removed private snapshots, added no capture job, and showed no Finder error. |
| Print to Fit: actual Finder review → dedicated native panel → Print | Passed in English and Korean with one copy on A4, selecting only the owned virtual capture printer. Korean captured 3 pages in accepted order `Order2, Edge3, Edge1`; English captured 5 pages in accepted order `Order2, Edge4, Edge2, Edge3, Edge1`. Exactly two PDF jobs reached the loopback capture server. The print apps exited and their action workspaces were removed. |
| Print to Fit: terminate the parent while the actual native panel remains open, then Cancel | Passed: the private workspace and snapshots remained available after parent TERM. Native Cancel then closed the app and parent and removed the workspace; the captured-job count stayed at two. Deliberately terminating the parent produced the expected Automator failure alert; ordinary Cancel did not. |
| Timer-driven preparation window exit without input | English and Korean Finder: progress exited and review appeared before activation/input. The native AppKit fixture also exited within three seconds without input. |
| Native Finder conversion: terminate only its owned session during 100 TXT inputs | Passed: active file finished, 21 PDFs remained, and session workspace/monitor disappeared within the eight-second observation bound (about one second). No owned helper processes remained. |

For the Korean selected-page merge check, source pages carried distinct text. Extracted output order was `PREPARE GOOD PAGE3`, `PREPARE GOOD PAGE1`, `REPAIRED SOURCE PDF`.

To repeat the preservation check, record the successful PDF or private snapshot before retry and compare afterward:

```sh
shasum -a 256 success.pdf
stat -f '%m' success.pdf
```

Reconcile cancellation counts with saved PDFs and confirm no later output. Preparation cancellation/failure must open no review/print panel and save no merge. Existing adjacent PDFs must stay unchanged.

## Dedicated native print panel and captured output

The 2026-11-05 follow-up used the production Finder Quick Action, review app,
print app, native printer selector, A4 paper setting, copies control, and native
Print/Cancel buttons in both English and Korean. Two selected synthetic PDFs
contained unique page labels and four colored corner marks per page. Review
changed document order and page ranges before opening the native panel.

Cancel submitted no job in either language. Print submitted exactly two jobs to
an unshared, loopback-only virtual IPP printer: one Korean 3-page PDF and one
English 5-page PDF. No physical printer received a job. This exercises actual
native submission and the received spool PDFs, beyond a headless proof. After
the native interruption test, owned queue/server cleanup finished with no
cleanup errors and matched the harness-startup default destination and queue
list. This comparison covers the supervised capture phase.

The offline verifier read those captured PDFs and compared them with the source
fixtures. All 32 corner marks (12 Korean, 20 English) were present in the raster
and within the independently measured printable bounds. The 200 × 300 pt page
remained at scale 1; the 1100 × 1500 pt page shrank to approximately 0.523636;
the 842 × 595 pt landscape page rotated 90° and fit at approximately 0.957115.
Page labels, count and order matched the accepted review selections. A separate
read-only `NSPrintInfo` query supplied the selected virtual printer's A4
imageable bounds; the verifier did not obtain those bounds from the production
fit calculation. These measurements establish the tested virtual driver's
output, not paper feed or other printers' margins.

### Repeat with the owned capture harness

The capture harness requires Python 3.9+ and macOS's built-in CUPS/IPP tools.
It uses only Python's standard library. Product installation and normal use need
neither Python nor PyMuPDF. The offline PDF verifier additionally needs PyMuPDF
(`import pymupdf`) in the test environment.

Run the supervisor in a terminal with a new absolute state-file path in a QA
folder that will retain your evidence:

```sh
python3 verification/print-capture.py serve --state "/absolute/qa/capture-state.json" --seconds 1800
```

Wait for `phase: ready`. The printed JSON identifies the exact virtual printer
`title`, its generated `fixture` and `order_fixture`, and its `spool` folder.
Select those two fixture PDFs in Finder. In review, move the order document
first and include page 2; for the edge document, select `3,1` for the Korean
case or `4,2,3,1` for the English case. Open Print Settings, select only the
printed virtual-printer title, choose A4 and one copy, then test Cancel and
Print separately. Check that Cancel adds no spool file and Print adds exactly
one PDF. Use a fresh Finder invocation for each case.

Read status or finish cleanup from another terminal:

```sh
python3 verification/print-capture.py status --state "/absolute/qa/capture-state.json"
python3 verification/print-capture.py cleanup --state "/absolute/qa/capture-state.json"
```

The supervisor also cleans up on its deadline or terminal interruption. Cleanup
checks the exact owned queue URI before removing it, stops its own server, and
compares the final queue list, default printer and user print options with the
initial snapshot. Require `phase: stopped` with no cleanup errors; inspect the
state file if cleanup fails. Capture PDFs and fixture evidence remain in the QA
folder. No default printer or existing queue is intentionally changed.

Verify a captured Korean spool PDF offline, substituting its actual path and
the two generated fixture paths:

```sh
python3 verification/verify-captured-print.py "/absolute/qa/captured.pdf" "/absolute/qa/Order test.pdf" "/absolute/qa/Edge test.pdf" --expected-labels Order2,Edge3,Edge1
```

For English, use `--expected-labels Order2,Edge4,Edge2,Edge3,Edge1`. Without
`--imageable`, the verifier checks order, uniform shrink-only fit, centering and
visible corner marks against page bounds; it does not claim exact driver
margins. To reproduce the exact printable-area check, also provide
`--imageable X Y WIDTH HEIGHT` using independent A4 `NSPrintInfo` bounds in
points, with a top-left origin. Its JSON reports
`exact_imageable_fit_checked: true` only when those bounds were supplied. The
separate query for the recorded virtual A4 test returned
`9.637795448303223 18 576 805.8897705078125`; those are the bounds used for the
recorded captures, rather than a universal printer margin.

## Limits

The failed-source refresh copy has a 10-second timeout; this is not a timeout for document conversion. Replacement files may require fresh Finder selection because macOS access belongs to the selected file.

Physical paper output, other printer drivers, every Office/Hancom permission path and other macOS versions remain unverified. Native Print and Cancel, accepted page order, and captured virtual-printer output passed in English and Korean. Actual parent termination while the native panel remained open preserved snapshots until native Cancel closed the operation; the automated launch-gap and repeated-signal checks also passed.
