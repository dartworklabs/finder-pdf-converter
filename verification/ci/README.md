# CI verification boundaries

Every pull request runs the listed portable and macOS checks. The macOS job requires a real GUI session and executes the existing AppKit and LaunchServices fixtures. It does not prove actual Finder, Office, printer, login, accessibility or user-account behavior. A configured check is not an enforced branch-protection rule.

The initial PR also runs the unchanged full managed-backend contract in a disposable GitHub-hosted macOS VM. It validates both 24-case ledgers, every case marker and core/tail phase markers. This temporary PR trigger remains until a separately reviewed change implements the approved manual-hosted policy. Backend/payload changes still require the documented local full run. A dispatch run is separately available once the workflow exists on the default branch.

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
