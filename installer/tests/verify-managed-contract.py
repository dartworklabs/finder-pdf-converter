"""Exercise managed installation outcomes through its public process boundary.

Only the owned registration adapter is replaced. Files, native compilation,
signatures, installation, interruption, and recovery use their real adapters.
"""

# Python 3.9 executes annotations; Optional is intentional.
# ruff: noqa: FA100

import hashlib
import json
import os
import random
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from itertools import permutations
from pathlib import Path
from typing import Any, Optional

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "installer/managed-install.sh"
RESOURCES = (
    "locale.sh",
    "preferred-language.js",
    "convert.sh",
    "conversion-session.sh",
    "conversion-session.js",
    "conversion-status.js",
    "hancom.applescript",
    "word.applescript",
    "powerpoint.applescript",
    "excel.applescript",
    "image.js",
    "dng.js",
    "text.js",
    "markdown.js",
    "csv.js",
    "print-fit.sh",
    "print-fit.js",
    "print-panel.js",
    "review-model.js",
    "document-review.js",
)
WORKFLOWS = ("PDF로 변환.workflow", "용지에 맞춰 인쇄.workflow", "PDF 합치기.workflow")
MEMBERS = (
    "Contents/Info.plist",
    "Contents/document.wflow",
    "Contents/Resources/en.lproj/InfoPlist.strings",
    "Contents/Resources/ko.lproj/InfoPlist.strings",
)
BACKEND_FILES = (
    "install.sh",
    "doctor.sh",
    "installer/managed-install.sh",
    "installer/managed-engine.js",
    "installer/stage-managed.sh",
)
CODES = {
    "invalid-payload",
    "unsafe-path",
    "foreign-item",
    "modified-item",
    "legacy-source-unavailable",
    "owner-mismatch",
    "recovery-conflict",
    "write-failed",
    "operation-failed",
    "interrupted",
}


@contextmanager
def fixture_directory() -> Iterator[Path]:
    """Keep an opt-in durable failure copy while always cleaning temporary state."""
    with tempfile.TemporaryDirectory(prefix="fpdf-managed-contract-") as directory:
        base = Path(directory).resolve()
        try:
            yield base
        except BaseException:
            evidence = os.environ.get("FINDER_PDF_CONTRACT_EVIDENCE")
            if evidence:
                destination = Path(evidence)
                assert destination.is_absolute(), (
                    "evidence destination must be absolute"
                )
                destination.mkdir(parents=True, exist_ok=True)
                shutil.copytree(base, destination / "failed-fixture", symlinks=True)
                print(
                    "FAILURE FIXTURE: " + str(destination / "failed-fixture"),
                    flush=True,
                )
            raise


def snapshot(root: Path) -> dict[str, tuple[Any, ...]]:
    """Capture content, links and permissions without following untrusted links."""
    result: dict[str, tuple[Any, ...]] = {}
    if not root.exists() and not root.is_symlink():
        return result
    paths = [root]
    if root.is_dir() and not root.is_symlink():
        paths.extend(sorted(root.rglob("*")))
    for path in paths:
        info = path.lstat()
        relative = str(path.relative_to(root))
        metadata = (
            stat.S_IFMT(info.st_mode),
            stat.S_IMODE(info.st_mode),
            info.st_nlink,
            info.st_dev,
            info.st_ino,
            info.st_uid,
            info.st_gid,
            info.st_mtime_ns,
        )
        if path.is_symlink():
            result[relative] = metadata + (os.readlink(path),)
        elif path.is_file():
            result[relative] = metadata + (
                hashlib.sha256(path.read_bytes()).hexdigest(),
            )
        else:
            result[relative] = metadata
    return result


def payload_copy(destination: Path) -> None:
    """Copy only the declared runtime inventory, never a repository clone."""
    destination.mkdir(parents=True)
    for name in (*RESOURCES, *BACKEND_FILES):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / name, target)
    for workflow in WORKFLOWS:
        for member in MEMBERS:
            target = destination / workflow / member
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / workflow / member, target)


def support(home: Path) -> Path:
    """Locate this fixture user's stable managed installation directory."""
    return home / "Library/Application Support/Finder PDF Converter"


def live_snapshot(home: Path) -> dict[str, dict[str, tuple[Any, ...]]]:
    """Observe four target states while allowing harmless new parent directories."""
    result = {"source": snapshot(support(home) / "source")}
    for name in WORKFLOWS:
        result[name] = snapshot(home / "Library/Services" / name)
    return result


def invoke(
    home: Path,
    payload: Path,
    operation: str,
    *,
    fault: Optional[str] = None,
    crash: bool = False,
    registration_failure: Optional[str] = None,
    timeout: int = 120,
) -> subprocess.CompletedProcess[str]:
    """Call the real public backend with registration explicitly replaced."""
    environment = {**os.environ, "HOME": str(home), "FINDER_PDF_TEST_NO_REGISTER": "1"}
    environment.pop("FINDER_PDF_TEST_FAIL_STEP", None)
    environment.pop("FINDER_PDF_TEST_CRASH_STEP", None)
    environment.pop("FINDER_PDF_TEST_REGISTRATION_FAIL", None)
    if registration_failure is not None:
        environment["FINDER_PDF_TEST_REGISTRATION_FAIL"] = registration_failure
    if fault is not None:
        environment[
            "FINDER_PDF_TEST_CRASH_STEP" if crash else "FINDER_PDF_TEST_FAIL_STEP"
        ] = fault
    return subprocess.run(
        [
            "/bin/bash",
            str(payload / "installer/managed-install.sh"),
            operation,
            "--source-root",
            str(payload),
        ],
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def outcome(
    result: subprocess.CompletedProcess[str],
    operation: str,
    expected: Optional[set[str]] = None,
) -> dict[str, Any]:
    """Assert the frozen closed JSON and exit contract for every observed result."""
    try:
        envelope = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise AssertionError(
            f"{operation}: invalid JSON: {result.stdout!r}; {result.stderr}"
        ) from error
    assert isinstance(envelope, dict) and set(envelope) == {
        "schemaVersion",
        "operation",
        "outcome",
    }, envelope
    assert type(envelope["schemaVersion"]) is int and envelope["schemaVersion"] == 1, (
        envelope
    )
    assert envelope["operation"] == operation, envelope
    value = envelope["outcome"]
    assert isinstance(value, dict) and isinstance(value.get("kind"), str), envelope
    kind = value["kind"]
    if kind in {"fresh", "current", "update", "legacy"}:
        assert operation == "inspect" and set(value) == {"kind", "apps"}, envelope
        assert isinstance(value["apps"], dict) and set(value["apps"]) == {
            "hwp",
            "word",
            "powerpoint",
            "excel",
        }, envelope
        assert all(type(present) is bool for present in value["apps"].values()), (
            envelope
        )
        expected_exit = 0
    elif kind in {"installed", "recovered", "busy", "registration-required"}:
        assert set(value) == {"kind"}, envelope
        assert operation != "inspect", envelope
        assert kind != "installed" or operation == "install", envelope
        assert kind != "recovered" or operation == "recover", envelope
        expected_exit = 1 if kind in {"busy", "registration-required"} else 0
    else:
        assert kind in {
            "conflict",
            "recovery-required",
            "restored",
            "invalid-request",
            "failed",
        }, envelope
        assert set(value) == {"kind", "code"} and value["code"] in CODES, envelope
        assert kind != "restored" or operation != "inspect", envelope
        expected_exit = 2 if kind == "invalid-request" else 1
    assert result.returncode == expected_exit, (
        envelope,
        result.returncode,
        result.stderr,
    )
    assert str(Path.home()) not in result.stdout and "/Library/" not in result.stdout, (
        envelope
    )
    if expected is not None:
        assert kind in expected, (expected, envelope, result.stderr)
    return value


def expect(
    home: Path,
    payload: Path,
    operation: str,
    kinds: set[str],
    *,
    fault: Optional[str] = None,
    timeout: int = 120,
) -> dict[str, Any]:
    """Require one public outcome while preserving the complete diagnostic on failure."""
    return outcome(
        invoke(home, payload, operation, fault=fault, timeout=timeout), operation, kinds
    )


def inspect_unchanged(home: Path, payload: Path, kinds: set[str]) -> dict[str, Any]:
    """Inspection classifies state without creating or changing user files."""
    before = snapshot(home)
    value = expect(home, payload, "inspect", kinds)
    assert snapshot(home) == before, "inspect modified the user's filesystem"
    return value


def test_malformed_requests(base: Path, payload: Path) -> None:
    """Malformed known operations return one invalid-request JSON without writes."""
    home = base / "invalid-request-home"
    home.mkdir()
    environment = {**os.environ, "HOME": str(home), "FINDER_PDF_TEST_NO_REGISTER": "1"}
    count = 0
    for operation in ("inspect", "install", "recover"):
        for arguments in (
            [operation],
            [operation, "--source-root"],
            [operation, str(payload)],
            [operation, "--source-root", "relative-path"],
            [operation, "--source-root", str(payload), "extra"],
        ):
            before = snapshot(home)
            result = subprocess.run(
                [
                    "/bin/bash",
                    str(payload / "installer/managed-install.sh"),
                    *arguments,
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            outcome(result, operation, {"invalid-request"})
            assert snapshot(home) == before, "malformed request changed user files"
            count += 1
    print(
        f"PASS: {count} malformed requests return exit2/single JSON without writes",
        flush=True,
    )


def verify_installed(home: Path) -> None:
    """Verify stable physical ownership and actual native helper signatures."""
    owner = support(home) / "source"
    assert owner.is_dir() and not owner.is_symlink(), (
        "managed source must be a real directory"
    )
    for name in WORKFLOWS:
        assert os.readlink(
            home / "Library/Services" / name / "Contents/project"
        ) == str(owner), name
    resources = home / "Library/Services" / WORKFLOWS[0] / "Contents/Resources"
    for name in ("Finder PDF Review.app", "Finder PDF Print.app"):
        app = resources / name
        assert (app / "Contents/Resources/finder-pdf-owner").read_text() == str(
            owner
        ), name
        checked = subprocess.run(
            ["/usr/bin/codesign", "--verify", "--strict", str(app)],
            check=False,
            capture_output=True,
        )
        assert checked.returncode == 0, (name, checked.stderr)


def refusal_preserves(home: Path, payload: Path) -> None:
    """Both read-only inspection and attempted install preserve conflicting files."""
    inspect_unchanged(home, payload, {"conflict", "invalid-request", "failed"})
    before = snapshot(home)
    expect(home, payload, "install", {"conflict", "invalid-request", "failed"})
    assert snapshot(home) == before, "refused install changed the user's filesystem"


def test_download_independence(
    base: Path, payload: Path, *, hosted_full: bool = False
) -> Path:
    """Install, delete the first download, and update from a differently named copy."""
    home = base / "한글 'quoted' $ user\n"
    home.mkdir()
    inspect_unchanged(home, payload, {"fresh"})
    expect(home, payload, "install", {"installed"})
    verify_installed(home)
    inspect_unchanged(home, payload, {"current"})
    moved = payload.with_name("한글 new download ' $ copied\n")
    shutil.copytree(payload, moved)
    shutil.rmtree(payload)
    try:
        inspect_unchanged(home, moved, {"current"})
        changed = moved / "convert.sh"
        changed.write_bytes(changed.read_bytes() + b"\n# contract-test update\n")
        inspect_unchanged(home, moved, {"update"})
        if hosted_full:
            print("BUDGET moved-download update install 240s", flush=True)
        expect(
            home, moved, "install", {"installed"}, timeout=240 if hosted_full else 120
        )
        assert (
            support(home) / "source/convert.sh"
        ).read_bytes() == changed.read_bytes()
        verify_installed(home)
        inspect_unchanged(home, moved, {"current"})
    finally:
        moved.rename(payload)
    print(
        "PASS: fresh/current/update, deleted download path, stable native ownership",
        flush=True,
    )
    return home


def test_conflicts(base: Path, payload: Path, home: Path) -> None:
    """Reject foreign, modified, linked, and ambiguous existing objects intact."""
    for index, name in enumerate(WORKFLOWS):
        foreign_home = base / f"foreign-{index}"
        target = foreign_home / "Library/Services" / name
        target.mkdir(parents=True)
        (target / "foreign.txt").write_text("preserve unrelated data")
        refusal_preserves(foreign_home, payload)
    resources = home / "Library/Services" / WORKFLOWS[0] / "Contents/Resources"
    modified = resources / "Finder PDF Print.app/Contents/Info.plist"
    saved = modified.read_bytes()
    modified.write_bytes(saved + b"\n")
    refusal_preserves(home, payload)
    modified.write_bytes(saved)
    empty = resources / "Finder PDF Print.app/Contents/Resources/extra-empty"
    empty.mkdir()
    refusal_preserves(home, payload)
    empty.rmdir()
    extra = home / "Library/Services" / WORKFLOWS[2] / "Contents/unknown.txt"
    extra.write_text("keep me")
    refusal_preserves(home, payload)
    extra.unlink()
    project = home / "Library/Services" / WORKFLOWS[1] / "Contents/project"
    owner = os.readlink(project)
    project.unlink()
    project.symlink_to(str(base / "different owner"))
    refusal_preserves(home, payload)
    project.unlink()
    project.symlink_to(owner)
    modified = resources / "convert.sh"
    saved = modified.read_bytes()
    mode = modified.stat().st_mode
    modified.unlink()
    sentinel = base / "hardlink-sentinel"
    sentinel.write_bytes(saved)
    os.link(sentinel, modified)
    refusal_preserves(home, payload)
    assert sentinel.read_bytes() == saved
    modified.unlink()
    modified.write_bytes(saved)
    modified.chmod(stat.S_IMODE(mode))
    outside = base / "outside-services"
    outside.mkdir()
    linked_home = base / "unsafe-parent"
    (linked_home / "Library").mkdir(parents=True)
    (linked_home / "Library/Services").symlink_to(outside)
    before = snapshot(outside)
    refusal_preserves(linked_home, payload)
    assert snapshot(outside) == before
    readonly_home = base / "read-only-services"
    readonly_services = readonly_home / "Library/Services"
    readonly_services.mkdir(parents=True)
    readonly_services.chmod(0o555)
    before_targets = live_snapshot(readonly_home)
    try:
        expect(readonly_home, payload, "install", {"failed", "restored"})
        assert live_snapshot(readonly_home) == before_targets, (
            "read-only destination left a partial installation"
        )
    finally:
        readonly_services.chmod(0o755)
    print(
        "PASS: foreign names, helper tamper, extra members, owner disagreement, hardlink, unsafe/read-only parents",
        flush=True,
    )


def test_payload_rejection(base: Path, payload: Path) -> None:
    """Generated unexpected members and linked payload files never reach live targets."""
    home = base / "invalid-payload-home"
    home.mkdir()
    generator = random.Random(20261105)
    for index in range(8):
        name = (
            "unknown-"
            + "".join(generator.choice("ab  한글'$") for _ in range(10))
            + str(index)
        )
        unexpected = payload / name
        unexpected.write_text("foreign payload")
        try:
            refusal_preserves(home, payload)
        finally:
            unexpected.unlink()
    candidate = payload / "convert.sh"
    saved, mode = candidate.read_bytes(), candidate.stat().st_mode
    sentinel = base / "payload-sentinel"
    sentinel.write_bytes(saved)
    candidate.unlink()
    candidate.symlink_to(sentinel)
    try:
        refusal_preserves(home, payload)
        assert sentinel.read_bytes() == saved
    finally:
        candidate.unlink()
        candidate.write_bytes(saved)
        candidate.chmod(stat.S_IMODE(mode))
    candidate.unlink()
    os.link(sentinel, candidate)
    try:
        refusal_preserves(home, payload)
    finally:
        candidate.unlink()
        candidate.write_bytes(saved)
        candidate.chmod(stat.S_IMODE(mode))
    with candidate.open("r+b") as oversized:
        oversized.truncate(101 * 1024 * 1024)
    try:
        refusal_preserves(home, payload)
    finally:
        candidate.write_bytes(saved)
    review = payload / "document-review.js"
    review_source = review.read_bytes()
    review.write_text("function run( { definitely invalid JavaScript")
    before = live_snapshot(home)
    try:
        value = expect(home, payload, "install", {"failed", "recovery-required"})
        assert live_snapshot(home) == before, (
            "native compilation failure changed live targets"
        )
        if value["kind"] == "recovery-required":
            assert (support(home) / "transaction").is_dir(), (
                "partial staging evidence was discarded"
            )
    finally:
        review.write_bytes(review_source)
    print(
        "PASS: seeded names, links and oversized payload rejected; compilation failure preserves targets",
        flush=True,
    )


def test_legacy(
    base: Path, payload: Path, *, hosted_full: bool = False
) -> None:
    """Adopt only a fully verified legacy source and preserve missing-source installs."""
    home = base / "legacy-home"
    home.mkdir()
    legacy_parent = base / "legacy-parent"
    legacy_parent.mkdir()
    legacy = legacy_parent / "source"
    shutil.copytree(payload, legacy)
    result = subprocess.run(
        ["/bin/bash", str(legacy / "install.sh"), "--no-register"],
        env={**os.environ, "HOME": str(home)},
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    executed = base / "old-source-script-was-executed"
    for name in ("doctor.sh", "install.sh"):
        (legacy / name).write_text(
            "#!/bin/bash\ntouch " + shlex.quote(str(executed)) + "\nexit 97\n"
        )
    inspect_unchanged(home, payload, {"legacy"})
    assert not executed.exists(), "inspection executed a legacy source's script"
    real_parent = base / "legacy-real-parent"
    legacy_parent.rename(real_parent)
    legacy_parent.symlink_to(real_parent)
    try:
        refusal_preserves(home, payload)
    finally:
        legacy_parent.unlink()
        real_parent.rename(legacy_parent)
    linked = legacy / "convert.sh"
    saved, info = linked.read_bytes(), linked.stat()
    sentinel = base / "legacy-hardlink-sentinel"
    sentinel.write_bytes(saved)
    linked.unlink()
    os.link(sentinel, linked)
    try:
        refusal_preserves(home, payload)
        assert sentinel.read_bytes() == saved
    finally:
        linked.unlink()
        linked.write_bytes(saved)
        linked.chmod(stat.S_IMODE(info.st_mode))
        os.utime(linked, ns=(info.st_atime_ns, info.st_mtime_ns))
    unavailable = legacy.with_name("temporarily-moved-legacy")
    legacy.rename(unavailable)
    try:
        value = inspect_unchanged(home, payload, {"conflict"})
        assert value["code"] == "legacy-source-unavailable", value
        refusal_preserves(home, payload)
    finally:
        unavailable.rename(legacy)
    source_before = snapshot(legacy)
    if hosted_full:
        print("BUDGET verified legacy adoption install 240s", flush=True)
    expect(
        home, payload, "install", {"installed"}, timeout=240 if hosted_full else 120
    )
    assert not executed.exists(), "adoption executed a legacy source's script"
    verify_installed(home)
    assert snapshot(legacy) == source_before, "adoption changed legacy source"
    inspect_unchanged(home, payload, {"current"})
    print(
        "PASS: verified legacy adoption; missing source, source-parent link and source hardlink preserved",
        flush=True,
    )


def test_managed_cli_refusal(home: Path) -> None:
    """The installed payload cannot bypass managed transactions through legacy CLI."""
    before = snapshot(home)
    result = subprocess.run(
        ["/bin/bash", str(support(home) / "source/install.sh"), "--no-register"],
        env={**os.environ, "HOME": str(home)},
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert result.returncode != 0, "managed source legacy CLI bypassed its receipt"
    assert snapshot(home) == before, "managed source legacy CLI changed user files"
    print("PASS: managed source rejects legacy CLI without writes", flush=True)


def test_registration_failure(
    base: Path, payload: Path, *, hosted_full: bool = False
) -> None:
    """A registration failure reports installed files without claiming menu readiness."""
    home = base / "registration-failure-home"
    home.mkdir()
    for failure in ("flush", "update"):
        value = outcome(
            invoke(home, payload, "install", registration_failure=failure),
            "install",
            {"registration-required"},
        )
        assert value == {"kind": "registration-required"}
        verify_installed(home)
        assert not (support(home) / "transaction").exists()
        inspect_unchanged(home, payload, {"current"})
        if hosted_full:
            print(f"BUDGET registration {failure} committed crash install 240s", flush=True)
        crashed = invoke(
            home, payload, "install", fault="committed", crash=True,
            timeout=240 if hosted_full else 120,
        )
        assert crashed.returncode != 0
        before = live_snapshot(home)
        value = inspect_unchanged(home, payload, {"recovery-required"})
        assert value["code"] == "interrupted", value
        outcome(
            invoke(home, payload, "recover", registration_failure=failure),
            "recover",
            {"registration-required"},
        )
        assert live_snapshot(home) == before
        assert not (support(home) / "transaction").exists()
        inspect_unchanged(home, payload, {"current"})
    print(
        "PASS: registration flush/update failures are exit1 after verified install and committed recovery",
        flush=True,
    )


def test_all_backup_preflight(home: Path, payload: Path) -> None:
    """A changed last backup prevents disposal of every earlier committed preimage."""
    crashed = invoke(home, payload, "install", fault="committed", crash=True)
    assert crashed.returncode != 0
    transaction = support(home) / "transaction"
    changed = transaction / "backup-3/Contents/Info.plist"
    info = changed.stat()
    changed.chmod(stat.S_IMODE(info.st_mode) ^ 0o100)
    before, live = snapshot(transaction), live_snapshot(home)
    value = expect(home, payload, "recover", {"recovery-required"})
    assert value["code"] == "recovery-conflict", value
    assert snapshot(transaction) == before, (
        "conflicting last backup lost earlier preimages"
    )
    assert live_snapshot(home) == live
    changed.chmod(stat.S_IMODE(info.st_mode))
    expect(home, payload, "recover", {"recovered"})
    assert live_snapshot(home) == live
    print(
        "PASS: last-backup conflict preserves every earlier committed preimage",
        flush=True,
    )


def test_concurrent_install(base: Path, payload: Path) -> None:
    """Two real managed/legacy processes cannot mutate the same home concurrently."""
    home = base / "concurrent-home"
    home.mkdir()
    environment = {
        **os.environ,
        "HOME": str(home),
        "FINDER_PDF_TEST_NO_REGISTER": "1",
    }
    first = subprocess.Popen(
        [
            "/bin/bash",
            str(payload / "installer/managed-install.sh"),
            "install",
            "--source-root",
            str(payload),
        ],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 60
        while not (support(home) / "transaction").exists():
            assert first.poll() is None, first.communicate()
            assert time.monotonic() < deadline, "first install never began staging"
            time.sleep(0.01)
        expect(home, payload, "install", {"busy"})
        legacy = subprocess.run(
            ["/bin/bash", str(payload / "install.sh"), "--no-register"],
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        assert legacy.returncode != 0, "legacy CLI bypassed the managed install lock"
        stdout, stderr = first.communicate(timeout=120)
        outcome(
            subprocess.CompletedProcess(first.args, first.returncode, stdout, stderr),
            "install",
            {"installed"},
        )
        verify_installed(home)
    finally:
        if first.poll() is None:
            first.kill()
            first.communicate()
    print("PASS: real concurrent managed and legacy installation serialize", flush=True)


def process_table() -> dict[int, tuple[int, int, str, str]]:
    """Read identity and executable names without collecting unrelated arguments."""
    result = subprocess.run(
        ["/bin/ps", "-axo", "pid=,ppid=,pgid=,state=,comm="],
        capture_output=True,
        text=True,
        check=True,
        timeout=5,
    )
    table = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 4)
        if len(fields) == 5:
            table[int(fields[0])] = (
                int(fields[1]),
                int(fields[2]),
                fields[3],
                fields[4],
            )
    return table


def process_descendants(
    root: int, table: dict[int, tuple[int, int, str, str]]
) -> set[int]:
    """Bind process operations to descendants of the process this fixture launched."""
    result = {root}
    while True:
        expanded = result | {pid for pid, item in table.items() if item[0] in result}
        if result == expanded:
            return result
        result = expanded


def stop_owned_group(group: int) -> None:
    """Reap a verified isolated test group before allowing filesystem recovery."""
    assert group != os.getpgrp(), "refuse to signal the test driver's process group"
    for instruction, seconds in ((signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(group, signal.SIGCONT)
            os.killpg(group, instruction)
        except ProcessLookupError:
            return
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if not any(
                item[1] == group and not item[2].startswith("Z")
                for item in process_table().values()
            ):
                return
            time.sleep(0.02)
    raise AssertionError("owned stage process group did not stop")


def test_stage_child_lock_survives_engine_death(base: Path, payload: Path) -> None:
    """An actual paused compiler retains the install lock after its engine is killed."""
    # This serial lock phase precedes ThreadPoolExecutor creation. The external
    # Perl wrapper sets only a PGID and keeps the driver's session for the peer.
    home = base / "stage-child-lock-home"
    home.mkdir()
    before = live_snapshot(home)
    stage_script = support(home) / "transaction/stage-app.js"
    environment = {**os.environ, "HOME": str(home), "FINDER_PDF_TEST_NO_REGISTER": "1"}
    group = None
    parent = None
    guardian = None

    def lock_status() -> int:
        """Probe the same real directory lock without changing any fixture files."""
        result = subprocess.run(
            [
                "/bin/bash",
                "-c",
                'exec 9<"$1"; /usr/bin/lockf -s -t 0 9',
                "owned-lock-probe",
                str(support(home)),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=10,
        )
        return result.returncode

    with (base / "stage-child-engine.log").open("wb") as output:
        try:
            parent = subprocess.Popen(
                [
                    "/usr/bin/perl",
                    "-MPOSIX",
                    "-e",
                    "POSIX::setpgid(0,0) == 0 or die $!; exec @ARGV or die $!",
                    "/bin/bash",
                    str(payload / "installer/managed-install.sh"),
                    "install",
                    "--source-root",
                    str(payload),
                ],
                env=environment,
                stdout=output,
                stderr=output,
            )
            deadline = time.monotonic() + 120
            compiler = None
            while compiler is None:
                assert parent.poll() is None, "engine exited before native compilation"
                assert time.monotonic() < deadline, (
                    "actual native compiler was not observed"
                )
                if not stage_script.exists():
                    time.sleep(0.01)
                    continue
                table = process_table()
                owned = process_descendants(parent.pid, table)
                for pid in owned - {parent.pid}:
                    item = table[pid]
                    if Path(item[3]).name != "osacompile" or item[2].startswith("Z"):
                        continue
                    group = item[1]
                    assert group in owned and table[group][0] == parent.pid
                    assert table[group][1] == group and group != os.getpgrp()
                    try:
                        assert os.getpgid(pid) == group
                        os.kill(pid, signal.SIGSTOP)
                    except ProcessLookupError:
                        group = None
                        continue
                    stopped_deadline = time.monotonic() + 1
                    stopped = process_table()
                    while (
                        pid in stopped
                        and not stopped[pid][2].startswith(("T", "Z"))
                        and time.monotonic() < stopped_deadline
                    ):
                        stopped = process_table()
                    if pid not in stopped or stopped[pid][2].startswith("Z"):
                        group = None
                        continue
                    assert stopped[pid][1] == group and stopped[pid][2].startswith("T")
                    compiler = pid
                    break
            # A stopped orphaned POSIX group receives HUP/CONT on parent death.
            # This owned pipe-wait peer prevents that unrelated lifecycle event.
            # Its stdin is a fresh pipe; it inherits no installation lock.
            guardian = subprocess.Popen(
                [
                    "/usr/bin/perl",
                    "-MPOSIX",
                    "-e",
                    "POSIX::setpgid(0,$ARGV[0]) == 0 or die $!; sysread(STDIN,my $byte,1)",
                    str(group),
                ],
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=output,
                close_fds=True,
            )
            guardian_deadline = time.monotonic() + 5
            while os.getpgid(guardian.pid) != group:
                assert guardian.poll() is None, "owned group guardian exited"
                assert time.monotonic() < guardian_deadline, (
                    "guardian did not join owned group"
                )
                time.sleep(0.01)
            assert lock_status() == 75, "engine did not hold its real directory lock"
            print(
                f"OBSERVED: actual compiler={compiler}, owned stage group={group}",
                flush=True,
            )
            parent.kill()
            parent.wait(timeout=5)
            assert os.getpgid(compiler) == group
            surviving = process_table()[compiler]
            assert surviving[1] == group and surviving[2].startswith("T")
            print(
                "OBSERVED: compiler remains alive/stopped after engine death",
                flush=True,
            )
            assert lock_status() == 75, (
                "stage child released directory lock after engine death"
            )
            preserved = snapshot(home)
            expect(home, payload, "install", {"busy"})
            expect(home, payload, "recover", {"busy"})
            legacy = subprocess.run(
                ["/bin/bash", str(payload / "install.sh"), "--no-register"],
                env=environment,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            assert legacy.returncode != 0, (
                "legacy CLI bypassed the surviving stage lock"
            )
            assert snapshot(home) == preserved, "contenders changed an active stage"
            stop_owned_group(group)
            group = None
            guardian.wait(timeout=5)
            assert lock_status() == 0, "finished stage retained the directory lock"
            expect(home, payload, "recover", {"recovered"})
            assert live_snapshot(home) == before, (
                "stage-only crash changed a live target"
            )
            inspect_unchanged(home, payload, {"fresh"})
        finally:
            groups = {group} if group is not None else set()
            if parent is not None and parent.poll() is None:
                os.kill(parent.pid, signal.SIGSTOP)
                table = process_table()
                groups.update(
                    table[pid][1]
                    for pid in process_descendants(parent.pid, table)
                    if pid in table
                )
                parent.kill()
                parent.wait(timeout=5)
            for owned_group in groups:
                stop_owned_group(owned_group)
            if guardian is not None:
                if guardian.poll() is None:
                    guardian.kill()
                guardian.wait(timeout=5)
                if guardian.stdin is not None:
                    guardian.stdin.close()
    print(
        "PASS: actual compiler survives engine death; managed/legacy contenders busy; recovery safe",
        flush=True,
    )


def test_managed_receipt_tampering(home: Path, payload: Path) -> None:
    """Signed helper attestation rejects source, receipt, or consistent forged pairs."""
    source = support(home) / "source"
    script = source / "install.sh"
    receipt = source / ".finder-pdf-receipt.json"
    saved_script, saved_receipt = script.read_bytes(), receipt.read_bytes()
    script_info, receipt_info = script.stat(), receipt.stat()
    changed_script = saved_script + b"\n# external managed source mutation\n"
    for changed in ("script", "receipt", "both", "script-mode", "script-mtime"):
        try:
            if changed in {"script", "both"}:
                script.write_bytes(changed_script)
                os.utime(script, ns=(script_info.st_atime_ns, script_info.st_mtime_ns))
            if changed == "script-mode":
                script.chmod(stat.S_IMODE(script_info.st_mode) ^ 0o100)
            if changed == "script-mtime":
                os.utime(
                    script,
                    ns=(
                        script_info.st_atime_ns,
                        script_info.st_mtime_ns + 1_000_000_000,
                    ),
                )
            if changed == "receipt":
                receipt.write_bytes(saved_receipt + b"\n")
            if changed == "both":
                forged = json.loads(saved_receipt)
                entry = next(item for item in forged if item[0] == "install.sh")
                entry[2] = hashlib.sha256(changed_script).hexdigest()
                receipt.write_text(
                    json.dumps(forged, ensure_ascii=False, separators=(",", ":"))
                )
            inspect_unchanged(home, payload, {"conflict"})
            refusal_preserves(home, payload)
        finally:
            script.write_bytes(saved_script)
            script.chmod(stat.S_IMODE(script_info.st_mode))
            receipt.write_bytes(saved_receipt)
            os.utime(script, ns=(script_info.st_atime_ns, script_info.st_mtime_ns))
            os.utime(receipt, ns=(receipt_info.st_atime_ns, receipt_info.st_mtime_ns))
    inspect_unchanged(home, payload, {"current"})
    print(
        "PASS: managed source, receipt and internally consistent forged receipt pair rejected",
        flush=True,
    )


def test_metadata_edit_survives_recovery(home: Path, payload: Path) -> None:
    """Recovery preserves postimage chmod or mtime edits even when bytes match."""
    for changed in ("mode", "mtime"):
        before_install = live_snapshot(home)
        crashed = invoke(home, payload, "install", fault="install-3", crash=True)
        assert crashed.returncode != 0
        edited = home / "Library/Services" / WORKFLOWS[2] / "Contents/Info.plist"
        info, contents = edited.stat(), edited.read_bytes()
        if changed == "mode":
            edited.chmod(stat.S_IMODE(info.st_mode) ^ 0o100)
        else:
            os.utime(edited, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000_000))
        external_edit = snapshot(edited)
        expect(home, payload, "recover", {"recovery-required"})
        assert snapshot(edited) == external_edit and edited.read_bytes() == contents
        assert any((support(home) / "transaction").glob("backup-*")), (
            "metadata conflict discarded backups"
        )
        edited.chmod(stat.S_IMODE(info.st_mode))
        os.utime(edited, ns=(info.st_atime_ns, info.st_mtime_ns))
        expect(home, payload, "recover", {"recovered"})
        assert live_snapshot(home) == before_install, (
            "restored metadata failed to unlock safe recovery"
        )
        print(
            "PASS: concurrent same-byte "
            + changed
            + " edit and backups survive recovery",
            flush=True,
        )


def recovery_case_ids(indices: tuple[int, ...]) -> set[str]:
    """Describe one lane's observable cases independently of execution order."""
    return {
        f"{present}-{phase}-{index}-{crash}"
        for index in indices
        for crash in (False, True)
        for present, phases in (
            (False, ("before-install", "install")),
            (True, ("before-install", "install", "before-backup", "backup")),
        )
        for phase in phases
    }


def validate_recovery_partitions(partitions: tuple[tuple[int, ...], ...]) -> None:
    """Require all 48 original cases exactly once before starting native work."""
    assert len(partitions) in {1, 2}
    expected = {
        f"{present}-{phase}-{index}-{crash}"
        for present, phase in (
            (False, "before-install"),
            (False, "install"),
            (True, "before-install"),
            (True, "install"),
            (True, "before-backup"),
            (True, "backup"),
        )
        for index in (0, 1, 2, 3)
        for crash in (False, True)
    }
    ledgers = []
    for indices in partitions:
        assert len(indices) == len(set(indices))
        assert set(indices) <= {0, 1, 2, 3}
        assert len(indices) == (4 if len(partitions) == 1 else 2)
        ledgers.append(recovery_case_ids(indices))
    flattened = [case for ledger in ledgers for case in ledger]
    assert len(flattened) == len(set(flattened)) == 48
    assert set(flattened) == expected


def test_recovery_partition_properties() -> None:
    """Every index ordering preserves exact coverage; missing/duplicate indices fail."""
    validate_recovery_partitions(((0, 1, 2, 3),))
    for order in permutations((0, 1, 2, 3)):
        validate_recovery_partitions((order[::2], order[1::2]))
    for invalid in (((0,), (1, 3)), ((0, 2), (2, 3)), ((0, 2), (1, 4))):
        try:
            validate_recovery_partitions(invalid)
        except AssertionError:
            pass
        else:
            raise AssertionError("invalid recovery partition was accepted")
    print(
        "PASS: exhaustive recovery partition coverage and rejection properties",
        flush=True,
    )


def recovery_lane_plan(
    base: Path, home: Path, jobs: int
) -> tuple[tuple[Path, tuple[int, ...]], ...]:
    """Bind each partition to one separate native installation owner."""
    assert jobs in {1, 2}
    if jobs == 1:
        plan = ((home, (0, 1, 2, 3)),)
    else:
        plan = (
            (home, (0, 2)),
            (base / "한글 'quoted' $ parallel user 1\n", (1, 3)),
        )
    assert len({owner for owner, _ in plan}) == jobs
    validate_recovery_partitions(tuple(indices for _, indices in plan))
    return plan


def test_recovery_lane_plan() -> None:
    """Pure scheduling preserves the original owner and never shares a lane home."""
    base = Path("/contract-fixture")
    original = base / "installed-home"
    for jobs in (1, 2):
        plan = recovery_lane_plan(base, original, jobs)
        assert len(plan) == jobs and plan[0][0] == original
        assert len({owner for owner, _ in plan}) == jobs
        assert all(owner.parent == base for owner, _ in plan)
        assert [len(recovery_case_ids(indices)) for _, indices in plan] == (
            [48] if jobs == 1 else [24, 24]
        )
    print("PASS: pure native-case scheduling uses independent HOME owners", flush=True)


def test_recovery(
    base: Path,
    payload: Path,
    present_home: Path,
    indices: tuple[int, ...] = (0, 1, 2, 3),
) -> list[str]:
    """Every target rename either restores prior state or leaves recoverable evidence."""
    completed = []
    for present in (False, True):
        for phase in ("before-install", "install", "before-backup", "backup"):
            if not present and "backup" in phase:
                continue
            for index in indices:
                for crash in (False, True):
                    label = f"{present}-{phase}-{index}-{crash}"
                    home = present_home if present else base / ("recover-" + label)
                    home.mkdir(exist_ok=True)
                    before = live_snapshot(home)
                    result = invoke(
                        home, payload, "install", fault=f"{phase}-{index}", crash=crash
                    )
                    if crash:
                        assert result.returncode != 0, (
                            f"crash adapter did not stop {label}"
                        )
                        interrupted = inspect_unchanged(
                            home, payload, {"recovery-required"}
                        )
                        assert interrupted["code"] == "interrupted", interrupted
                        expect(home, payload, "recover", {"recovered"})
                    else:
                        outcome(result, "install", {"restored"})
                    assert live_snapshot(home) == before, (
                        f"prior complete set not restored: {label}"
                    )
                    inspect_unchanged(
                        home, payload, {"current"} if present else {"fresh"}
                    )
                    print("PASS: recovery " + label, flush=True)
                    completed.append(label)
    assert len(completed) == len(set(completed)) == 12 * len(indices)
    assert set(completed) == recovery_case_ids(indices)
    return completed


def test_recovery_lanes(base: Path, payload: Path, home: Path, jobs: int) -> None:
    """Run unchanged filesystem assertions in isolated ownership lanes and join all."""
    plan = recovery_lane_plan(base, home, jobs)
    before = snapshot(payload)
    if jobs == 1:
        ledgers = [test_recovery(base, payload, home)]
    else:
        other = plan[1][0]
        other.mkdir()
        expect(other, payload, "install", {"installed"})
        verify_installed(other)
        print(
            "PASS: second lane has an independent real native ownership baseline",
            flush=True,
        )
        # __exit__(wait=True) joins both owned lanes even if either result raises.
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(test_recovery, base, payload, owner, indices)
                for owner, indices in plan
            ]
            ledgers = [future.result() for future in futures]
    assert snapshot(payload) == before, "recovery lanes changed the shared payload"
    flattened = [case for ledger in ledgers for case in ledger]
    assert len(flattened) == len(set(flattened)) == 48
    assert set(flattened) == recovery_case_ids((0, 1, 2, 3))
    for index, ledger in enumerate(ledgers):
        print(f"LEDGER lane{index} " + json.dumps(ledger), flush=True)
    print(
        f"PASS: {jobs} recovery lane(s), exactly48 unique real native cases", flush=True
    )


def test_external_edit_and_journal(base: Path, payload: Path, home: Path) -> None:
    """Recovery preserves a concurrent edit and rejects journal path escape data."""
    result = invoke(home, payload, "install", fault="install-1", crash=True)
    assert result.returncode != 0
    changed = home / "Library/Services" / WORKFLOWS[0] / "Contents/foreign-edit.txt"
    changed.write_text("external writer owns this change")
    expect(home, payload, "recover", {"recovery-required"})
    assert changed.read_text() == "external writer owns this change"
    transaction = support(home) / "transaction"
    assert transaction.is_dir() and any(transaction.glob("backup-*")), (
        "backups/evidence were discarded"
    )
    malformed_home = base / "malformed-journal-home"
    journal = support(malformed_home) / "transaction/journal.json"
    journal.parent.mkdir(parents=True)
    support(malformed_home).chmod(0o700)
    journal.parent.chmod(0o700)
    outside = base / "journal-escape-sentinel"
    outside.write_text("foreign data")
    invalid_values = [
        {
            "schemaVersion": 1,
            "targets": [
                {"target": str(outside), "backup": "../../journal-escape-sentinel"}
            ],
        },
        {"schemaVersion": 1, "entries": ["../" * 30]},
        {"schemaVersion": 999},
    ]
    actual_journal = (transaction / "journal.json").read_text()
    actual_value = json.loads(actual_journal)
    bad_snapshot = json.loads(actual_journal)
    bad_snapshot["new"] = [{"unexpected": True}] * 4
    invalid_values.append(bad_snapshot)
    escaped_snapshot = json.loads(actual_journal)
    escaped_snapshot["old"][0][1][0] = "../../journal-escape-sentinel"
    invalid_values.append(escaped_snapshot)
    malformed_snapshot = json.loads(actual_journal)
    malformed_snapshot["old"] = [[None]] * 4
    invalid_values.append(malformed_snapshot)
    invalid_texts = [
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        for value in invalid_values
    ]
    invalid_texts.extend(
        [
            actual_journal.replace('"version":1', '"version":1,"version":1', 1),
            actual_journal.replace('"step":', '"step":"ready","step":', 1),
            json.dumps(actual_value, ensure_ascii=False, indent=2),
        ]
    )
    for invalid_text in invalid_texts:
        journal.write_text(invalid_text)
        journal.chmod(0o600)
        before = snapshot(journal.parent)
        value = inspect_unchanged(malformed_home, payload, {"recovery-required"})
        assert value["code"] == "recovery-conflict", value
        expect(malformed_home, payload, "recover", {"recovery-required"})
        assert (
            snapshot(journal.parent) == before and outside.read_text() == "foreign data"
        )
    print(
        "PASS: concurrent edit and backup retention; malformed/path-escape journal preserved",
        flush=True,
    )


def test_interrupted_recovery_and_commit(payload: Path, home: Path) -> None:
    """A second crash during rollback or committed cleanup remains recoverable."""
    for index in range(4):
        before = live_snapshot(home)
        crashed = invoke(home, payload, "install", fault="install-3", crash=True)
        assert crashed.returncode != 0, "preparation did not interrupt install"
        interrupted = invoke(
            home, payload, "recover", fault=f"retire-{index}", crash=True
        )
        assert interrupted.returncode != 0, (
            "retirement adapter did not interrupt recovery"
        )
        inspect_unchanged(home, payload, {"recovery-required"})
        expect(home, payload, "recover", {"recovered"})
        assert live_snapshot(home) == before, (
            f"second recovery did not restore target {index}"
        )
        print(f"PASS: repeated recovery after retire-{index}", flush=True)
    for phase in ("committed", "cleanup-0", "cleanup-1", "cleanup-2", "cleanup-3"):
        crashed = invoke(home, payload, "install", fault=phase, crash=True)
        assert crashed.returncode != 0, f"committed adapter did not interrupt {phase}"
        installed = live_snapshot(home)
        verify_installed(home)
        inspect_unchanged(home, payload, {"recovery-required"})
        expect(home, payload, "recover", {"recovered"})
        assert live_snapshot(home) == installed, (
            f"finalization replaced committed targets: {phase}"
        )
        inspect_unchanged(home, payload, {"current"})
        print("PASS: committed finalization after " + phase, flush=True)


def test_preparation_recovery(base: Path, payload: Path, present_home: Path) -> None:
    """Preparation failure/crash preserves all live targets and unknown staged data."""
    for present in (False, True):
        for phase in ("preparing", "stage-complete"):
            for crash in (False, True):
                label = f"{present}-{phase}-{crash}"
                home = present_home if present else base / ("preparation-" + label)
                home.mkdir(exist_ok=True)
                before = live_snapshot(home)
                retained_before = set(support(home).glob("retained-preparation-*"))
                result = invoke(home, payload, "install", fault=phase, crash=crash)
                if crash:
                    assert result.returncode != 0, (
                        "preparation crash adapter did not stop install"
                    )
                    external = support(home) / "transaction/external-preparation.txt"
                    external.write_text("unrecognized external staging data")
                    inspect_unchanged(home, payload, {"recovery-required"})
                    expect(home, payload, "recover", {"recovered"})
                else:
                    outcome(result, "install", {"failed"})
                assert live_snapshot(home) == before, (
                    "preparation changed a live target"
                )
                retained = (
                    set(support(home).glob("retained-preparation-*")) - retained_before
                )
                assert len(retained) == 1, "preparation evidence was not retained once"
                if crash:
                    assert (
                        next(iter(retained)) / "external-preparation.txt"
                    ).read_text() == "unrecognized external staging data"
                inspect_unchanged(home, payload, {"current"} if present else {"fresh"})
                print("PASS: retained preparation " + label, flush=True)


def main() -> None:
    """Run real filesystem contracts in disposable homes without user registration."""
    assert BACKEND.is_file(), (
        "managed public backend must exist before contract tests pass"
    )
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    assert mode in {"contract", "inspect", "all", "lock"}, "unknown contract test mode"
    raw_jobs = os.environ.get("FINDER_PDF_CONTRACT_JOBS", "1")
    assert raw_jobs in {"1", "2"}, "FINDER_PDF_CONTRACT_JOBS must be 1 or 2"
    jobs = int(raw_jobs)
    test_recovery_partition_properties()
    test_recovery_lane_plan()
    with fixture_directory() as base:
        payload = base / "한글 payload ' $ first download\n"
        payload_copy(payload)
        for name in BACKEND_FILES:
            digest = hashlib.sha256((payload / name).read_bytes()).hexdigest()
            print(f"SNAPSHOT {name} {digest}", flush=True)
        if mode in {"all", "lock"}:
            started = time.monotonic()
            test_stage_child_lock_survives_engine_death(base, payload)
            print(
                f"TIMING stage-child-lock {time.monotonic() - started:.3f}s", flush=True
            )
        if mode == "lock":
            print("PASS: managed backend lock contract", flush=True)
            return
        started = time.monotonic()
        test_malformed_requests(base, payload)
        hosted_full = (
            mode == "all"
            and os.environ.get("CI") == "true"
            and os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_OS") == "macOS"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        )
        home = test_download_independence(
            base, payload,
            hosted_full=hosted_full
            and os.environ.get("FINDER_PDF_HOSTED_FULL_UPDATE_TIMEOUT") == "1",
        )
        test_conflicts(base, payload, home)
        test_payload_rejection(base, payload)
        test_legacy(
            base, payload,
            hosted_full=hosted_full
            and os.environ.get("FINDER_PDF_HOSTED_FULL_LEGACY_TIMEOUT") == "1",
        )
        test_managed_cli_refusal(home)
        test_managed_receipt_tampering(home, payload)
        print(f"TIMING contract {time.monotonic() - started:.3f}s", flush=True)
        if mode == "all":
            started = time.monotonic()
            test_registration_failure(
                base, payload,
                hosted_full=hosted_full
                and os.environ.get("FINDER_PDF_HOSTED_FULL_REGISTRATION_TIMEOUT") == "1",
            )
            test_all_backup_preflight(home, payload)
            print(
                f"TIMING registration-and-finalization {time.monotonic() - started:.3f}s",
                flush=True,
            )
            started = time.monotonic()
            test_concurrent_install(base, payload)
            test_preparation_recovery(base, payload, home)
            print(
                f"TIMING preparation-and-lock {time.monotonic() - started:.3f}s",
                flush=True,
            )
            started = time.monotonic()
            test_recovery_lanes(base, payload, home, jobs)
            print(f"TIMING rename-matrix {time.monotonic() - started:.3f}s", flush=True)
            started = time.monotonic()
            test_interrupted_recovery_and_commit(payload, home)
            print(
                f"TIMING repeated-recovery-and-commit {time.monotonic() - started:.3f}s",
                flush=True,
            )
            started = time.monotonic()
            test_metadata_edit_survives_recovery(home, payload)
            test_external_edit_and_journal(base, payload, home)
            print(
                f"TIMING external-edits-and-journals {time.monotonic() - started:.3f}s",
                flush=True,
            )
    print("PASS: managed backend " + mode + " contracts", flush=True)


if __name__ == "__main__":
    main()
