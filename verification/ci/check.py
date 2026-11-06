#!/usr/bin/env python3
"""Run CI-only checks and reject incomplete backend evidence."""

import json
import os
import re
import signal
import subprocess
import sys
import time
from types import FrameType
from typing import Optional
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORE_MARKERS = (
    [
        "PASS: exhaustive recovery partition coverage and rejection properties",
        "PASS: pure native-case scheduling uses independent HOME owners",
        "PASS: actual compiler survives engine death; managed/legacy contenders busy; recovery safe",
        "PASS: fresh/current/update, deleted download path, stable native ownership",
        "PASS: foreign names, helper tamper, extra members, owner disagreement, hardlink, unsafe/read-only parents",
        "PASS: seeded names, links and oversized payload rejected; compilation failure preserves targets",
        "PASS: verified legacy adoption; missing source, source-parent link and source hardlink preserved",
        "PASS: managed source rejects legacy CLI without writes",
        "PASS: managed source, receipt and internally consistent forged receipt pair rejected",
        "PASS: registration flush/update failures are exit1 after verified install and committed recovery",
        "PASS: last-backup conflict preserves every earlier committed preimage",
        "PASS: real concurrent managed and legacy installation serialize",
        "PASS: second lane has an independent real native ownership baseline",
        "PASS: concurrent edit and backup retention; malformed/path-escape journal preserved",
    ]
    + [f"PASS: repeated recovery after retire-{i}" for i in range(4)]
    + [
        f"PASS: committed finalization after {phase}"
        for phase in ("committed", "cleanup-0", "cleanup-1", "cleanup-2", "cleanup-3")
    ]
    + [
        f"PASS: concurrent same-byte {kind} edit and backups survive recovery"
        for kind in ("mode", "mtime")
    ]
    + [
        f"PASS: retained preparation {present}-{phase}-{crash}"
        for present in (False, True)
        for phase in ("preparing", "stage-complete")
        for crash in (False, True)
    ]
)


def shell_inventory(root: Path = ROOT) -> None:
    """Check every tracked shell file, failing if none or any syntax fails."""
    result = subprocess.run(
        ["git", "ls-files", "-z", "--", "*.sh"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    )
    paths = [os.fsdecode(p) for p in result.stdout.split(b"\0") if p]
    if not paths:
        raise ValueError("no tracked shell scripts")
    for path in paths:
        subprocess.run(["bash", "-n", path], cwd=root, check=True)
    print(f"PASS: shell syntax {len(paths)} tracked scripts")


def verify_ledger(log: str) -> None:
    """Require the full two-lane ledger, actual case markers, core and tail."""
    lines = log.splitlines()
    expected = {
        f"{present}-{phase}-{index}-{crash}"
        for present, phases in (
            (False, ("before-install", "install")),
            (True, ("before-install", "install", "before-backup", "backup")),
        )
        for phase in phases
        for index in range(4)
        for crash in (False, True)
    }
    lanes = []
    for i in range(2):
        matches = [
            line.removeprefix(f"LEDGER lane{i} ")
            for line in lines
            if line.startswith(f"LEDGER lane{i} ")
        ]
        if len(matches) != 1:
            raise ValueError("missing or duplicate lane")
        lane = json.loads(matches[0])
        if not isinstance(lane, list) or len(lane) != 24 or len(set(lane)) != 24:
            raise ValueError("invalid lane")
        lanes.append(set(lane))
    cases = [
        line.removeprefix("PASS: recovery ")
        for line in lines
        if line.startswith("PASS: recovery ")
    ]
    if (
        lanes[0] & lanes[1]
        or lanes[0] | lanes[1] != expected
        or len(cases) != 48
        or set(cases) != expected
    ):
        raise ValueError("incomplete or repeated recovery cases")
    markers = [
        "PASS: 2 recovery lane(s), exactly48 unique real native cases",
        "PASS: managed backend all contracts",
    ]
    timings = [
        "stage-child-lock",
        "contract",
        "registration-and-finalization",
        "preparation-and-lock",
        "rename-matrix",
        "repeated-recovery-and-commit",
        "external-edits-and-journals",
    ]
    if (
        any(lines.count(marker) != 1 for marker in markers + CORE_MARKERS)
        or sum(
            bool(
                re.fullmatch(
                    r"PASS: [1-9]\d* malformed requests return exit2/single JSON without writes",
                    line,
                )
            )
            for line in lines
        )
        != 1
        or any(
            sum(
                bool(re.fullmatch(r"TIMING " + name + r" \d+\.\d+s", line))
                for line in lines
            )
            != 1
            for name in timings
        )
    ):
        raise ValueError("missing completion or phase timing")
    positions = [
        next(
            i for i, line in enumerate(lines) if line.startswith("TIMING " + name + " ")
        )
        for name in timings
    ]
    if (
        positions != sorted(positions)
        or lines.index(markers[1]) < positions[-1]
        or lines.index(markers[0]) > positions[4]
    ):
        raise ValueError("backend phases out of order")
    phase_markers = [
        CORE_MARKERS[:3],
        CORE_MARKERS[3:9],
        CORE_MARKERS[9:11],
        [CORE_MARKERS[11]] + CORE_MARKERS[25:],
        [CORE_MARKERS[12], markers[0]],
        CORE_MARKERS[14:23],
        [CORE_MARKERS[13]] + CORE_MARKERS[23:25],
    ]
    for phase, required in enumerate(phase_markers):
        start = positions[phase - 1] if phase else -1
        if any(
            not start < lines.index(marker) < positions[phase] for marker in required
        ):
            raise ValueError("marker outside its phase")
    malformed = next(
        i
        for i, line in enumerate(lines)
        if re.fullmatch(
            r"PASS: [1-9]\d* malformed requests return exit2/single JSON without writes",
            line,
        )
    )
    if not positions[0] < malformed < positions[1]:
        raise ValueError("malformed request marker outside contract phase")
    print("PASS: full backend evidence: 48 unique cases and all phases")


def run_checked(command: list[str], cwd: Path = ROOT) -> str:
    """Run a command without masking its failure and return its captured output."""
    result = subprocess.run(
        command, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    print(result.stdout, end="", flush=True)
    if result.returncode:
        raise RuntimeError(f"command exited {result.returncode}: {command[0]}")
    return result.stdout


def require_markers(output: str, markers: list[str]) -> None:
    """Refuse a command that omitted any required completion marker."""
    lines = output.splitlines()
    if any(
        not any(line.startswith(marker) and line.endswith("passed") for line in lines)
        for marker in markers
    ):
        raise ValueError("required completion marker absent")


def fast_check(name: str) -> None:
    """Run one approved existing check and require its observed completion markers."""
    checks = {
        "model": (
            ["node", "installer/tests/verify-model.js"],
            ["installer model:", "management model:"],
        ),
        "boundaries": (
            ["node", "installer/tests/verify-boundaries.js"],
            ["installer boundaries:"],
        ),
        "review": (["node", "verification/verify-review-model.js"], ["review model"]),
        "build": (["node", "installer/tests/verify-build.js"], ["installer build:"]),
        "native": (
            ["bash", "installer/tests/verify-native.sh"],
            [
                "installer native:",
                "management native:",
                "management login control:",
                "management background:",
                "management reopen:",
            ],
        ),
    }
    if name == "progress":
        output = run_checked(["node", "verification/verify-progress-ui.js"])
        markers = [
            "PASS: terminal preparation preserves late cancellation and owner shutdown",
            "PASS: 1001-item conversion status is accepted and oversized status is rejected",
            "PASS: malformed or oversized status continues polling until graceful owner shutdown",
        ]
        if any(output.splitlines().count(marker) != 1 for marker in markers):
            raise ValueError("progress test marker absent")
        return
    if name not in checks:
        raise ValueError("unknown fast check")
    command, markers = checks[name]
    require_markers(run_checked(command), markers)


def portable_tests() -> None:
    """Require the actual Node test runner to execute its cases without skips."""
    output = run_checked(
        [
            "node",
            "--test",
            "--test-reporter=tap",
            "verification/verify-csv.js",
            "verification/verify-markdown.js",
        ]
    )
    tests = re.search(r"^# tests (\d+)$", output, re.MULTILINE)
    skips = re.search(r"^# skipped (\d+)$", output, re.MULTILINE)
    if not tests or int(tests.group(1)) < 11 or not skips or int(skips.group(1)) != 0:
        raise ValueError("portable tests missing, reduced, or skipped")
    print("PASS: portable test count and zero skips")


def run_full(log_path: str, command: Optional[list[str]] = None) -> None:
    """Capture the real full suite, reap its direct child and validate its log."""
    start = time.monotonic()
    env = dict(os.environ, FINDER_PDF_CONTRACT_JOBS="2")
    with open(log_path, "w", encoding="utf-8") as log:
        process = subprocess.Popen(
            command or ["bash", "installer/tests/verify-managed-install.sh", "all"],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            while True:
                try:
                    status = process.wait(timeout=30)
                    break
                except subprocess.TimeoutExpired:
                    print(
                        f"Full backend still running ({time.monotonic() - start:.0f}s)",
                        flush=True,
                    )
        except BaseException:
            # Signal only the session created for this test and reap its leader.
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            raise
    print(
        f"TIMING full-command {time.monotonic() - start:.3f}s exit={status}", flush=True
    )
    output = Path(log_path).read_text(encoding="utf-8")
    print(output, end="", flush=True)
    if status:
        raise RuntimeError(f"full backend exited {status}")
    verify_ledger(output)


def interrupt(_signum: int, _frame: Optional[FrameType]) -> None:
    """Convert termination to an interrupt so the owned child is reaped."""
    raise KeyboardInterrupt


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupt)
    try:
        if sys.argv[1:] == ["shell"]:
            shell_inventory()
        elif len(sys.argv) == 3 and sys.argv[1] == "ledger":
            verify_ledger(Path(sys.argv[2]).read_text(encoding="utf-8"))
        elif len(sys.argv) == 3 and sys.argv[1] == "fast":
            fast_check(sys.argv[2])
        elif sys.argv[1:] == ["portable-tests"]:
            portable_tests()
        elif len(sys.argv) == 3 and sys.argv[1] == "full":
            run_full(sys.argv[2])
        else:
            raise ValueError("expected shell or full LOG")
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"CI check failed: {error}", file=sys.stderr)
        sys.exit(1)
