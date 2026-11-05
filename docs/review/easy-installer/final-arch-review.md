# Final architecture review — local Phase 1 PASS

Finalized 2026-11-05 from retained test records and central review. **PASS — approved local Phase 1 conformance and all current functional acceptance gates.** Final documentation handoff/GitHub merge is not yet asserted; [PR #11](https://github.com/dartworklabs/finder-pdf-converter/pull/11) is the canonical handoff/status record. No tests or real-system operations were performed while preparing this documentation.

## Review target and authority

- Signed/pushed source commit: `588016d90df3bbc037781173a1769e5b51242c27`; comparison base: `58652e2827a30976463ed76bde445f8745cf6219`; branch `feature/easy-installer`; [draft PR #11](https://github.com/dartworklabs/finder-pdf-converter/pull/11). Frozen source identities below match the official run and the signed commit. This later documentation status update awaits its own handoff commit. Central approved-scope conformance review passed; eventual merge identity/state belongs to PR #11.
- Approved [spec](../../superpowers/specs/2026-11-05-easy-installation.md) and [plan](../../superpowers/plans/2026-11-05-easy-installation.md) define Phase 1 local native installation. Original approved-content SHA-256 remains `0b07f5f6c0fefc8268d0f2138a23e2aa22ea7d70e8e55b9820a06e45854b52ad`.
- No Handbook exists. Current authorities are the spec/plan, `README.md` / `README.ko.md`, guarded `install.sh` / `doctor.sh`, and capability-local installer/model/build contracts. See the [integration record](integration-check.md) for actual observations and limits.
- Repository-owner rendered-UI review: **PASS**, “현재 구성 유지”, frozen UI `f563f9c…`. This does not replace backend regression evidence.

### Frozen source identity

| File | SHA-256 |
| --- | --- |
| `installer/ui.js` | `f563f9c71ab5f46e286e61041671e6387afe478fee97f9e0e8d77daa0fe3d21f` |
| `installer/model.js` | `dfc2669f1efa3fa50c0be03c142582b1d4a459e8cc3d9e69e1e900ffd3a1339f` |
| `installer/build-installer.sh` | `1335d59eead8b28fc2b6cacfde9ab7394313315c63f66e1cbaab8205ed10e4ba` |
| `installer/managed-engine.js` | `716205f0a98416cb63e2c458f10f907c709df83da6cd1b54388e25bf709434b7` |
| `installer/managed-install.sh` | `6a920df437fd92db8222e2fcf4337d3faf9521bab86a6412adff0adb00d9f22e` |
| `installer/stage-managed.sh` | `26021f00b5920e091c237aa5f219aac430d94126179a77a3d640c4c7de39cc5f` |
| `installer/tests/verify-managed-contract.py` | `242ed1dda1efb71058fcdcbba86b4011be5edb3d7e45c8313b8ebc5d503ccea5` |
| `installer/tests/verify-managed-install.sh` | `673c8af81451df824a85c638b6f5daf5158af24eaf4a9aa0376b8699e4264435` |
| `install.sh` | `6b8d77a5bc7508a405f94d14b41175dda1846a3bbfdfb829afa17b0f975cab6f` |
| `doctor.sh` | `25c3678d8fc04964723104ca8c98e5473adad4a62f003bdaaeaefb28600c1d00` |

The official run’s `official-716-all-metadata.json` records exit 0 and identical seven source hashes before/after; central integration verified those against both the working tree and signed source commit. The run started 2026-11-05 07:10:02.494067 UTC and ended 08:50:09.218504 UTC, taking 6006.593974583 seconds (100 minutes 7 seconds rounded). Any affected content change requires fresh affected review/evidence; do not reuse an older engine’s PASS.

## Qualitative conformance

| Relation | Result | Evidence and limits |
| --- | --- | --- |
| Implementation ↔ approved spec | PASS | Central review covered approved per-user local scope, preserved foreign data, rollback/recovery, bounded trusted payload, truthful readiness and permission limits. The independent narrow lease-delta review is `716-independent-static-review.md`. |
| Implementation ↔ plan | PASS — current functional acceptance | Full backend/inspection superset, six guard mutants, UI/package, actual Mac and human PoC checks passed. The initial missing-backend red-run artifact remains an unverified historical process-evidence limit, with its original procedure checkboxes unticked; no historical evidence is invented. |
| Implementation ↔ current authorities | PASS | Central review covered engine delta, full-gate metadata/source/commit identity, six-guard driver/report, actual Mac/package/preferences and documentation. Existing CLI ownership guards and explicit source-root diagnosis remain applicable. |
| Decision records / Handbook | N/A | No ADR or Handbook change in this scope; no Handbook exists. |

## Contract regression gates

Private evidence names below refer to the durable sibling QA folder, not public artifacts.

| Gate | Current result | Evidence and scope |
| --- | --- | --- |
| Frozen UI/model/boundaries/native/type/lint | PASS, unchanged source | `combined-package-verification.log`; actual combined native lifecycle and cancellation records. Native fixtures are harmless transport proofs, not real installs. |
| Current package | PASS | `lease-final-package-verification.log`, `build-lease-final-1/package-verification.json`: 37 exact members, no extras, strict ad-hoc signature, stay-open metadata, ZIP/extraction roundtrip. |
| Current actual Mac update, registration, diagnosis and Finder PNG | PASS | `lease716-actual-managed-proof.json`, `lease716-actual-doctor.log`, `final-finder-smoke/lease716-verification.json`; real registration, released lock, exact payload and measured PNG output. |
| Final printer-state preservation | PASS | `printer-state-after716.json`: four typed domains, the two preserved recent-setting records, `lpoptions`, default and exact queue set unchanged. Unobservable TCC state remains unknown. |
| Human rendered PoC | PASS | Owner: “현재 구성 유지”; sanitized current and before/after captures in this directory. |
| Official current `716205f…` full backend gate | **PASS, exit 0** | `FINDER_PDF_CONTRACT_JOBS=2 bash installer/tests/verify-managed-install.sh all`; `official-716-all.log`, `official-716-all-metadata.json`, `official-716-cleanup.json`. Exact 48-case matrix plus serial core/tail passed, seven hashes unchanged and fixture cleanup completed. |
| Independent matrix ledger cross-check | PASS | `root-716-matrix-ledger-check.json`: direct Cartesian expectation equals exactly 48 unique cases, two disjoint 24-case ledgers, no missing/unexpected cases or overlap. The proof’s original matrix-only timestamp preceded final full-run completion. |
| Six current guard mutants | **PASS, exit 0** | `contract-716-regression-mutants.log`, metadata and summary JSON: six intended assertion/frame failures, not arbitrary errors. `contract-716-mutation-cleanup.json`: all 37 input snapshots restored, fixture removed. |
| Final source/package identity | PASS | `root-final-package-source-identity.json`: 37 members match, frozen UI/model/builder/backend agree with signed source commit, retained ZIP hash agrees. |
| Independent current-engine static review | PASS, narrow scope | `716-independent-static-review.md`: descriptor borrowing and fixed staging/registration holder delta; no further concrete blocker identified. Original review-time full-run limit is retained in that record. |
| Signed source commit/push/draft PR | PASS | `588016d90df3bbc037781173a1769e5b51242c27`, baseline `58652e2827a30976463ed76bde445f8745cf6219`, draft PR #11. |
| Final central conformance review | PASS | Approved spec/plan and current authority conformance, full-run/source/commit identity, guard evidence, actual Mac and preservation records reviewed centrally. |
| Documentation handoff/GitHub merge | Not yet recorded | PR #11 is canonical for the subsequent documentation commit and merged state; no future SHA or merge claim is made. |

## Judgment and handoff boundary

**PASS — ready for the approved local Phase 1 handoff.** The current full backend run, all six current guard mutants, unchanged native UI/model/build checks, CLI guards, actual current-Mac update/Finder operation, source/package identity, printer preservation and human UI review passed. Central qualitative conformance also passed. This is a local review result, not a claim that an external CI or trusted public distribution gate ran.

The current six-mutant run started 2026-11-05 08:52:54.093369 UTC and ended 08:59:24.934916 UTC, taking 390.835614792 seconds. All six source hashes matched before/after. Runner SHA-256: `bea17e46bd1c48cf649c52c4f8dce8fbb206215db22a562df82a03c2ec4799fd`. Central review checked the intended assertions/frames for false registration success, linked legacy parent, hardlinked legacy source, omitted committed-backup preflight, managed-source CLI bypass and misclassified interrupted-journal recovery. All were rejected for the intended reason; full input restoration and fixture cleanup passed.

The missing initial backend-red artifact is a historical procedure-evidence gap, not an outstanding current functional acceptance gate. Its original checkbox remains unticked. Source commit/push/draft PR are confirmed above; the final documentation handoff commit and GitHub merge remain future actions. Follow PR #11 for their canonical status rather than inferring a future SHA or merged state from this readiness record.

Public Developer ID/notarization, quarantined clean-Mac distribution and measured minimum-OS support are separate milestones outside Phase 1, not local completion gates. Existing licensing and unobservable permission state remain unknown; no automatic grants or physical printing are claimed.
