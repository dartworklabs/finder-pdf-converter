# Easy installation implementation plan

Goal: build the approved native, per-user installer as a local developer artifact, preserving all existing ownership/data safeguards.
Spec: `docs/superpowers/specs/2026-11-05-easy-installation.md`.
Approval: repository owner, 2026-11-05 Asia/Seoul; conditional approval and verified Apple sources are recorded in the spec header. Original approved-content SHA-256: `0b07f5f6c0fefc8268d0f2138a23e2aa22ea7d70e8e55b9820a06e45854b52ad`.
Execution: design → this plan → delegated implementation → central integration/review. No implementation preceded approval. No commit or push is made by the planning worker. Checkboxes are updated only after evidence exists.

The next four sections reproduce the inspected baseline authority record from the approved spec; proposed target behavior remains unimplemented until its task passes. No Handbook exists; no Handbook initialization is included.

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
| compatibility / UI | `README.md`, this spec | Minimum OS remains unknown. Status update, 2026-11-05: English/Korean light/dark native screens were rendered and shown; repository-owner PoC review passed for the frozen `f563f9c…` UI: “현재 구성 유지” (2026-11-05). |

## Ownership, boundary, and execution contract

- New capability: `installer/`, with `managed-install.sh` as the declared public CLI (`inspect`, `install`, `recover`), `model.js` for pure outcome parsing/presentation decisions, `ui.js` for native AppKit, `build-installer.sh` for developer packaging, and colocated `installer/tests/`.
- GUI calls only the backend public CLI via asynchronous `NSTask`; it does not import filesystem/ownership internals. `doctor.sh --source-root PATH` is a trusted read-only boundary if needed, never an old checkout's executable script. Backend may use an explicit staging surface in `install.sh`; ordinary no-argument CLI semantics remain same-source and cannot adopt a foreign checkout.
- Principal is the actual current user; allow only this user's three Services bundles and managed support directory. Use a real stable `$HOME/Library/Application Support/Finder PDF Converter/source`, never a version-switching symlink. Validate every parent and member; copy only an explicit bounded regular-file/directory payload, rejecting unexpected links, hardlinks, devices, ambiguous names, and excessive inputs.
- Legacy proof requires all three `Contents/project` readlink texts to exactly equal one supported canonical physical source root, plus both native owner texts, source hashes, regular files, complete native inventories, and signatures. A successful doctor result alone does not prove those links. Missing/moved/unreadable source or modified/extra workflow members means conflict, without writes. Preserve the old source.
- Stage source plus all three complete workflows before commit, generating helpers with the final stable owner identity. One actual-user lock covers managed/CLI mutation; old CLI/external writers remain possible, so revalidate object identity/content immediately before commit and rollback. Never replace a concurrently changed object.
- Journal each of the four target existence/absence states, backup and staged identity, and rename intent/completion durably. On crash, inspect/recover or stop before another install. Verify the complete result before dropping backups. On failure restore the prior complete set; if external changes or restoration failure prevent this, retain evidence/backups and return recovery-required. This is recoverable multi-location replacement, not one filesystem-atomic swap.
- Before commit cancellation leaves live state untouched; after commit begins finish or restore. Registration uses an owned adapter; filesystem tests must not call real `pbs`, including through legacy CLI tests. Temporary HOME does not isolate CFPreferences/TCC/registration. No Python or newly installed runtime package is required by delivered code; macOS Bash/JXA/system tools only.
- Build outputs, private preferences, original approval snapshot, and detailed logs go to the durable sibling `work/easy-installer-qa/` outside Git; sanitized review images/check records may enter `docs/review/easy-installer/`. Nothing goes to datasets or retained `/tmp` paths.

## Version 1 public backend result

Command: `bash installer/managed-install.sh inspect|install|recover --source-root <validated-payload-root>`. GUI derives this read-only root from its own bundle, never a user-selected arbitrary backend. No shell string interpolation; pass argument arrays.
Stdout is exactly one bounded UTF-8 JSON object: `{"schemaVersion":1,"operation":"inspect","outcome":{"kind":"fresh","apps":{"hwp":false,"word":false,"powerpoint":false,"excel":false}}}`; stderr is diagnostic only. No private absolute paths, exception stacks, or localized machine codes.
The envelope has exactly `schemaVersion`, `operation`, `outcome`; operation is exactly the invoked `inspect`, `install`, or `recover`. Outcome variants have these exact fields (no unknown fields or null):

| Operation / kind | Exact outcome fields |
| --- | --- |
| inspect: `fresh`, `current`, `update`, `legacy` | `kind`, `apps: {hwp, word, powerpoint, excel}`; all four values boolean, presence only |
| any: `conflict`, `recovery-required` | `kind`, `code` |
| install/recover: `installed`, `recovered`, `busy` | `kind` |
| install/recover: `registration-required` | `kind` |
| install/recover: `restored` | `kind`, `code` |
| any: `invalid-request`, `failed` | `kind`, `code` |

Closed codes: `invalid-payload`, `unsafe-path`, `foreign-item`, `modified-item`, `legacy-source-unavailable`, `owner-mismatch`, `recovery-conflict`, `write-failed`, `operation-failed`, `interrupted`. Worker A/B can jointly extend only with coordinated schema/consumer/fixture edits. Stable codes and app presence are machine data; locale changes UI text only.
Exit 0 means successful inspection/action (`fresh/current/update/legacy/installed/recovered`); exit 1 means a refused or failed action/inspection (`conflict/recovery-required/restored/busy/failed/registration-required`); exit 2 means `invalid-request`. `registration-required` means the verified filesystem set was committed, but Finder registration failed or remains unconfirmed; it is valid for install or recovery only and must not be displayed as an unchanged installation or verified Finder readiness. GUI parses on every exit path and rejects malformed/unknown versions/variants/fields, impossible operation/kind pairs, or contradictory exit/outcome combinations. Missing/truncated JSON is failure, never success. `installed` is install-only; `recovered` is recover-only; `busy` is mutating-operation-only. Before parallel edits A/B confirm this frozen contract.

## Task 1 — Freeze contracts and failing preservation tests (Worker A; coordinate B)

Files: `installer/README.md`, `installer/tests/verify-managed-install.sh`, optional test fixture driver beside it; existing `verification/verify-install.py`, `verification/verify-doctor.py` only where registration isolation is needed.
- [ ] Step 1: inventory `install.sh`/`doctor.sh` and payload paths; document explicit command/result/exit schemas, entry-point policies and bounded payload inventory. Run `bash installer/tests/verify-managed-install.sh contract` before implementation. Expected: missing backend/schema behavior fails on a stated assertion; no live user registration runs.
- [ ] Step 2: add fixtures for fresh/current/update/new-download/legacy, all owner/inventory/signature/link conflicts, unknown extra members, read-only paths, malformed journal, and escaped/oversized payloads. Include seeded generated path/parser/state sequences. Run the same command. Expected: unsafe/missing behavior fails; fixture snapshots prove no unauthorized writes.
- [ ] Step 3: record the red run outside Git and publish the frozen schema to B/root. Expected: both consumers agree on every variant and exit code, and all public entry points declare current-user enforcement or read-only policy.
Historical evidence limit: retained records do not establish the initial missing-backend red-run procedure or its original artifact. The three Task 1 procedure checkboxes above remain unticked for that reason; they do not mean the current inventory/schema/fixtures are absent. Current schema, fixture and implementation behavior passed the full `all` superset and guard mutations. No historical retained-run claim is made. This process-evidence gap is distinct from the current functional/local Phase 1 acceptance gates, which passed.

Commit point: backend contract plus behavioral tests, after central review; no commit by the planning worker.

## Task 2 — Implement verified managed installation and recovery (Worker A)

Files: `installer/managed-install.sh`, capability-local supporting Bash/JXA files and tests; guarded `install.sh` staging/lock/registration wiring and trusted read-only `doctor.sh --source-root` only as required.
- [x] Step 1: implement read-only inspect and strict parsing, explicit payload staging/final owner identity, preserving old CLI ownership guards. Run `bash installer/tests/verify-managed-install.sh inspect`. Expected: every state accurately classified; old-source scripts never execute; snapshots unchanged. Evidence: the current official `all` run passed this inspection/contract coverage as a superset; no separately retained standalone `inspect` execution is claimed.
- [x] Step 2: implement shared actual-user lock, rechecks, durable journal, source plus three-workflow commit/rollback/recover. Run `FINDER_PDF_CONTRACT_JOBS=2 bash installer/tests/verify-managed-install.sh all`. Expected: inject failure/crash around every target rename, both absent/present states, cancellation and restoration failure; either prior complete set restores or recovery-required retains backups. Concurrent external changes survive recovery. The opt-in two-lane test driver preserves all 48 native cases (24 disjoint cases per independent HOME), the serial core/tail, shared-payload preservation and each 120-second operation limit. Native compilation/signatures and real commit/recovery make this a slow local integration gate; both workers join before fixture cleanup on success or failure. Current `716205f…` evidence: full exit 0, exact 48 unique cases in two disjoint 24-case ledgers, serial core/tail passed, seven input hashes unchanged and execution fixture removed.
- [x] Step 3: run `python3 verification/verify-install.py` and `python3 verification/verify-doctor.py` with registration adapter wired in the test harness, plus `bash -n install.sh doctor.sh installer/managed-install.sh`. Expected: existing same-root reinstall/update and foreign-source refusal pass; no real `pbs`/preferences/TCC effects occur in isolated tests.
- [x] Step 4: use plausible mutations to prove preservation, owner comparison, rollback state, and malformed-result assertions fail; restore source after each mutation using one reusable fixture. Expected: tests reject each mutation and final all run passes; detailed evidence saved outside Git. Evidence: the current official `all` run and six current guard mutants passed; each mutation failed at its intended assertion/frame, all 37 source snapshots restored and execution fixture removed.
Commit point: managed engine and necessary compatibility wiring, after central review.

## Task 3 — Native responsive UI and local package (Worker B; after API freeze)

Files: `installer/model.js`, `installer/ui.js`, `installer/build-installer.sh`, `installer/tests/verify-model.js`, `installer/tests/verify-boundaries.js`, `installer/README.md` UI/build portions only.
- [x] Step 1: write model/parser tests against frozen fixtures, including all states, unknown schema/fields, malformed output, nonzero errors and localization. Run `node installer/tests/verify-model.js`. Expected: missing model fails on behavior, then correct parser maps every supported result and rejects invalid combinations. Test seeded generated values and a plausible omitted refusal mutation.
- [x] Step 2: implement AppKit with async `NSTask`, keyboard access, semantic colors, native controls and English/Korean Mac-language selection/fallback. Run `node installer/tests/verify-model.js`. Expected: running backend leaves UI responsive; cancellation policy matches commit phase; optional apps are presence only; completion says installed, never conversion verified.
- [x] Step 3: implement explicit-output build using `/usr/bin/osacompile`, bundle backend plus allowlisted payload and developer-status metadata. Run `bash installer/build-installer.sh --output-dir "$QA/build"` with `QA` set to the durable sibling QA directory. Expected: Installer.app and ZIP/optional DMG outside repo; no developer account, credentials, signing identity, Gatekeeper, quarantine, or system preference changes.
- [x] Step 4: run `node installer/tests/verify-boundaries.js`; exercise five injected dependency violations and a legal same-slice reference. Expected: GUI imports only declared backend protocol; no shared/platform back-reference, private cross-slice access, unlisted dependency, cycle, or decision-module external-feature import. UI-only preview is explicitly test-only with Install disabled.
Evidence (2026-11-05): model/property/refusal-mutation, five boundary injections, package-preservation mutation, strict TypeScript, Biome and Bash syntax pass. `lease-final-package-verification.log` records the current `716205f…` package: 37 exact payload members, strict ad-hoc signature, stay-open metadata, ZIP integrity and extraction-roundtrip equality with no extras. `combined-package-verification.log` retains the unchanged `f563f9c…` GUI gates and prior `855444f…` package evidence; the earlier `final-package-verification.log` is superseded. Actual combined native checks on the prior baseline passed: English current → Command-Q exit; Korean current → titlebar-close exit; nested inspection → owned root/descendants/applet gone; first query failure → live non-stopped tasks retained with guidance, then successful close/retry cleanup; real Korean update → Close/Command-Q refused while active and app-menu Quit permitted after completion. The standard stay-open applet owns event dispatch; no nested/custom loop is used. Private records are `ui-combined-freeze-1/root-actual-*.json` and the final screenshots named in the integration check.

Commit point: native UI/build and schema consumer tests; no public release.

## Task 4 — Actual PoC, operating path, and integration (root)

Files: `docs/review/easy-installer/` sanitized captures/check record, `README.md`, `README.ko.md`, spec/plan task status; private evidence outside Git.
- [x] Step 1: render the existing installation experience and native after screens at equal desktop zoom: English/Korean × light/dark × install/update/completion/conflict, including enlarged small differences. Exercise keyboard and window behavior. Expected: durable actual-render images available to user; no fake completion or test preview that can install. Present PoC before merge/deployment and keep the owner-review status in the integration record. Rendering/presentation and repository-owner review passed: “현재 구성 유지” (2026-11-05), for the frozen `f563f9c…` UI.
- [x] Step 2 (verification route used): combine isolated backend filesystem tests with the registration adapter and the actual GUI under the narrowly verified current account; no arbitrary GUI test-home hook was added. Remove the owned previous download, run a clearly marked private next-download app whose sole payload change is the harmless designated `convert.sh` comment, then restore the normal payload with the actual English GUI. Expected and observed: the real source directory and three workflows verify, all 37 production files are byte-identical after restoration, the QA marker is gone, all three owners use the stable source, no transaction remains, and the trusted doctor passes. ZIP was the artifact tested; no DMG/ejection result is claimed.
- [x] Step 3: before bounded real install, verify owned current installation/test account and capture read-only printer preferences. Invoke actual registration once through the real adapter, open Installer.app, then trigger a PNG through actual Finder Quick Actions directly. Remove download/eject DMG if built and repeat; perform next managed update. Expected: correct resulting PDF, three actions registered, no unsolicited document app/print/TCC actions; compare printer preferences unchanged. Record observable prompts/access, OS and language; unobservable permission state stays unknown.
- [x] Step 4: centrally inspect diff and worker raw evidence, rerun affected engine/model/boundary and existing checks after refreshing/comparing upstream. Expected: approved scope only, correct schemas/ownership/recovery, no unsanitized private files/artifacts, no global settings changes. Update both README installation routes and local-developer/public-release distinction.
Current actual-operation evidence: `lease716-actual-managed-proof.json`, `lease716-actual-doctor.log`, `final-finder-smoke/lease716-verification.json` and `printer-state-after716.json` confirm the real Korean `716205f…` update/registration, all 37 byte-identical payload files, three stable owners, no transaction, released directory lock, trusted doctor pass, English current-state reinspection/Close, actual Finder conversion and unchanged final printer state. All three actions were visible. The fourth owned PNG produced one 960 × 640 point landscape PDF page with correct top-marker orientation and maximum corner-channel error 1/255; its raster was visually checked. Earlier download-independence, new-location update and normal-restoration records are scoped to the prior `855444f…` baseline. No TCC prompt was reported; unobservable permission state remains unknown.

Rendering/presentation and **human PoC approval passed** for the frozen `f563f9c…` UI (“현재 구성 유지”, 2026-11-05). Current `716205f…` actual Mac checks passed. Prior `855444f…` migration/download-independence checks and its 48-case pass remain baseline evidence. The current official full run passed with exit 0 in 6006.593974583 seconds, from 2026-11-05 07:10:02.494067 UTC to 08:50:09.218504 UTC. `official-716-all.log`, `official-716-all-metadata.json` and `official-716-cleanup.json` record exact matrix/core/tail completion, unchanged seven hashes and fixture removal. `root-716-matrix-ledger-check.json` independently confirms 48/48 unique cases and disjoint 24-case lanes; `716-independent-static-review.md` records the narrow lease-delta review. The six current guard mutants passed with exit 0 in 390.835614792 seconds (08:52:54.093369–08:59:24.934916 UTC): intended assertions/frames confirmed, six hashes unchanged, all 37 input snapshots restored and fixture removed. `contract-716-regression-mutants-{metadata,summary}.json`, the corresponding `.log`, and `contract-716-mutation-cleanup.json` retain evidence. `root-final-package-source-identity.json` verifies source/package/signed-commit identity. Central approved-scope conformance and all current functional/local Phase 1 gates passed. Final documentation handoff and GitHub merge remain to be recorded in PR #11; no future commit SHA or merged state is claimed. Signed source commit `588016d90df3bbc037781173a1769e5b51242c27` was pushed; [draft PR #11](https://github.com/dartworklabs/finder-pdf-converter/pull/11) compares with baseline `58652e2827a30976463ed76bde445f8745cf6219`. No commit or push has been made by this documentation worker.

Commit point: reviewed integration, documentation and sanitized evidence. Merge/deploy only after rendered PoC user review; handoff commit/push follows user's authorized completion scope.

## Gates and unresolved limits

Implementation gates are the explicit commands above plus actual Finder PNG and user PoC review; they are local merge-readiness checks unless/ until CI configuration explicitly runs and blocks them. A skipped real operation is not a passing gate. Trusted public release is a separate milestone outside Phase 1: it stays blocked on immutable signed-helper ownership design, Developer ID/notarization and quarantined clean-Mac first-open/Finder proof; those are not local-development completion gates. Minimum supported OS remains unknown until measured; macOS 26.6.2 is only a tested baseline. Certificate/account work, public publishing, automatic permissions and machine-wide installation require a separate approved scope.
