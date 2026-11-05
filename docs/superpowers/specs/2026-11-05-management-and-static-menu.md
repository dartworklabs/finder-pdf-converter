# Management window and optional static menu

**Approved.** The repository owner approved the exact original draft on 2026-11-05 Asia/Seoul with “고”, after accepting **manager first, optional menu afterward; Finder remains usable with it off; the icon stays static, never spinning.** The original snapshot SHA-256 is `a4643869abb7b8701ffe98eb3dc13be72619c9d6da01998054051e6ff18d1fb4`, retained with the approval record in the private sibling `../easy-installer-qa/manager-qa/`. Baseline `2425cc4` matched remote `main` when inspected. Uses the `arch-design(spec)` fallback; `superpowers:brainstorming` is unavailable. The owner separately reviewed the rendered PoC and chose “현재 구성 유지” on 2026-11-05.

## Purpose, scope, and success

Provide on-demand installation management, then an optional static document-glyph menu. Priority: (1) verify shutdown and actual icon ownership; (2) retained management window; (3) independent menu and login-launch choices, both off by default.

Success: closing a task/result leaves zero owned process/session leftovers; maintenance status stays truthful; all three Finder actions work without a manager/menu process. The custom glyph never rotates, pulses, blinks, or animates, including while busy. Progress uses text or a window.

Excluded: conversion/result changes, updater/polling service, automatic permissions, printer changes, machine-wide installation, public release, and Handbook creation. No global monitor termination, system patching, or premature workflow exit.

## 현재 권위와 상태

No Handbook index or legacy Typst Handbook was found in the narrow inventory. Initialization is optional separate work. These five files remain current authorities; this draft describes a target.

| role | path | Current authority |
| --- | --- | --- |
| purpose / user contract | `README.md` | Three Finder actions, result/retry behavior, optional-app limits. |
| installation policy | `docs/superpowers/specs/2026-11-05-easy-installation.md` | Approved local developer scope; public distribution remains separate. |
| public maintenance boundary | `installer/managed-install.sh` | `inspect`, `install`, `recover`; per-user ownership, conflicts, locking, recovery. |
| conversion ownership | `conversion-session.sh` | Waits for conversion, result actions, and monitor exit. |
| review / print ownership | `print-fit.sh` | Waits for consumers before removing private snapshots. |

## 지켜야 할 현재 불변식

| role / path | Invariant |
| --- | --- |
| user effects / `README.md` | Preserve originals, existing PDFs, approved selections, printer preferences, cancellation, failed-only retry. |
| maintenance / `installer/managed-install.sh` | Verify current-user ownership; preserve foreign/ambiguous objects; retain recovery enforcement. |
| lifecycle / `conversion-session.sh`, `print-fit.sh` | Private files outlive all consumers; closing a launcher cannot abandon or silently cancel an effect. |
| readiness / approved installation spec above | Presence is not licensing, permission, or conversion readiness; local packaging is not public trust. |

## 설계 이유와 제약

- **role / path: lifecycle / `conversion-session.sh`.** Completed results intentionally remain open for Done/Retry. Prior QA missed its own cleanup; this is not evidence of a source lifecycle defect.
- **role / path: maintenance / `installer/managed-install.sh`.** Reuse public operations rather than private engine functions or duplicated ownership rules.
- **role / path: runtime / `print-fit.sh`.** Any asynchronous handoff needs explicit ownership and cancellation before decoupling.

Private QA evidence confirms three complete results, no active converter, and normal close/owner-shutdown requests with no signals: all nine related processes and three sessions disappeared; all three output PDFs remain. This closes those stale QA sessions only.

## 충돌·미확인

The user confirmed the old spinning icon disappeared after three normal result closures and cleanup. Its actual OS owner remains unverified: ScriptMonitor existed, but windowless accessibility timed out. At that time the source had no product status item. The new static icon cannot be assumed to replace Apple's execution gear. The implementation plan records the manager location and update-payload source and retains synchronous ownership. Actual registration, unregistration and owned helper launches were exercised; a real logout/login cycle and minimum supported OS remain unverified.

## Alternatives and proposed design

**Recommend staged delivery:** lifecycle evidence → manager → opt-in menu. Menu first is smaller initially but may merely add a second icon. Keeping only installer/Finder minimizes runtime scope but omits retained management.

The manager displays public `inspect` outcomes and invokes `install`/`recover` only on explicit action. Reopening refreshes read-only inspection. Show current/update, busy, conflict, recovery-required, or unavailable accurately. Optional apps are present/absent/unknown; verified conversion requires a separate real check. No unsolicited document-app launch.

The menu is a thin manager entry with a static document glyph. Menu visibility and login launch are separate, off-by-default preferences. Neither owns conversion or installation truth. Disabling the menu never terminates a task; Finder remains independent.

Preserve synchronous ownership unless a verified replacement defines worker, result/retry UI, cancellation, outcome, and file ownership through startup failure, interruption, repeated invocation, and manager closure. Acknowledgement must precede release by the prior owner. Installation must exclude active resource use or report busy; naive detach-and-exit is prohibited.

The principal remains the logged-in user. Existing boundaries parse payload/filesystem and reply data; UI paths grant no ownership. Failed inspection is unavailable, never healthy. Busy prevents duplicate effects; replacement errors distinguish restored from recovery-required. Menu/login failure leaves Finder usable. No new external dependency, credential access, or permission is proposed.

## Axis 6 and bounded spike

**General** product behavior. The stale icon disappeared after the three normal result closures as confirmed by the user; its precise owner remains unproved. Do not recreate those old jobs. Any further targeted observation must preserve unrelated sessions and settings and send no global signals.

The bounded lifecycle design retains synchronous ownership; a new handoff requires separate design and evidence. Record any targeted prototype scope, teardown, and observations, including unresolved or unsupported results.

## Future validation and PoC gate

- Measure owned counts before/after finish, cancel, retry, and result-close: final process/session delta exactly zero; unrelated processes and output PDFs preserved.
- Exercise partial launch, interruption, repeated invocation, and repeated cleanup: no abandoned effect or premature deletion.
- Compare manager display with real public outcomes; retain installation/conflict/recovery gates and truthful app-readiness limits.
- Exercise independent menu/login combinations and actual Finder conversion, merge, and print-to-file without physical printing.
- Render English/Korean, light/dark, idle/busy/success/failure states. Verify the glyph stays static; observe Apple's gear separately.

Exact commands and CI placement belong in the approved plan. The owner reviewed the actual before/after render and static glyph and chose “현재 구성 유지” on 2026-11-05; see [before/after](../../review/management-static-menu/before-after-ko.png) and [glyph](../../review/management-static-menu/static-glyph-native.png). The [appearance matrix](../../review/management-static-menu/native-appearances.png) shows the four visually reviewed inert English/Korean light/dark previews; it does not demonstrate installation or conversion. Actual Finder and manager results are recorded separately in the [verification record](../../review/management-static-menu/README.md). Final package review and repository handoff remain. Preserve native references; no rounded container with a one-sided accent.

## Open decisions and approval

The implementation plan freezes routine choices for manager location, update source, synchronous ownership, preference/login behavior, and Quit. Actual registration, unregistration and owned helper launches passed on the current Mac; actual logout/login-cycle behavior and the old OS icon ownership remain unverified. See the [verification record](../../review/management-static-menu/README.md).

**Approval recorded:** repository owner, 2026-11-05 Asia/Seoul, “고”; original approved snapshot SHA-256 is recorded above.
