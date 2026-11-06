"""Reject incomplete evidence and invalid tracked shell scripts in isolated fixtures."""

import json
import os
import sys
import time
import random
import subprocess
import tempfile
import unittest
from pathlib import Path
from check import (
    CORE_MARKERS,
    require_markers,
    run_checked,
    shell_inventory,
    verify_ledger,
)


def complete_log() -> str:
    """Construct independent synthetic complete evidence for negative checks."""
    cases = [
        f"{present}-{phase}-{index}-{crash}"
        for present, phases in (
            (False, ("before-install", "install")),
            (True, ("before-install", "install", "before-backup", "backup")),
        )
        for phase in phases
        for index in range(4)
        for crash in (False, True)
    ]
    phases = [
        CORE_MARKERS[:3],
        CORE_MARKERS[3:9]
        + ["PASS: 5 malformed requests return exit2/single JSON without writes"],
        CORE_MARKERS[9:11],
        [CORE_MARKERS[11]] + CORE_MARKERS[25:],
        [CORE_MARKERS[12]]
        + ["PASS: recovery " + case for case in cases]
        + [
            "LEDGER lane0 " + json.dumps(cases[:24]),
            "LEDGER lane1 " + json.dumps(cases[24:]),
            "PASS: 2 recovery lane(s), exactly48 unique real native cases",
        ],
        CORE_MARKERS[14:23],
        [CORE_MARKERS[13]] + CORE_MARKERS[23:25],
    ]
    timings = (
        "stage-child-lock",
        "contract",
        "registration-and-finalization",
        "preparation-and-lock",
        "rename-matrix",
        "repeated-recovery-and-commit",
        "external-edits-and-journals",
    )
    lines = []
    for phase, name in zip(phases, timings):
        lines.extend(phase)
        lines.append("TIMING " + name + " 1.000s")
    lines.append("PASS: managed backend all contracts")
    return "\n".join(lines)


class Integrity(unittest.TestCase):
    """CI evidence must represent real nonempty and complete work."""

    def test_full_evidence_and_mutations(self) -> None:
        """Truncation, duplication, missing phases, and zero work fail."""
        good = complete_log()
        verify_ledger(good)
        lines = good.splitlines()
        for bad in (
            "",
            "\n".join(lines[:-1]),
            "\n".join(lines[1:]),
            good + "\n" + lines[0],
            good.replace("LEDGER lane1 ", "LEDGER lane0 "),
        ):
            with (
                self.subTest(bad=bad[:40]),
                self.assertRaises((ValueError, json.JSONDecodeError)),
            ):
                verify_ledger(bad)

    def test_overlapping_lanes_fail_even_with_all_case_markers(self) -> None:
        """Duplicated lane membership cannot masquerade as a complete partition."""
        lines = complete_log().splitlines()
        lane0 = next(line for line in lines if line.startswith("LEDGER lane0 "))
        lane1 = next(
            i for i, line in enumerate(lines) if line.startswith("LEDGER lane1 ")
        )
        lines[lane1] = lane0.replace("LEDGER lane0 ", "LEDGER lane1 ", 1)
        with self.assertRaises(ValueError):
            verify_ledger("\n".join(lines))

    def test_zero_requests_and_late_phase_marker_fail(self) -> None:
        """Zero malformed cases and markers moved after completion are not evidence."""
        good = complete_log()
        with self.assertRaises(ValueError):
            verify_ledger(
                good.replace("PASS: 5 malformed requests", "PASS: 0 malformed requests")
            )
        marker = CORE_MARKERS[2]
        with self.assertRaises(ValueError):
            verify_ledger(good.replace(marker + "\n", "") + "\n" + marker)

    def test_generated_incomplete_ledgers_fail_cli(self) -> None:
        """Seeded missing and repeated cases must fail the public CLI."""
        rng = random.Random(106)
        lines = complete_log().splitlines()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.log"
            for _ in range(20):
                broken = lines.copy()
                index = rng.choice(
                    [
                        i
                        for i, line in enumerate(lines)
                        if line.startswith("PASS: recovery ")
                    ]
                )
                if rng.randrange(2):
                    del broken[index]
                else:
                    broken[index] = broken[
                        index + 1 if index + 1 < len(lines) else index - 1
                    ]
                path.write_text("\n".join(broken))
                result = subprocess.run(
                    [
                        "python3",
                        str(Path(__file__).parent / "check.py"),
                        "ledger",
                        str(path),
                    ],
                    capture_output=True,
                )
                self.assertNotEqual(result.returncode, 0)

    def test_missing_completion_marker_fails(self) -> None:
        """A zero-exit command without its expected marker is not evidence."""
        with self.assertRaises(ValueError):
            require_markers("", ["expected:"])
        require_markers("expected: actual work passed", ["expected:"])

    def test_failed_command_is_not_success(self) -> None:
        """A failed child process makes its CI wrapper fail."""
        with self.assertRaises(RuntimeError):
            run_checked(["/usr/bin/env", "false"])

    def test_interrupt_reaps_direct_child_and_keeps_partial_log(self) -> None:
        """An interrupted owned adapter is reaped and its partial output remains."""
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "partial.log"
            worker = "import os,time; print(os.getpid(),flush=True); time.sleep(60)"
            wrapper = "import signal,sys; from check import interrupt,run_full; signal.signal(signal.SIGTERM,interrupt); run_full(sys.argv[1],[sys.executable,'-c',sys.argv[2]])"
            process = subprocess.Popen(
                [sys.executable, "-c", wrapper, str(log), worker],
                env=dict(os.environ, PYTHONPATH=str(Path(__file__).parent)),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                deadline = time.monotonic() + 10
                while (
                    not log.exists() or not log.read_text().strip()
                ) and time.monotonic() < deadline:
                    time.sleep(0.02)
                pid = int(log.read_text().strip())
                process.terminate()
                self.assertNotEqual(process.wait(timeout=15), 0)
                with self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)
                self.assertEqual(log.read_text().splitlines()[0], str(pid))
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()

    def test_inherited_output_does_not_block_child_exit(self) -> None:
        """An owned detached writer holding the log cannot block direct-child reaping."""
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "partial.log"
            pidfile = Path(directory) / "descendant.pid"
            child = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],start_new_session=True); open(sys.argv[1],'w').write(str(p.pid)); sys.exit(3)"
            wrapper = "import sys; from check import run_full; run_full(sys.argv[1],[sys.executable,'-c',sys.argv[2],sys.argv[3]])"
            try:
                result = subprocess.run(
                    [sys.executable, "-c", wrapper, str(log), child, str(pidfile)],
                    env=dict(os.environ, PYTHONPATH=str(Path(__file__).parent)),
                    capture_output=True,
                    timeout=5,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"full backend exited 3", result.stderr)
            finally:
                if pidfile.exists():
                    try:
                        os.kill(int(pidfile.read_text()), 15)
                    except ProcessLookupError:
                        pass

    def test_job_permission_override_is_rejected(self) -> None:
        """A job cannot widen the workflow's read-only token grant."""
        root = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "ci.yml"
            source = (root / ".github/workflows/ci.yml").read_text()
            fixture.write_text(
                source.replace(
                    "    runs-on: ubuntu-24.04",
                    "    permissions:\n      contents: write\n    runs-on: ubuntu-24.04",
                    1,
                )
            )
            script = "require './verification/ci/workflow_policy'; validate(ARGV[0], {'portable'=>{runner:'ubuntu-24.04',commands:[]},'native'=>{runner:'macos-15',commands:[]}})"
            result = subprocess.run(
                ["ruby", "-e", script, str(fixture)],
                cwd=root,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("job permissions override", result.stderr)

    def test_missing_native_tool_fails(self) -> None:
        """A native probe with an empty tool path refuses to pass."""
        result = subprocess.run(
            ["/bin/bash", str(Path(__file__).parent / "native-probe.sh")],
            env={"PATH": ""},
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing native tool:", result.stderr)

    def test_inventory_detects_late_invalid_script_and_zero(self) -> None:
        """The inventory checks all tracked scripts and rejects an empty inventory."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            with self.assertRaises(ValueError):
                shell_inventory(root)
            (root / "a.sh").write_text("true\n")
            (root / "b.sh").write_text("if\n")
            subprocess.run(["git", "add", "a.sh", "b.sh"], cwd=root, check=True)
            with self.assertRaises(subprocess.CalledProcessError):
                shell_inventory(root)
            (root / "b.sh").write_text("true\n")
            shell_inventory(root)


if __name__ == "__main__":
    unittest.main()
