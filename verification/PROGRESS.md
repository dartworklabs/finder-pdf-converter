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
python3 verification/verify-report.py
python3 verification/verify-install.py
python3 verification/verify-doctor.py
bash verification/verify-print-fit-batch.sh
```

The eight final checks passed sequentially; the added ninth refresh-guidance check also passed. The last command needs a default printer for proof rendering; it submits no job.

| Check | What runs for real | Fixture boundary |
| --- | --- | --- |
| Progress | Converter, status, PDF validation, refresh | Owned export adapter; no Office app |
| Refresh guidance | Absolute helper errors, English/Korean missing/access-denied messages, snapshot preservation, spoof rejection | Disposable file permissions/missing source |
| Session lifecycle | Supervisor and attempt-bound commands | Converter/monitor processes |
| Progress UI | Parser and controller decisions | Native controls/file adapters |
| Preparation entry | Snapshots, refresh map, outcomes | Session/review/renderer adapters |
| Result transport | UTF-8 decoding, large summaries, Finder entry | Alerts/session adapter |
| Install/doctor | Compilation/signature, inventories, comparisons | Disposable homes |
| Print/merge batch | Conversion, native PDF rendering, selection, exclusive save | No interactive windows |

Acknowledged file failures/cancellation close without a second Finder error; setup alerts and headless failure codes remain. Preparation failures cannot advance to review.

Assertions cover active-file cancellation, failed-only refresh, stale commands, child failures/disappearance, session/parent termination, late cancellation, invalid status and cleanup. Progress accepts 1,001 items; review retains its separate 1,000-input limit.

Disposable mutations were rejected for bypassing preparation, dropping Finder paths, overwriting late cancel, restoring the progress count cap, stopping error-state polling, removing final cancellation checks, or removing parent-to-session termination forwarding.

## Actual Finder checks

Repeat through Finder's context menu in English and Korean, using disposable files. For conversion, use two UTF-8 TXT files and an unterminated quoted CSV field, then repair the CSV. For merge, pair an invalid PDF placeholder with a labelled three-page PDF; repair the placeholder to a one-page PDF. Save edits before retrying.

| Journey | Observed result |
| --- | --- |
| Convert: two valid TXT files and one malformed CSV; repair the CSV, then Retry Failed | Passed in both languages: attempt 2 had only the failure (`total: 1`); successful PDFs retained SHA-256 hashes and modification times. |
| Convert: 100 TXT files; press Cancel while running | Passed: Korean 25 completed/75 cancelled; English 16/84. PDF counts matched completions with no later output. Counts depend on click timing. |
| Merge: invalid PDF plus a valid three-page PDF; repair the invalid original without replacing its file identity, then retry | Both passed four-page review. Korean: successful snapshot hash/mtime unchanged; pages `3,1` plus Move Up saved the expected three-page order. English: all four expected pages saved. |
| Selected original renamed and recreated before retry | Latest Korean check passed: retry automatically opened one repaired page before activation, then review Cancel closed cleanly. Earlier English replacement access was denied (`Operation not permitted`) without review/output; fresh Finder selection recovered. This macOS restriction is conditional; permissions stayed unchanged. |
| Close a preparation failure result with Done | Passed in Finder: the action closed without review, saving, or a second generic Finder error. |
| Print to Fit review and Print Settings handoff | Passed in both languages before UI activation. English: freshly selected repaired PDF, one-page review. Korean: three-page PDF, range `2`; accepted JSON contained input index `0`, pages `[2]`. Each reached the production print process. Panel controls/Cancel were **not run**: the UI tool cannot address the unbundled `osascript` panel. Owned QA processes stopped; no jobs submitted. |
| Timer-driven preparation window exit without input | English and Korean Finder: progress exited and review appeared before activation/input. The native AppKit fixture also exited within three seconds without input. |
| Native Finder conversion: terminate only its owned session during 100 TXT inputs | Passed: active file finished, 21 PDFs remained, and session workspace/monitor disappeared within the eight-second observation bound (about one second). No owned helper processes remained. |

For the Korean selected-page merge check, source pages carried distinct text. Extracted output order was `PREPARE GOOD PAGE3`, `PREPARE GOOD PAGE1`, `REPAIRED SOURCE PDF`.

To repeat the preservation check, record the successful PDF or private snapshot before retry and compare afterward:

```sh
shasum -a 256 success.pdf
stat -f '%m' success.pdf
```

Reconcile cancellation counts with saved PDFs and confirm no later output. Preparation cancellation/failure must open no review/print panel and save no merge. Existing adjacent PDFs must stay unchanged.

## Limits

The failed-source refresh copy has a 10-second timeout; this is not a timeout for document conversion. Replacement files may require fresh Finder selection because macOS access belongs to the selected file.

Physical printing, native panel controls/Cancel, every Office/Hancom permission path and other macOS versions remain unverified. The available UI tool cannot inspect this native panel; confirmed process handoff does not establish panel behavior.
