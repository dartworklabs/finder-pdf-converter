# Native managed installer (local developer artifact)

This capability implements the approved Phase 1 in
`docs/superpowers/specs/2026-11-05-easy-installation.md`. It is a local developer
artifact. The app is ad-hoc signed, has not been notarized by Apple, and is not a
trusted public release. No release download is published by the build script.

## Native UI and safety boundary

`ui.js` is a JXA AppKit shell. It consumes only `FPDFInstallerModel` from
`model.js` and the declared `managed-install.sh` JSON protocol. The GUI always
derives its backend and source paths from its own bundle:

```text
Contents/Resources/payload/installer/managed-install.sh
Contents/Resources/payload
```

The app performs inspection when opened. It offers Install, Update, or Recover
only when the parsed outcome allows that operation. Conflict, malformed results,
and contradictory process exits never become completion. An active backend runs
through `NSTask` while the stay-open applet's existing AppKit event loop stays responsive. Window close
and application Quit defer during install/recovery; a mutation finishes or
restores rather than being cancelled halfway through replacement. Read-only
inspection has a 45-second deadline and can be asked to close at any time. Closing or
expiring inspection terminates only that window's owned inspection task; it
never terminates an install/recovery task or changes installed items. Cancellation
pauses the live owned inspection root, reads bounded numeric `pid/ppid/pgid` facts
and run state from the fixed system `ps` tool, freezes verified descendants, and rechecks a
stable stopped tree before terminating only verified individual PIDs, root last.
It never signals an entire process group. If ownership cannot be confirmed, it
resumes its paused PIDs and retains the task/timer for retry or natural completion;
automatic retry is delayed by two seconds. No
process names, patterns, or user-supplied cancellation targets are accepted. A timeout
reports failure with the existing `operation-failed` code and retry guidance.
The native Command-Q menu item targets this same guarded controller directly;
it does not wait for the applet run handler to receive a Quit Apple Event.

Stdout is collected in a uniquely created private directory (0700, response file
0600), read only after task exit and only up to the protocol's 16 KiB limit, then
removed. Stderr goes to the null device, so neither stream can deadlock an unread
pipe or expose private paths in the UI. The launched process receives only a
fixed system `PATH`, `LC_ALL=C`, and the actual user's home directory. Inherited
shell hooks and test/fault-injection environment variables are not forwarded.

English and Korean copy is in `resources/en.lproj/Installer.json` and
`resources/ko.lproj/Installer.json`. The first supported preferred Mac language
is used, with English fallback. AppKit supplies fonts, semantic colors, native
buttons, focus behavior, and light/dark appearance. This changes no conversion
language rules or workflow filenames. Optional-app details report presence only;
completion explicitly leaves conversion, licensing, and permissions unverified.

## Build

On macOS, choose a new absolute output directory outside the repository:

```sh
bash installer/build-installer.sh --output-dir "$HOME/scratch/finder-pdf-installer-build"
```

The script uses `osacompile -s` so the run handler returns to the standard applet event loop; global references retain callbacks and the window. Guarded Close calls native termination. No nested event loop or custom event pump is used.

The script produces `Finder PDF Converter Installer.app` and a ZIP in that
directory. Existing outputs are refused. It uses macOS Bash, `osacompile`,
`PlistBuddy`, `codesign`, and `ditto`; no Node or Python runtime is shipped or
required by the installed app. No Developer ID account, certificate access,
Gatekeeper change, quarantine removal, or publication is performed.

The build copies an explicit payload of 37 regular files: 20 runtime scripts,
four metadata/localization files for each of the three workflows, `install.sh`,
`doctor.sh`, and the three backend files. Symbolic links, hardlinks, oversized
files (over 2 MiB each or 10 MiB total), and redirected output parents are
refused. `Contents/Resources/payload.sha256` inventories the copied payload.
Metadata and localization are finalized before the complete app receives its
ad-hoc signature. The final app's strict signature is verified before packaging.
The ordinary checkout CLI and installed workflow helper-signature contracts
remain separate from the app's outer signature.

## Inert native PoC

For UI review without a backend or filesystem inspection:

```sh
bash installer/build-installer.sh --preview-only --output-dir "$HOME/scratch/finder-pdf-installer-preview"
```

This produces `Finder PDF Converter Preview.app` and its ZIP. A compile-time
preview-only flag defaults the app to a fresh preview and prevents backend
invocation even when no arguments are supplied. Install, Update, and Recover are
disabled. All preview windows carry a visible preview-only label.

A built app also accepts these presentation arguments together:

```text
--preview fresh|current|update|legacy|completed|registration|recovered|conflict|recovery|recovery-conflict|restored|failed
--locale en|ko
--appearance light|dark
```

Locale and appearance overrides require preview mode. Arbitrary source roots,
backend paths, and test-home overrides are not accepted by the native app.
The standard Cocoa process-only language pair `-AppleLanguages '(en)'` or
`-AppleLanguages '(ko)'` is also accepted as the first pair of launch arguments,
including in the full installer. It changes only that process's language and
never writes persistent preferences. Only those two exact forms are accepted;
duplicates, misplaced pairs, and other Cocoa overrides are refused.
Preview screenshots do not demonstrate successful installation or conversion.
The approved PoC gate requires actual native rendering and user review before
merge or deployment.

## Private UI event-transport fixtures

For actual compiled Close/Command-Q interaction checks without any user-service
access, build distinct private fixtures into a new output directory:

```sh
bash installer/tests/build-ui-transport.sh --output-dir "$HOME/scratch/finder-pdf-ui-transport"
```

They have separate test names/bundle IDs and visible transport-test titles and
footers. The inspect adapter directly executes an owned 60-second sleep and
refuses mutations. The inspect-nested adapter launches a separate Foundation
NSTask group with racing shell sleep descendants, recording its owned numeric
identities in the private output directory for actual cleanup verification. The
inspect-failure variant privately fails the first process query so actual Close
can verify retained ownership, truthful failure guidance, and a successful retry. The install adapter immediately reports fresh, waits for the
output directory's `install-release` file (or 120 seconds), and then reports a
simulated installed outcome. It touches no Services, settings, apps, or printer
state; its TERM trap cleans up its owned short sleep child. Use it only to test
that Close/Command-Q cancel inspect while refusing active mutations. The copied
payload manifest and complete app signature are updated after substitution.
These adapters are confined to private test artifacts; production has no such
hooks. Simulated completion is not installation or conversion evidence.

## Local verification

Managed-backend checks use real isolated files, native compilation and strict
signatures; only Finder registration is replaced. Run the focused child-lock
regression or the full contract with two recovery lanes:

```sh
bash installer/tests/verify-managed-install.sh lock
FINDER_PDF_CONTRACT_JOBS=2 bash installer/tests/verify-managed-install.sh all
```

The test-only jobs setting accepts `1` (default) or `2`. Two lanes have separate
HOME/native ownership baselines and cover exactly 24 disjoint rename-fault/crash
cases each, with an independently checked union of all 48 cases. Core setup and
the recovery/finalization tail remain serial. Every backend call retains its
120-second limit, and the shared frozen payload must remain unchanged. The full
check is slow because every case runs actual compilation, signatures, filesystem
changes and recovery. Both owned workers finish before fixture cleanup, including
when either worker fails. This setting is never an installer runtime option.

```sh
node installer/tests/verify-model.js
node installer/tests/verify-boundaries.js
node installer/tests/verify-build.js
bash installer/tests/verify-native.sh
npx --yes --package=typescript@7.0.2 tsc --project installer/tsconfig.json
(cd installer && npx --yes @biomejs/biome@2.6.5 lint model.js ui.js tests/verify-model.js tests/verify-boundaries.js tests/verify-build.js)
bash -n installer/build-installer.sh installer/tests/verify-native.sh
```

Node, TypeScript, and Biome are developer checks only. No package is added to the
end-user runtime. `tsconfig.json` checks the JavaScript protocol/presentation
union types; Objective-C bridge values are intentionally declared `any` because
selector ABI and AppKit availability need native execution. The native test
registers the real AppKit protocols without opening a window, exercises timeout
and cancellation with real owned read-only processes and real AppKit controls,
checks that install/recovery close guards preserve their processes, and proves
preview and invalid launch arguments cannot invoke a backend. It catches protocol encodings that `osacompile` alone cannot validate.
Actual window, accessibility, appearance, keyboard, and Finder operation remain
separate integration gates. These local commands are not CI merge gates unless a
future CI configuration explicitly runs and enforces them.

The import-graph check declares the UI → model and UI → backend public-command
dependencies, with their reasons, and keeps the decision module free of I/O. It
rejects five injected violations: a private backend import, a shared module
reaching a feature through shared code, a dependency cycle, an undeclared
feature dependency, and a decision module importing another feature. A legal
same-slice dependency is accepted.

The package-boundary test builds a real inert app in one reusable fixture, checks
its final signature, and verifies preservation of existing outputs and linked
payload/target objects. It also removes the trailing-slash defense in that same
fixture and confirms the target-preservation oracle detects the mutation. Every
fixture and its build outputs are removed on success or failure.

## Managed backend and recovery contract

`managed-install.sh` is the only public entry point for this capability:

```sh
bash installer/managed-install.sh inspect --source-root /absolute/payload/path
bash installer/managed-install.sh install --source-root /absolute/payload/path
bash installer/managed-install.sh recover --source-root /absolute/payload/path
```

Callers pass an argument array, not an interpolated shell command. Each invocation
writes one UTF-8 JSON object with `schemaVersion: 1`, the invoked `operation`, and
an `outcome`. Inspection reports `fresh`, `current`, `update`, or `legacy` with
four optional-app presence booleans. Refusals report `conflict` or
`recovery-required` with a closed reason code. Mutations report `installed`,
`recovered`, `busy`, `restored`, `registration-required`, `invalid-request`, or `failed` according to the
plan's closed variant and exit-code contract. No private path is written to JSON.
`registration-required` means the verified filesystem set was committed but
Finder registration failed or is unconfirmed; it exits 1 and never means the
installation was unchanged. The input contains exactly the 37 listed files, bounded directories and regular
files only; links, hardlinks, extra entries, and oversized inputs are refused.

Managed source is the real `Library/Application Support/Finder PDF Converter/source`
directory in the current user's home. Its receipt records the payload's content
and metadata; its hash is embedded in both native helpers before they are signed.
The receipt and signed helpers are checked before a managed update. A legacy
installation is eligible only when all three project links agree and the trusted
new doctor validates the old source, both helpers, inventories and signatures.
The old source's scripts are never executed. Unknown workflow members block a
whole-bundle replacement. The advanced checkout installer retains its exact-source
ownership rule and shares the same per-user advisory directory lock.
During staging and Finder registration, a private waiting process retains the
same lock until the invoked command exits, even if the installer engine stops.
It checks that the borrowed descriptor is a directory before starting work.
The trusted doctor's process group has a 30-second limit; on expiry the engine
stops that owned group and reports that the legacy source could not be verified.
This also bounds the doctor's descendants if the parent inspection is closed.

The four live targets are the managed source and three Services bundles. The
backend stages all replacements before renaming a live target, records the old
and new snapshots and each rename in a bounded canonical journal, and checks
identity, bytes, permissions, ownership and modification times immediately before
replacement or restoration. Backups survive until the complete new set verifies;
a committed journal permits finalization after a crash. If a target, backup,
journal, or staging member cannot be proved unchanged, the engine preserves the
evidence and reports recovery required.

A journal created before staging records the transaction directory's identity
and the four original states. If preparation fails or is interrupted, recovery
preserves the complete private transaction directory under an identity-derived
`retained-preparation-…` name after checking that the live targets are unchanged.
At most four retained preparations are allowed; if the limit or a name conflict
is reached, recovery stops without deleting them. An interruption between creating
the private transaction directory and writing its first journal cannot establish
ownership from a journal, so recovery stops and preserves that directory for
manual inspection. Neither condition changes a live workflow or source.

`FINDER_PDF_TEST_NO_REGISTER=1` is reserved for isolated developer tests. It
suppresses real `pbs` registration; the native app deliberately does not inherit
this or any fault-injection variable. Successful production installation performs
registration only after verification. `install.sh --no-register` provides the same
filesystem-only isolation for the advanced CLI's developer tests.
