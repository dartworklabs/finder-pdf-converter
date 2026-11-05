"""Own a bounded loopback IPP capture queue; never submit a print job.

Run ``serve --state /private/qa/capture-state.json`` in a terminal. The JSON
names the only queue authorized for manual native-panel tests and a generated
synthetic PDF. ``cleanup`` asks that exact supervisor to stop; ``status`` reads
the state. After every owned job, use ``checkpoint`` before another job.
``recover`` releases resources after supervisor death. Current print preferences
are privately backed up before queue creation; only attributable checkpointed
changes are restored. No default printer or existing queue is changed. Python 3.9+.
"""

import argparse
import fcntl
import hashlib
import json
import os
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

import print_preferences

__all__ = ["main"]
QUEUE_PATTERN = re.compile(r"fdf_qa_[0-9a-f]{32}\Z")


def command(args, check=True):
    """Execute a fixed argv without shell evaluation or an unbounded wait."""
    result = subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        timeout=20,
        env={**os.environ, "LC_ALL": "C", "LANG": "C"},
    )
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr.strip()}")
    return result


def process_identity(pid):
    """Return start time and full command so a reused PID is never signalled."""
    return command(
        ["/bin/ps", "-p", str(pid), "-o", "lstart=", "-o", "command="], check=False
    ).stdout.strip()


def preferences(backup_path=None):
    """Fingerprint user lpoptions and optionally archive exact baseline bytes privately."""
    path = Path.home() / ".cups/lpoptions"
    if not path.exists() and not path.is_symlink():
        return {"exists": False}
    descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_size > 16 * 1024 * 1024
        ):
            raise RuntimeError("User print options are not bounded owned regular file")
        data = stream.read(16 * 1024 * 1024 + 1)
    if len(data) > 16 * 1024 * 1024:
        raise RuntimeError("User print options exceeded size limit")
    if backup_path is not None:
        with backup_path.open("xb") as stream:
            stream.write(data)
        os.chmod(backup_path, 0o600)
    return {
        "exists": True,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def printer_watch(owned_queue, backup_root=None, previous=None):
    """Read/hash existing physical printer preferences; privately archive baseline files only."""
    directory = Path.home() / "Library/Preferences"
    prefix = "com.apple.print.custompresets.forprinter."
    owned = prefix + owned_queue
    domains = {"org.cups.PrintingPrefs"}
    domains.update(
        path.name[:-6]
        for path in directory.glob(prefix + "*.plist")
        if path.name[:-6] != owned
    )
    domains.update((previous or {}).keys())
    adapter = print_preferences.CFPreferences()
    result = {}
    if backup_root is not None:
        backup_root.mkdir(mode=0o700)
    for domain in sorted(domains):
        if domain == owned:
            continue
        path = directory / (domain + ".plist")
        value = {
            "typed_sha256": hashlib.sha256(
                print_preferences.encode(adapter.read(domain))
            ).hexdigest(),
            "file_exists": path.exists(),
        }
        if path.exists() or path.is_symlink():
            descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                info = os.fstat(stream.fileno())
                if (
                    not stat.S_ISREG(info.st_mode)
                    or info.st_uid != os.getuid()
                    or info.st_size > 16 * 1024 * 1024
                ):
                    raise RuntimeError(
                        "Watched preferences must be bounded owned regular files"
                    )
                raw = stream.read(16 * 1024 * 1024 + 1)
            if len(raw) > 16 * 1024 * 1024:
                raise RuntimeError("Watched preference file exceeded size limit")
            value["file_sha256"] = hashlib.sha256(raw).hexdigest()
            if backup_root is not None:
                archive = backup_root / (
                    hashlib.sha256(domain.encode()).hexdigest() + ".plist"
                )
                with archive.open("xb") as stream:
                    stream.write(raw)
                os.chmod(archive, 0o600)
                value["backup"] = str(archive)
        result[domain] = value
    return result


def snapshot(owned_queue=None, backup_root=None, previous=None):
    """Read effective defaults/options plus optional physical-printer preference watches."""
    output = command(["/usr/bin/lpstat", "-e"]).stdout
    result = {
        "default": command(["/usr/bin/lpstat", "-d"]).stdout.strip(),
        "queues": sorted(output.splitlines()),
        "lpoptions": preferences(),
    }
    if owned_queue is not None:
        result["preference_watch"] = printer_watch(owned_queue, backup_root, previous)
        if backup_root is not None:
            preferences(backup_root / "lpoptions.backup")
    return result


def comparable_snapshot(value):
    """Omit private backup locations when comparing unchanged read-only observations."""
    return {
        key: (
            {
                domain: {name: item for name, item in data.items() if name != "backup"}
                for domain, data in contents.items()
            }
            if key == "preference_watch"
            else contents
        )
        for key, contents in value.items()
    }


def save_state(path, state):
    """Publish private state atomically in the caller-selected QA directory."""
    descriptor, name = tempfile.mkstemp(prefix=".capture-state-", dir=str(path.parent))
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(state, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def unique_fields(pairs):
    """Reject duplicate JSON fields rather than giving an ambiguous manifest authority."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeError("Duplicate state field")
        result[key] = value
    return result


def load_state(path):
    """Reject foreign, linked, oversized or unrecognized supervisor manifests."""
    descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "r", encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_mode & 0o077
            or info.st_size > 65536
        ):
            raise RuntimeError(
                "State must be a private regular file owned by this user"
            )
        state = json.load(stream, object_pairs_hook=unique_fields)
    if not isinstance(state, dict):
        raise TypeError("State must contain one object")
    if (
        not QUEUE_PATTERN.fullmatch(state.get("queue", ""))
        or state.get("version") != 2
        or state.get("phase") not in ("starting", "ready", "stopped", "cleanup-failed")
        or not isinstance(state.get("supervisor_pid"), int)
        or state["supervisor_pid"] <= 1
        or not isinstance(state.get("supervisor_identity"), str)
        or not isinstance(state.get("capture_root"), str)
        or not Path(state["capture_root"]).is_absolute()
        or not isinstance(state.get("spool"), str)
    ):
        raise RuntimeError("Not a version 2 owned QA queue manifest")
    return state


def synthetic_pdf(path, pages):
    """Write labeled synthetic pages with inset edge marks, using only stdlib."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    kids = []
    for label, width, height in pages:
        page_id = len(objects) + 1
        kids.append(f"{page_id} 0 R")
        content = f"BT /F1 14 Tf 30 {height // 2} Td ({label}) Tj ET\n"
        for x, y, color in (
            (12, 12, "1 0 0"),
            (width - 24, 12, "0 .7 0"),
            (12, height - 24, "0 0 1"),
            (width - 24, height - 24, "0 0 0"),
        ):
            content += f"{color} rg {x} {y} 12 12 re f\n"
        data = content.encode("ascii")
        objects.append(
            (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
                f"/Resources << /Font << /F1 3 0 R >> >> /Contents {page_id + 1} 0 R >>"
            ).encode("ascii")
        )
        objects.append(
            b"<< /Length "
            + str(len(data)).encode()
            + b" >>\nstream\n"
            + data
            + b"endstream"
        )
    objects[1] = (
        "<< /Type /Pages /Count {} /Kids [{}] >>".format(len(pages), " ".join(kids))
    ).encode()
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(pdf)
    pdf += f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode()
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n".encode()
    pdf += (
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ).encode()
    with path.open("xb") as stream:
        stream.write(pdf)


def verify_listeners(pid):
    """Require exactly IPv4 and IPv6 loopback listeners before exposing a queue."""
    output = command(
        ["/usr/sbin/lsof", "-nP", "-a", "-p", str(pid), "-iTCP", "-sTCP:LISTEN", "-Fn"]
    ).stdout
    addresses = [
        line[1:].split(" (", 1)[0]
        for line in output.splitlines()
        if line.startswith("n")
    ]
    hosts = [address.rsplit(":", 1)[0] for address in addresses]
    if sorted(hosts) != ["127.0.0.1", "[::1]"]:
        raise ValueError(
            "IPP listeners are not exactly IPv4/IPv6 loopback: " + repr(addresses)
        )
    return addresses


def queue_uri(queue):
    """Read only the exact owned queue's URI; never enumerate physical addresses."""
    if not QUEUE_PATTERN.fullmatch(queue):
        raise RuntimeError("Refusing a queue outside the QA namespace")
    result = command(["/usr/bin/lpstat", "-v", queue], check=False)
    if result.returncode:
        return None
    return parse_queue_uri(queue, result.stdout)


def parse_queue_uri(queue, output):
    """Recognize lpstat's one exact-queue response across display languages."""
    lines = output.splitlines()
    boundary = r"(?<![A-Za-z0-9_])" + re.escape(queue) + r"(?![A-Za-z0-9_])"
    if len(lines) != 1 or not re.search(boundary, lines[0]) or ": " not in lines[0]:
        raise RuntimeError("Unrecognized queue identity response")
    value = lines[0].rsplit(": ", 1)[1]
    if not re.fullmatch(r"ipp://localhost:[0-9]+/ipp/print", value):
        raise RuntimeError("Queue is no longer an owned loopback IPP target")
    return value


def parse_completed_job(queue: str, job_id: int, media: str, output: str) -> dict:
    """Accept one completed CUPS job only for the exact local owned queue and media."""
    media_aliases = {
        "Letter": "na_letter_8.5x11in",
        "Legal": "na_legal_8.5x14in",
        "A4": "iso_a4_210x297mm",
    }
    canonical_media = media_aliases.get(media, media)
    if canonical_media not in media_aliases.values():
        raise RuntimeError("Unsupported checkpoint media")
    expected = {
        "job-id": str(job_id),
        "job-state": "completed",
        "media": canonical_media,
    }
    values = {}
    for line in output.splitlines():
        match = re.fullmatch(
            r"\s*(job-id|job-state|job-printer-uri|media) \([^)]*\) = (.+)", line
        )
        if match:
            key, value = match.groups()
            if key in values:
                raise RuntimeError("Ambiguous completed-job attributes")
            values[key] = value
    observed_media = values.get("media", "")
    values["media"] = media_aliases.get(observed_media, observed_media)
    if any(values.get(key) != value for key, value in expected.items()):
        raise RuntimeError("Job is not completed with the declared media")
    uri = urlsplit(values.get("job-printer-uri", ""))
    if (
        uri.scheme != "ipp"
        or uri.hostname not in ("localhost", "127.0.0.1", "::1")
        or uri.port not in (None, 631)
        or uri.path != "/printers/" + queue
        or uri.query
        or uri.fragment
        or uri.username
    ):
        raise RuntimeError("Completed job does not belong to the exact local QA queue")
    return {"job_id": job_id, "media": media}


def new_job_files(spool, previous):
    """Fingerprint regular completed PDF files; refuse links, changed or reused names."""
    known = {item["name"]: item for item in previous}
    fresh = []
    for path in sorted(spool.glob("*.pdf")):
        try:
            descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
        except OSError as error:
            raise RuntimeError(
                "Spool evidence must not be linked or inaccessible"
            ) from error
        with os.fdopen(descriptor, "rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid():
                raise RuntimeError("Spool evidence is not an owned regular file")
            data = stream.read(100 * 1024 * 1024 + 1)
            after = os.fstat(stream.fileno())
        if (
            before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or len(data) > 100 * 1024 * 1024
            or not data.startswith(b"%PDF-")
            or b"%%EOF" not in data[-1024:]
        ):
            raise RuntimeError("Spool PDF is incomplete or changed while reading")
        item = {
            "name": path.name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
        }
        if path.name in known:
            if item != known[path.name]:
                raise RuntimeError("Previously checkpointed spool evidence changed")
        else:
            fresh.append(item)
    return fresh


@contextmanager
def capture_lock(state):
    """Serialize checkpoint and cleanup against the private capture root lock."""
    root = Path(state["capture_root"])
    info = root.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
        or str(root / "spool") != state["spool"]
    ):
        raise RuntimeError("Capture root must remain an owned private directory")
    descriptor = os.open(
        str(root / "lifecycle.lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, "r+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield root


def checkpoint(path: Path, locale: str, media: str, job_id: int) -> None:
    """Record fresh native output after CUPS, queue identity and preference attribution agree."""
    state = load_state(path)
    with capture_lock(state) as root:
        state = load_state(path)
        if (
            state["phase"] != "ready"
            or process_identity(state["supervisor_pid"]) != state["supervisor_identity"]
            or queue_uri(state["queue"]) != state["uri"]
        ):
            raise RuntimeError("Checkpoint requires the live exact owned capture queue")
        if job_id in state.get("checkpoint_job_ids", []):
            raise RuntimeError("CUPS job was already checkpointed")
        attributes = command(
            [
                "/usr/bin/ipptool",
                "-tv",
                "ipp://localhost:631/jobs/" + str(job_id),
                "/usr/share/cups/ipptool/get-job-attributes.test",
            ]
        ).stdout
        parse_completed_job(state["queue"], job_id, media, attributes)
        files = new_job_files(Path(state["spool"]), state.get("checkpoint_files", []))
        if len(files) != 1:
            raise RuntimeError(
                "Checkpoint requires exactly one new completed spool PDF"
            )
        evidence = {
            "queue": state["queue"],
            "locale": locale,
            "media": media,
            "job_files": files,
        }
        result = print_preferences.checkpoint(root / "preferences", evidence)
        state.setdefault("checkpoint_files", []).extend(files)
        state.setdefault("checkpoint_job_ids", []).append(job_id)
        state["preferences"] = result
        save_state(path, state)
        print(
            json.dumps({"checkpoint_job_id": job_id, "preferences": result}), flush=True
        )


def stop_owned_server(state):
    """Stop only the recorded server process; refuse reused identities and bound waiting."""
    pid = state.get("server_pid")
    if pid is None or not process_identity(pid):
        return
    if process_identity(pid) != state.get("server_identity"):
        raise RuntimeError("Server identity changed; refusing signal")
    os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 5
    while process_identity(pid) and time.monotonic() < deadline:
        try:
            if os.waitpid(pid, os.WNOHANG)[0] == pid:
                return
        except ChildProcessError:
            pass
        time.sleep(0.05)
    if process_identity(pid):
        if process_identity(pid) != state.get("server_identity"):
            raise RuntimeError("Server identity changed while stopping")
        os.kill(pid, signal.SIGKILL)


def cleanup_state(path, state, server=None):
    """Idempotently release the exact QA resources and restore only journaled preferences."""
    with capture_lock(state) as root:
        state = load_state(path)
        errors = []
        if state.get("queue_attempted"):
            try:
                current = queue_uri(state["queue"])
                if current == state["uri"]:
                    command(["/usr/sbin/lpadmin", "-x", state["queue"]])
                elif current is not None:
                    errors.append("Queue URI changed; deletion refused")
            except Exception as error:  # noqa: BLE001 - complete every owned cleanup step and report failures
                errors.append(str(error))
        try:
            if server is not None:
                if server.poll() is None:
                    server.terminate()
                    try:
                        server.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=5)
            else:
                stop_owned_server(state)
        except Exception as error:  # noqa: BLE001 - complete every owned cleanup step and report failures
            errors.append(str(error))
        try:
            state["preferences"] = print_preferences.restore(root / "preferences")
            if state["preferences"].get("conflicts"):
                errors.append(
                    "Print preference conflicts remain; private backup retained"
                )
        except Exception as error:  # noqa: BLE001 - complete every owned cleanup step and report failures
            errors.append("Preference restoration failed: " + str(error))
        try:
            state["after"] = snapshot(
                state["queue"], previous=state["before"].get("preference_watch")
            )
            if comparable_snapshot(state["before"]) != comparable_snapshot(
                state["after"]
            ):
                errors.append(
                    "Printer defaults/queues/user options differ from baseline; no unrelated settings restored"
                )
        except Exception as error:  # noqa: BLE001 - complete every owned cleanup step and report failures
            errors.append("Read-only final printer watch failed: " + str(error))
        state.update(
            {
                "phase": "cleanup-failed" if errors else "stopped",
                "cleanup_errors": errors,
            }
        )
        save_state(path, state)
        print(
            json.dumps({"phase": state["phase"], "cleanup_errors": errors}), flush=True
        )
        if errors:
            raise RuntimeError("; ".join(errors))


def serve(path: Path, seconds: int) -> None:
    """Back up preferences before creating one bounded capture queue; always restore on exit."""
    if path.exists() or path.is_symlink():
        raise RuntimeError("State already exists; choose a new path")
    path.parent.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    root = Path(tempfile.mkdtemp(prefix="capture-", dir=str(path.parent)))
    spool = root / "spool"
    spool.mkdir()
    (root / "keys").mkdir()
    queue = "fdf_qa_" + uuid.uuid4().hex
    state = {
        "version": 2,
        "queue": queue,
        "phase": "starting",
        "before": snapshot(queue, root / "read-only-backups"),
        "supervisor_pid": os.getpid(),
        "capture_root": str(root),
        "spool": str(spool),
        "supervisor_identity": process_identity(os.getpid()),
    }
    server = None
    stopping = False

    def stop_requested(signum, frame):
        """Defer termination until the owned resources have passed through finally cleanup."""
        nonlocal stopping
        stopping = True

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, stop_requested)
    state["preferences"] = print_preferences.start(root / "preferences", state["queue"])
    save_state(path, state)
    try:
        synthetic_pdf(
            root / "Edge test.pdf",
            [
                ("Edge1", 595, 842),
                ("Edge2", 842, 595),
                ("Edge3", 200, 300),
                ("Edge4", 1100, 1500),
            ],
        )
        synthetic_pdf(
            root / "Order test.pdf", [("Order1", 595, 842), ("Order2", 595, 842)]
        )
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        state.update(
            {
                "port": port,
                "uri": f"ipp://localhost:{port}/ipp/print",
                "fixture": str(root / "Edge test.pdf"),
                "order_fixture": str(root / "Order test.pdf"),
                "title": "Finder PDF Test " + state["queue"][-8:],
                "deadline": time.time() + seconds,
            }
        )
        save_state(path, state)
        with (root / "server.log").open("w") as log:
            if stopping:
                return
            server = subprocess.Popen(
                [
                    "/usr/bin/ippeveprinter",
                    "--no-web-forms",
                    "-n",
                    "localhost",
                    "-p",
                    str(port),
                    "-r",
                    "off",
                    "-k",
                    "-K",
                    str(root / "keys"),
                    "-d",
                    str(spool),
                    "-f",
                    "application/pdf",
                    state["title"],
                ],
                stdout=log,
                stderr=log,
            )
            state.update(
                {
                    "server_pid": server.pid,
                    "server_identity": process_identity(server.pid),
                }
            )
            save_state(path, state)
            for attempt in range(30):
                if stopping or server.poll() is not None:
                    raise RuntimeError(
                        "IPP startup stopped; inspect private server.log"
                    )
                try:
                    state["listeners"] = verify_listeners(server.pid)
                    break
                except RuntimeError:
                    if attempt == 29:
                        raise
                    time.sleep(0.2)
            attrs = command(
                [
                    "/usr/bin/ipptool",
                    "-tv",
                    state["uri"],
                    "/usr/share/cups/ipptool/get-printer-attributes.test",
                ]
            ).stdout
            (root / "capabilities.txt").write_text(attrs)
            formats = re.search(r"document-format-supported[^\n]*", attrs)
            if not formats or "application/pdf" not in formats.group():
                raise RuntimeError("Capture server did not advertise PDF")
            if stopping or state["queue"] in snapshot()["queues"]:
                raise RuntimeError("QA startup stopped or queue name collision")
            state["queue_attempted"] = True
            save_state(path, state)
            command(
                [
                    "/usr/sbin/lpadmin",
                    "-p",
                    state["queue"],
                    "-E",
                    "-v",
                    state["uri"],
                    "-m",
                    "everywhere",
                    "-o",
                    "printer-is-shared=false",
                    "-o",
                    "printer-error-policy=abort-job",
                    "-D",
                    state["title"],
                ]
            )
            if queue_uri(state["queue"]) != state["uri"]:
                raise RuntimeError("QA queue URI differs from owned loopback server")
            queue_attrs = command(
                [
                    "/usr/bin/ipptool",
                    "-tv",
                    "ipp://localhost:631/printers/" + state["queue"],
                    "/usr/share/cups/ipptool/get-printer-attributes.test",
                ]
            ).stdout
            (root / "queue-capabilities.txt").write_text(queue_attrs)
            if not re.search(r"printer-is-shared[^\n]*= false", queue_attrs):
                raise RuntimeError("QA queue is not confirmed unshared")
            state["phase"] = "ready"
            save_state(path, state)
            print(
                json.dumps(
                    {
                        key: state[key]
                        for key in (
                            "phase",
                            "queue",
                            "title",
                            "fixture",
                            "order_fixture",
                            "spool",
                            "deadline",
                        )
                    }
                ),
                flush=True,
            )
            while not stopping and time.time() < state["deadline"]:
                if server.poll() is not None:
                    raise RuntimeError("IPP server exited during capture")
                if (
                    sum(
                        item.stat().st_size
                        for item in root.rglob("*")
                        if item.is_file()
                    )
                    > 100 * 1024 * 1024
                ):
                    raise RuntimeError("QA capture exceeded 100 MiB budget")
                time.sleep(0.2)
    finally:
        cleanup_state(path, state, server)


def main() -> None:
    """Parse bounded capture commands; signal only a matching live supervisor identity."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=("serve", "status", "checkpoint", "cleanup", "recover")
    )
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--seconds", type=int, default=2700)
    parser.add_argument("--locale", choices=("en", "ko"))
    parser.add_argument("--media")
    parser.add_argument("--job-id", type=int)
    args = parser.parse_args()
    if not args.state.is_absolute() or not 10 <= args.seconds <= 3600:
        parser.error("Use an absolute QA state path and 10..3600 seconds")
    if args.action == "checkpoint":
        if not args.locale or not args.media or not args.job_id or args.job_id < 1:
            parser.error("checkpoint requires --locale, --media and positive --job-id")
        checkpoint(args.state, args.locale, args.media, args.job_id)
        return
    if args.action == "serve":
        serve(args.state, args.seconds)
        return
    state = load_state(args.state)
    if args.action == "status":
        print(json.dumps(state, indent=2))
        return
    if state["phase"] == "stopped":
        print("Already stopped")
        return
    if args.action == "recover":
        if process_identity(state["supervisor_pid"]):
            raise RuntimeError(
                "Supervisor PID still exists; recover refuses live or reused processes"
            )
        cleanup_state(args.state, state)
        return
    pid = state["supervisor_pid"]
    if (
        not isinstance(pid, int)
        or pid <= 1
        or process_identity(pid) != state["supervisor_identity"]
    ):
        raise RuntimeError("Supervisor identity changed; refusing signal")
    os.kill(pid, signal.SIGTERM)
    for _ in range(100):
        current = load_state(args.state)
        if current["phase"] in ("stopped", "cleanup-failed"):
            print(json.dumps(current["cleanup_errors"]))
            if current["phase"] == "cleanup-failed":
                raise RuntimeError("Owned cleanup incomplete; inspect state")
            return
        time.sleep(0.2)
    raise RuntimeError("Cleanup did not finish within 20 seconds; inspect state")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - complete every owned cleanup step and report failures
        print("Capture failed: " + str(error), file=sys.stderr)
        sys.exit(1)
