# Easy installer integration check

Status: **the current `716205f…` actual Mac checks and frozen-UI human PoC review passed. The current full automated regression and central handoff/merge remain pending.** This is not merge, deployment, handoff, or public-release approval.

Observed on 2026-11-05, macOS 26.6.2. This record distinguishes actual operations on the current Mac account, controlled native UI fixtures, and isolated backend tests. It excludes personal home paths, source documents, printer identifiers, preference contents, and raw logs. The minimum supported macOS version remains unknown.

## Actual Mac observations — current `716205f…` backend

| Check | Observed result | Scope and limits |
| --- | --- | --- |
| Real Korean update and registration | The normal app followed the Mac’s Korean language and completed Update → installed. Real per-user Finder registration ran through the lock holder. Korean Command-Q closed after completion. | This used the current packaged backend, not a registration stub. The frozen UI does not claim conversion, licensing or permissions are verified by installation. |
| Managed payload and ownership | All 37 installed source files were byte-identical to the current payload. Three project-owner links point to the stable managed source; no transaction remained, the actual directory lock was released, and the trusted doctor with explicit source root passed. | The engine SHA-256 is `716205f0a98416cb63e2c458f10f907c709df83da6cd1b54388e25bf709434b7`. The original source repository was preserved. |
| English current-state inspection | Reopening the current app in English displayed the already-installed state. Close exited normally. | Process-only language selection did not change persistent Mac language preferences. Optional-app detection remains presence only. |
| Actual Finder conversion | All three Korean Finder Quick Actions were visible. The fourth owned PNG check produced one 960 × 640 point landscape PDF page. Top-marker orientation and all four corner colors passed with maximum channel error 1/255; the raster was visually checked. | This confirms the tested PNG route with the current engine, not every supported format or document app. No physical print was made. |
| Printer state after all current operations | Typed comparisons of all four preference domains—including the two preserved queue-specific recent/preset records—matched the baseline. `lpoptions`, default printer and the exact configured queue set matched. | This comparison follows every `716205f…` real operation. No printer identifiers or preference contents are published; no print job was sent. |
| Permissions | No TCC prompt was reported in the actual operations. No automatic permission grant was made. | Existing grants and unobservable permission state remain unknown; no protected TCC database comparison or Full Disk Access request is claimed. |

The current package also passed manifest, strict ad-hoc signature, stay-open metadata, ZIP integrity and extraction-roundtrip checks. UI/model/builder remain frozen at `f563f9c…` / `dfc2669…` / `1335d59…`. The current full automated run remains in progress; passing lock, malformed-input and core checks do not imply a completed full matrix.

## Prior baseline and unchanged native transport proof

The prior `855444f…` backend established verified legacy migration, download-independent Finder conversion after deletion of the owned app/ZIP, a real Korean update from a new download location, and byte-exact restoration of all 37 normal payload files by the English GUI. The private next-download payload changed only a designated harmless `convert.sh` comment; normal restoration removed it. Three owners remained stable, no transaction remained and the trusted doctor passed. These are historical baseline observations, distinct from the current `716205f…` update above. ZIP was tested; no DMG/ejection result is claimed. The prior 48-case pass is not current-engine completion evidence.

With the unchanged frozen UI, actual native transport checks proved English Command-Q and Korean titlebar Close, active-update Close/Command-Q refusal, and post-completion app-menu Quit. A harmless nested-inspection fixture proved owned root, separate Foundation task group, descendants and applet were removed. In the private English query-failure fixture, first Close retained the owned tasks alive and non-stopped with cleanup guidance; second Close removed the tree and applet. Direct process checks established cleanup; stale accessibility inventories were not treated as proof. These fixtures performed no Services or settings writes and are not real installation evidence. The standard stay-open applet owns event dispatch; no nested/custom event loop is used.

## Rendered evidence and human review

Actual before/after screens and the English/Korean × light/dark primary-state matrix were rendered and shown. Registration-required and neutral recovery-result states were also rendered during integration. **Repository-owner PoC review passed on 2026-11-05: “현재구성유지” (keep the current layout).** This approval applies to the frozen `f563f9c71ab5f46e286e61041671e6387afe478fee97f9e0e8d77daa0fe3d21f` UI; it does not substitute for the pending full automated backend validation.

The following interface-only images were reviewed for personal information. The JPEG captures are copied without changing pixels or metadata; their EXIF contains only image dimensions.

- [Before/after installation comparison](before-after-ko.png).
- [Native preview matrix](native-preview-matrix.png): previews cannot install and are not installation evidence.
- [Current Korean update completion](actual-install-ko-completed.jpg): actual `716205f…` update and registration. The original filename is retained; the earlier migration capture remains in private QA.
- [Current English installed state](actual-current-en.jpg): reopened actual `716205f…` installation.
- [Prior normal English completion](final-normal-en-completed.jpg): real `855444f…` baseline normal-payload restoration.
- [Actual English query-failure guidance](final-query-failure-en.jpg): clearly labeled harmless native fixture, not a real installation failure.

## Evidence boundaries

The installers and PNGs were local developer/test artifacts. The installer was ad-hoc signed and not notarized. Actual migration, update, normal-payload restoration, Finder registration, and Finder conversion above were real. Native transport fixtures instead used explicitly harmless owned adapters; their simulated completion is not real installation evidence. Isolated backend tests use disposable homes and a registration adapter so that they do not invoke the real per-user registration service. Temporary HOME does not isolate CFPreferences, TCC, or registration.

Current detailed evidence remains in the private durable sibling QA folder:

- `lease-final-package-verification.log` and `build-lease-final-1/package-verification.json`: current `716205f…` package, all 37 source-matching payload files, no extras, strict ad-hoc signature, stay-open metadata, ZIP integrity and extraction-roundtrip equality. ZIP SHA-256: `527835f79d3f7fc65fcd67f963564fc1f37e99ffad14e1e173534171281df426`.
- `combined-package-verification.log`: unchanged frozen UI gate results and the prior `855444f…` combined package. The earlier `final-package-verification.log` describes a superseded artifact.
- `lease716-actual-managed-proof.json` and `lease716-actual-doctor.log`: current 37-file identity, stable owners, no transaction, released lock and trusted doctor result.
- `final-finder-smoke/lease716-verification.json`: current actual Finder output measurements and all three visible actions.
- `printer-state-after716.json`: typed preferences, `lpoptions`, default and exact queue comparisons after all current real operations.
- `final-managed-payload-proof.json`, `final-finder-smoke/verification.json` and `printer-state-after-final-finder.json`: prior `855444f…` baseline evidence.
- `ui-combined-freeze-1/root-actual-*.json`: actual nested cancellation and failed-query retention/retry observations.

No retained record is claimed for the initial missing-backend red-run procedure; that history is unverified. Current guard-specific rejection records and mutation tests are separate negative evidence and do not recreate the missing historical artifact.

## Phase 1 gate status

- [x] Actual combined native inspection, language selection, window/keyboard behavior, active-mutation exit guards, and nested inspection cancellation/retry.
- [x] Controlled real legacy migration, download-independent Finder operation, new-location managed update, and exact normal-payload restoration.
- [x] Final actual Finder PNG conversion after restoration, with measured geometry, orientation, and colors.
- [x] Final printer preference, `lpoptions`, default-printer, and configured-queue comparisons; observable permission behavior recorded with unknowns retained.
- [x] Actual rendered PoC created and presented with sanitized review images.
- [x] Package the replacement `716205f…` backend with the approved frozen UI; verify manifest/signature/stay-open/ZIP and extraction roundtrip.
- [x] Complete actual `716205f…` Mac update, registration, source/owner/transaction/lock/doctor checks, English reinspection, Finder PNG and final printer-state preservation checks.
- [ ] Finish and review the current `716205f…` backend’s full regression, tail checks and mutants. The prior `855444f…` 48-case pass is not current-engine completion evidence.
- [x] Obtain repository-owner approval of the final rendered PoC: “현재구성유지”, 2026-11-05, frozen `f563f9c…` UI.
- [ ] Finish central review of the frozen diff/current upstream and all required evidence, then complete the authorized commit/push handoff. No commit or push is made by this documentation update.

## Separate public-release milestone

Trusted public distribution remains outside the approved Phase 1 scope. Immutable signed-helper ownership, Developer ID/notarization, and a real quarantined clean-Mac download/first-open/Finder check require separate approval and evidence. These are not unfinished gates for the local Phase 1 developer artifact. No public binary download, signing-credential change, or security bypass is authorized by this record.
