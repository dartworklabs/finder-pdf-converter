# CI verification boundaries

Every pull request runs the listed portable and macOS checks. The macOS job requires a real GUI session and executes the existing AppKit and LaunchServices fixtures. It does not prove actual Finder, Office, printer, login, accessibility or user-account behavior. A configured check is not an enforced branch-protection rule.

The Native fixtures step opts in to running the native assertion scripts in compiled, ad-hoc signed JXA applets on the disposable GitHub-hosted macOS runner. Ordinary local runs still execute those scripts through `osascript`. On timeout or interruption, the wrapper terminates only the applet's process group. Separate task groups and synthetic preference domains may persist until the hosted VM is torn down.

The initial PR also runs the full managed-backend contract in a disposable GitHub-hosted macOS VM. It validates both 24-case ledgers, every case marker and core/tail phase markers. This temporary PR trigger remains until a separately reviewed change implements the approved manual-hosted policy. Backend/payload changes still require the documented local full run. A dispatch run is separately available once the workflow exists on the default branch. The owner approved a 240-second limit solely for the install from the moved synthetic download in `test_download_independence` on GitHub-hosted full runs; a separate hosted measurement (run 42072101704) completed that install in 121.634 seconds and passed the case assertions. The workflow explicitly opts in, and the test also requires full mode and GitHub-hosted runner indicators. The owner also approved a 240-second limit solely for the final successful managed adoption install in `test_legacy` on GitHub-hosted full runs. Standalone Mac15 run 42171469513 measured that invocation at 112.900 seconds with return code 0 and all original case assertions passing; full run 42132082597 previously timed out at 120 seconds on the same invocation. A separate workflow opt-in uses the same full-mode and GitHub-hosted checks. The owner separately approved a 240-second limit only for the committed crash install inside both registration-failure iterations, with its own opt-in and the same hosted full-mode checks. Full run 42172295427 timed out at 120 seconds on that exact invocation. Standalone run 42190082740 measured the flush iteration at 78.766 seconds, exit 86, with a committed journal; recovery and assertions passed as it advanced to update, whose unrelated preparation then timed out at 120 seconds. Independent run 42191607859 used managed ownership and current-state proof for update: the crash install took 89.168 seconds, exited 86 with a committed journal, and all update recovery and assertions passed. All other invocations, including local runs, retain their existing limits.

On cancellation or failure, the wrapper leaves its partial log on the runner and reaps its direct child. The workflow attempts to upload that log when possible; forced VM termination or runner loss can prevent retention. The backend fixtures can create separate process groups: forced cancellation does not prove those descendants were cleaned up, and they may survive until the disposable hosted VM ends. A cancelled or incomplete run is never successful evidence. Do not use the full CI wrapper as a cleanup guarantee on a shared machine.

The CI-only Python checks use pinned Ruff 0.14.14 and mypy 1.19.1. The workflows grant only read access, use no secrets, and do not publish the ad-hoc app or ZIP. Environment details, source commit and tree, timings and synthetic full-contract log are recorded; only the latter is uploaded, for seven days.

The workflow definitions are [PR verification](../../.github/workflows/ci.yml) and [full backend](../../.github/workflows/full-backend.yml). To run their CI-only integrity and static checks locally with Ruff 0.14.14 and mypy 1.19.1 installed:

```sh
python3 verification/ci/test_check.py
ruby verification/ci/workflow_policy.rb
ruff format --check verification/ci/*.py
ruff check verification/ci/*.py
mypy --strict --python-version 3.9 verification/ci/*.py
```
