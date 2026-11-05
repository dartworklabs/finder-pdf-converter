# Easy installation for Finder PDF Converter

Status: **Approved — Phase 1 local developer artifact only.** Date: 2026-11-05. Inspected baseline: `58652e2`.
Approval: **repository owner**, 2026-11-05 (Asia/Seoul; exact time of day was not recorded).
Approved original content SHA-256: `0b07f5f6c0fefc8268d0f2138a23e2aa22ea7d70e8e55b9820a06e45854b52ad`.

Conditional user approval: “이건 애플 개발자 인증을 받아야 하냐 아니면 그냥 마음대로 개발 가능한 거냐? 마음대로 가능한거면 권장대로 할게”. The condition is satisfied for local macOS development/testing: paid Apple Developer Program membership is not required. The orchestrator verified Apple's membership and distribution documentation on 2026-11-05. This authorizes recommended alternative A, Phase 1 only; it does not authorize a trusted public release, signing-credential changes, or Apple-account changes.

Verification sources: [Apple Developer Program](https://developer.apple.com/programs/), [About your developer account](https://developer.apple.com/help/account/basics/about-your-developer-account/), [Safely open apps on your Mac](https://support.apple.com/en-us/102445). The original hash version is retained as private evidence outside Git. The original approved version is preserved under the hash above. Dated implementation-status notes below record verification progress without expanding the approved Phase 1 scope.

## Purpose and success

Help ordinary Mac users install/update all three Finder Quick Actions without Terminal, Git, administrator access, or retaining an extracted source folder. Recommend a native installer with one primary Install/Update action.

Success: installed actions and the next update survive removal of the download folder or ejection of its DMG; updates accept new download locations; foreign/modified objects remain untouched; failed replacement is recoverable; English/Korean guidance is native and automatic; installation completion never falsely implies verified conversion or permissions.

## Scope and non-scope

In scope: native installer UI, per-user managed payload, verified legacy migration, recoverable replacement, English/Korean guidance, packaging, and the advanced CLI route.

Out of scope: conversion/print/merge changes, new Finder extensions, automatic updater/daemon, machine-wide installation, automatic permissions, app licensing, global security changes, quarantine removal, and automatic print jobs. Preserve documents, PDFs, and printer preferences. A trusted public release is a separate gated milestone.

## 현재 권위와 상태

No Handbook exists. These files remain current authorities; this draft describes a proposed target.

| role | path | Current authority and state |
| --- | --- | --- |
| purpose / user contract | `README.md`, `README.ko.md` | Three actions; Terminal installation; original source path retention; optional app/permission limits; actual PNG check. |
| installation / ownership | `install.sh` | Physical source root from `pwd -P`; validation, staging, helper generation, then per-file replacement. |
| read-only diagnosis | `doctor.sh` | Source/installed comparison; ownership, source hashes, native inventory/signature checks; optional app presence only. |
| installation verification | `verification/verify-install.py` | Existing install/update/conflict/tamper/link preservation expectations. |
| runtime payload | `PDF로 변환.workflow/Contents/Resources`, `용지에 맞춰 인쇄.workflow`, `PDF 합치기.workflow` | Shared runtime helpers already reside in the installed conversion bundle. |

## 지켜야 할 현재 불변식

| role | path | Invariant |
| --- | --- | --- |
| CLI ownership | `install.sh` | Exact canonical source path identifies CLI ownership: three `Contents/project` links plus two native `finder-pdf-owner` strings. |
| destination integrity | `install.sh`, `verification/verify-install.py` | Preserve foreign items, unexpected links, modified native apps/inventories, and invalid signatures. Names alone prove nothing. |
| diagnosis | `doctor.sh` | Inspection is read-only and launches no apps; distinguish missing/different/invalid execution states. |
| user data / runtime | `README.md`, `README.ko.md`, `install.sh` | Protect inputs/existing PDFs; keep conversion Resources self-contained and present for print/merge; installation proves no app readiness. |

## 설계 이유와 제약

| role | path | Reason / constraint |
| --- | --- | --- |
| ownership | `install.sh` | Source-path ownership blocks unrelated checkouts; managed installation needs an explicit separate mode, not relaxed matching. |
| replacement | `install.sh` | Current preflight/staging does not provide complete transactional rollback. Recovery below is new work. |
| architecture | `README.md`, `install.sh` | Download retention is an installation/update ownership problem; runtime rearchitecture is unnecessary. |
| compatibility | `README.md` | macOS 26.6.2 is tested; it is not an established minimum. |
| signed artifacts | `install.sh` | Absolute owner text is inside generated helper Resources. Changing it after signing invalidates that signature. |

## 충돌·미확인

| role | path | Unconfirmed / required resolution |
| --- | --- | --- |
| legacy provenance | `install.sh`, `doctor.sh` | Missing/unreadable source can prevent verification: preserve installation and report conflict. |
| managed ownership / recovery | proposed installation capability | Manifest identity, recovery journal, and exact supported legacy layouts require the approved implementation plan. |
| public trust | proposed release configuration | This Mac has zero Developer ID Application and zero Developer ID Installer identities; no credentials were read. Immutable helper ownership/receipt design is unresolved. |
| compatibility / UI | `README.md`, this spec | Minimum OS remains unknown. Status update, 2026-11-05: native screens were rendered and shown in English/Korean and light/dark; repository-owner PoC review passed for the frozen `f563f9c…` UI: “현재구성유지” (2026-11-05). |

## Alternatives and recommendation

| Approach | Benefit | Trade-off |
| --- | --- | --- |
| **A. Native installer app in DMG/ZIP — recommended** | One primary action, per-user scope, contextual migration/errors, native English/Korean UI. | Packaging/recovery work; public trust needs separate signing/notarization and clean-Mac proof. |
| B. Standard `.pkg` | Familiar macOS flow and tooling. | Per-user execution identity, permissions, ownership migration, and Developer ID Installer trust add complexity. |
| C. Double-click `.command` | Small wrapper around the existing script. | Terminal and Gatekeeper friction remain; does not meet the ordinary-user goal. |

Adopt A in two phases: an approved local developer artifact first, then a separately approved trusted public release. Do not describe an unsigned local app as a general-public one-click installer.

## Proposed structure and installation flow

One installation capability owns inspection, ownership decisions, staging, commit/recovery, and native presentation. The decision states are fresh, verified managed, verified legacy, conflict, and recovery-required. GUI/CLI callers consume these outcomes through one enforcement point.

The principal is the current logged-in user. Assets are the three Services bundles and `~/Library/Application Support/Finder PDF Converter/`. Untrusted inputs are payload contents, filesystem objects, legacy markers/inventories, and recovery state. Resolve/validate at the boundary and recheck before replacement; never execute an arbitrary legacy source script to establish trust.

Use a stable **real directory**, e.g. `.../Finder PDF Converter/source`, as managed SOURCE. A version-switching symlink is unsuitable because `pwd -P` resolves to changing physical roots. Copy a bounded install payload there; installed runtime helpers stay in conversion Resources. Removing downloads/mounts must affect neither runtime nor subsequent managed updates.

Keep advanced checkout CLI installation supported under its same-source contract. Managed mode is explicit and separate; it does not permit arbitrary checkout installers to adopt another owner.

### Legacy migration and recoverability

Verify the three workflow project links and two native owner markers as one installation, matching a supported layout. With the source present, apply existing read-only root/owner, regular-file, hash, complete native inventory, and signature checks. Missing-source, ambiguous, modified, redirected, or foreign cases stop without writes; never auto-trust names. Preserve the legacy source.

Stage and validate the managed payload and all three workflows before live replacement. Back up the previous managed payload and every existing workflow, including absence states for fresh installation. Maintain bounded durable recovery state; retain backups until resulting ownership/content/signatures verify.

There is no claim of one filesystem-atomic swap across all locations. A failure restores the prior complete set. Failed restoration preserves evidence/backups and reports recovery-required, never success. Reopening after interruption recovers or stops before another update. Cancellation before commit has no effects; during commit it completes or restores instead of abandoning mixed versions.

### Native user experience

Opening performs read-only inspection. Show **Install** for fresh state, **Update** for verified state, or already-current/conflict/recovery results. One primary action installs all three for this user without an administrator prompt. Failures name the next action and whether restoration succeeded; optional technical details stay separate.

Completion distinguishes installed from conversion verified. Give Quick Actions enablement guidance when needed or requested. Offer an explicit PNG check through actual Finder Quick Actions; do not auto-invoke document apps or permission prompts. Optional Hancom/Office checks establish presence only, not startup, licensing, interface language, permissions, or readiness.

Use native English/Korean resources, automatic supported-language selection and English fallback; preserve workflow filenames and current Finder menu localization. Installer text does not change conversion-result language rules. No automatic permission grants, print jobs, or printer preference changes.

### Reference lock and PoC gate

Primary: native Apple AppKit/macOS [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos). Use system typography, semantic colors, Auto Layout, keyboard access, light/dark appearance, and one primary action. No custom marketing hero or rounded container with a one-sided accent.

| Reference | Decision / role |
| --- | --- |
| [Paste](https://pasteapp.io), Refero style `1c0fbb80-f4ca-4c30-8f72-4a8f95a83005` | Secondary: product clarity/system typography only; no brand gradients or web shape tokens. |
| [Sleeve](https://replay.software/sleeve), style `bc95c7d9-4be3-4a8e-a057-48f2545c3734` | Secondary: concise Mac explanation; no marketing composition or brand styling. |
| Limitless screen `163dd12c-5dc1-4f82-b9d3-caec6303b56e` | Numbered installation guidance informs conditional next steps. |
| Limitless screen `9cb5d149-f109-4529-908a-a05028b28457` | Completion checklist with next action; no unverified all-ready checks. |

After spec approval, render before/after at equal zoom, with enlarged details where needed: English/Korean, light/dark desktop, install/update/completion/conflict states. Store durable review images in the project; user PoC review is required before merge/deployment. No prototype code precedes spec approval.

### Local artifact versus public release

Phase one retains local helper generation and current ownership/signature guards. Its unsigned/untrusted developer status is explicit. No quarantine bypass, Gatekeeper weakening, or public release is authorized.

Public release needs a distinct immutable signed-helper ownership/receipt design: prebuilding helpers and rewriting their embedded owner text on the destination Mac is **not** a drop-in solution. Resolve this before consistently signing/notarizing final payloads. Developer ID Application signing and real quarantined clean-Mac download/first-open/Finder checks are prerequisites; `.pkg` additionally has its Installer signing path. Publish nothing until that trust story is verified.

## Gate and verification

Axis 6: **general** installation behavior change. Explicit design approval precedes code/prototype; an approved implementation plan follows. Axes 4/5 require preservation evidence, rendered PoC, and actual Finder operation before merge. Axis 7 retains repository authority; axis 11 preserves explicit CLI and supported legacy contracts.

| Scenario | Evidence required |
| --- | --- |
| Fresh/update/reinstall | All three workflows and managed payload verify; accurate installed/current/update status. |
| New download location; download removed; DMG ejected | Actual PNG works; next managed update succeeds. |
| Legacy source present versus moved/missing | Only proven supported ownership migrates; unverifiable case has no writes. |
| Foreign/tampered/inventory/signature/link conflicts | Preexisting/external objects preserved at every sensitive path level. |
| Missing optional apps | Install can succeed without readiness claims or unsolicited launches. |
| Read-only destination; write failure at each commit step; interruption/cancel | Prior complete set restored or durable recovery-required result; no mixed-version success. |
| English/Korean; light/dark; keyboard | Rendered PoC review plus actual native interaction and readable text. |
| Quarantined clean-Mac public download | Normal macOS trust prompts, signed app/helpers, actual Finder success; no bypass assumptions. |
| Printer preferences / permissions / registration | Read-only printer-preference baseline unchanged; no automatic grants/settings writes or print jobs; observed permission prompts/access recorded through available public APIs/UI. |

Temporary HOME isolates files, **not** CFPreferences, TCC, or `pbs -flush/-update`. Use a registration adapter in isolated filesystem tests; separately validate bounded real registration and Finder under an owned test account or narrowly verified real installation. Compare read-only printer preferences; do not byte-compare protected TCC databases or request Full Disk Access for this check. Record permission behavior observable through public APIs/UI and label unobservable state unknown; macOS may maintain its own records. Trigger actual PNG operation directly. Record observed OS/language; unknown support stays unknown. Keep private preference backups outside public Git; retain only sanitized PoCs/check records in the repository or durable review folder, outside temporary directories.

## Implementation verification status — 2026-11-05

The prior `855444f…` backend baseline with the frozen `f563f9c…` UI completed actual English/Korean inspection and window/keyboard checks, verified legacy migration, a managed update from a new download location, byte-exact restoration of all 37 normal payload files, and actual Finder PNG conversion after download removal and after the final restoration. Final typed printer-state comparisons remained unchanged. Rendered before/after and state-matrix evidence was shown; the repository owner approved keeping the current layout (“현재구성유지”, 2026-11-05). The replacement `716205f…` backend package passed the 37-file manifest, strict ad-hoc signature, stay-open metadata, ZIP and extraction-roundtrip checks. Its actual Korean update with real registration, 37-file identity/ownership/transaction/lock checks, trusted doctor, English current-state reinspection, Finder PNG conversion and final printer-state preservation checks now passed. The current full automated run remains in progress (lock, malformed-input and core checks passed); the prior `855444f…` migration/download-independence operations and 48-case pass remain baseline evidence. Central review/handoff/commit/push/merge remain pending. See [the integration check](../../review/easy-installer/integration-check.md) for scope and evidence boundaries. Signing/notarization and quarantined clean-Mac distribution are a separate public-release milestone, not an unfinished Phase 1 local-development gate.

## Open decisions and approval

Recommend A, local developer artifact first. Material outstanding decisions: public certificate/account availability, immutable signed-helper ownership, and minimum OS after measurement. DMG versus ZIP follows real first-open evidence without changing installation scope.

Record explicit approval with approver, time, and exact content hash before implementation. Ownership relaxation, machine-wide scope, automatic permissions, and public trust claims require revised design approval.
