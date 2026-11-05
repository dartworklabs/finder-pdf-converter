#!/usr/bin/env python3
"""Own a bounded loopback IPP capture queue; never submit a print job.

Run ``serve --state /private/qa/capture-state.json`` in a terminal. The JSON
names the only queue authorized for manual native-panel tests and a generated
synthetic PDF. ``cleanup`` asks that exact supervisor to stop; ``status`` reads
the state. No default printer or existing queue is changed. Python 3.9+.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid

__all__ = ["main"]
QUEUE_PATTERN = re.compile(r"fdf_qa_[0-9a-f]{32}\Z")


def command(args, check=True):
    """Execute a fixed argv without shell evaluation or an unbounded wait."""
    result = subprocess.run(args, capture_output=True, text=True, timeout=20,
                            env={**os.environ, "LC_ALL": "C", "LANG": "C"})
    if check and result.returncode:
        raise RuntimeError("{} failed: {}".format(args[0], result.stderr.strip()))
    return result


def process_identity(pid):
    """Return start time and full command so a reused PID is never signalled."""
    return command(["/bin/ps", "-p", str(pid), "-o", "lstart=", "-o", "command="],
                   check=False).stdout.strip()


def preferences():
    """Fingerprint user defaults without changing or logging unrelated settings."""
    path = Path.home() / ".cups/lpoptions"
    if not path.exists():
        return {"exists": False}
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise RuntimeError("User print options are not a regular file")
    return {"exists": True, "bytes": info.st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def snapshot():
    """Record destination names and effective default, without device addresses."""
    output = command(["/usr/bin/lpstat", "-e"]).stdout
    return {"default": command(["/usr/bin/lpstat", "-d"]).stdout.strip(),
            "queues": sorted(output.splitlines()),
            "lpoptions": preferences()}


def save_state(path, state):
    """Publish private state atomically in the caller-selected QA directory."""
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(state, stream, indent=2)
        stream.write("\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def load_state(path):
    """Reject foreign, linked, oversized or unrecognized supervisor manifests."""
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or info.st_mode & 0o077 or info.st_size > 65536):
        raise RuntimeError("State must be a private regular file owned by this user")
    state = json.loads(path.read_text())
    if not QUEUE_PATTERN.fullmatch(state.get("queue", "")):
        raise RuntimeError("Not an owned QA queue manifest")
    return state


def synthetic_pdf(path, pages):
    """Write labeled synthetic pages with inset edge marks, using only stdlib."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for label, width, height in pages:
        page_id = len(objects) + 1
        kids.append("{} 0 R".format(page_id))
        content = "BT /F1 14 Tf 30 {} Td ({}) Tj ET\n".format(height // 2, label)
        for x, y, color in ((12, 12, "1 0 0"), (width-24, 12, "0 .7 0"),
                            (12, height-24, "0 0 1"), (width-24, height-24, "0 0 0")):
            content += "{} rg {} {} 12 12 re f\n".format(color, x, y)
        data = content.encode("ascii")
        objects.append(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] "
                        "/Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>"
                        ).format(width, height, page_id+1).encode("ascii"))
        objects.append(b"<< /Length " + str(len(data)).encode() + b" >>\nstream\n" + data + b"endstream")
    objects[1] = ("<< /Type /Pages /Count {} /Kids [{}] >>".format(len(pages), " ".join(kids))).encode()
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(pdf)
    pdf += "xref\n0 {}\n0000000000 65535 f \n".format(len(offsets)).encode()
    for offset in offsets[1:]:
        pdf += "{:010d} 00000 n \n".format(offset).encode()
    pdf += ("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n"
            .format(len(offsets), xref)).encode()
    with path.open("xb") as stream:
        stream.write(pdf)


def verify_listeners(pid):
    """Require exactly IPv4 and IPv6 loopback listeners before exposing a queue."""
    output = command(["/usr/sbin/lsof", "-nP", "-a", "-p", str(pid),
                      "-iTCP", "-sTCP:LISTEN", "-Fn"]).stdout
    addresses = [line[1:].split(" (", 1)[0] for line in output.splitlines() if line.startswith("n")]
    hosts = [address.rsplit(":", 1)[0] for address in addresses]
    if sorted(hosts) != ["127.0.0.1", "[::1]"]:
        raise ValueError("IPP listeners are not exactly IPv4/IPv6 loopback: " + repr(addresses))
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


def serve(path, seconds):
    """Create one capture dependency and release only owned resources on exit."""
    if path.exists() or path.is_symlink():
        raise RuntimeError("State already exists; choose a new path")
    path.parent.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    state = {"queue": "fdf_qa_" + uuid.uuid4().hex, "phase": "starting",
             "before": snapshot(), "supervisor_pid": os.getpid(),
             "supervisor_identity": process_identity(os.getpid())}
    root = Path(tempfile.mkdtemp(prefix="capture-", dir=str(path.parent)))
    spool = root / "spool"
    spool.mkdir()
    (root / "keys").mkdir()
    synthetic_pdf(root / "Edge test.pdf", [("Edge1", 595, 842), ("Edge2", 842, 595), ("Edge3", 200, 300), ("Edge4", 1100, 1500)])
    synthetic_pdf(root / "Order test.pdf", [("Order1", 595, 842), ("Order2", 595, 842)])
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    state.update({"port": port, "uri": "ipp://localhost:{}/ipp/print".format(port),
                  "spool": str(spool), "fixture": str(root / "Edge test.pdf"),
                  "order_fixture": str(root / "Order test.pdf"),
                  "title": "Finder PDF Test " + state["queue"][-8:],
                  "deadline": time.time() + seconds})
    save_state(path, state)
    server = None
    queue_attempted = False
    stopping = False

    def stop_requested(signum, frame):
        """Make termination leave the polling loop and execute its finally block."""
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop_requested)
    signal.signal(signal.SIGINT, stop_requested)
    try:
        with (root / "server.log").open("w") as log:
            server = subprocess.Popen(["/usr/bin/ippeveprinter", "--no-web-forms",
                "-n", "localhost", "-p", str(port), "-r", "off", "-k", "-K", str(root / "keys"),
                "-d", str(spool), "-f", "application/pdf", state["title"]],
                stdout=log, stderr=log)
            state.update({"server_pid": server.pid, "server_identity": process_identity(server.pid)})
            save_state(path, state)
            for attempt in range(30):
                if stopping or server.poll() is not None:
                    raise RuntimeError("IPP startup stopped; inspect private server.log")
                try:
                    state["listeners"] = verify_listeners(server.pid)
                    break
                except RuntimeError:
                    if attempt == 29:
                        raise
                    time.sleep(.2)
            attrs = command(["/usr/bin/ipptool", "-tv", state["uri"],
                             "/usr/share/cups/ipptool/get-printer-attributes.test"]).stdout
            (root / "capabilities.txt").write_text(attrs)
            formats = re.search(r"document-format-supported[^\n]*", attrs)
            if not formats or "application/pdf" not in formats.group():
                raise RuntimeError("Capture server did not advertise PDF")
            if state["queue"] in snapshot()["queues"]:
                raise RuntimeError("QA queue name collision")
            queue_attempted = True
            command(["/usr/sbin/lpadmin", "-p", state["queue"], "-E", "-v", state["uri"],
                     "-m", "everywhere", "-o", "printer-is-shared=false",
                     "-o", "printer-error-policy=abort-job", "-D", state["title"]])
            if queue_uri(state["queue"]) != state["uri"]:
                raise RuntimeError("QA queue URI differs from owned loopback server")
            queue_attrs = command(["/usr/bin/ipptool", "-tv",
                "ipp://localhost:631/printers/" + state["queue"],
                "/usr/share/cups/ipptool/get-printer-attributes.test"]).stdout
            (root / "queue-capabilities.txt").write_text(queue_attrs)
            if not re.search(r"printer-is-shared[^\n]*= false", queue_attrs):
                raise RuntimeError("QA queue is not confirmed unshared")
            state["phase"] = "ready"
            save_state(path, state)
            print(json.dumps({key: state[key] for key in ("phase", "queue", "title", "fixture", "order_fixture", "spool", "deadline")}), flush=True)
            while not stopping and time.time() < state["deadline"]:
                if server.poll() is not None:
                    raise RuntimeError("IPP server exited during capture")
                if sum(item.stat().st_size for item in root.rglob("*") if item.is_file()) > 100 * 1024 * 1024:
                    raise RuntimeError("QA capture exceeded 100 MiB budget")
                time.sleep(.2)
    finally:
        errors = []
        if queue_attempted:
            try:
                current = queue_uri(state["queue"])
                if current == state["uri"]:
                    command(["/usr/sbin/lpadmin", "-x", state["queue"]])
                elif current is not None:
                    errors.append("Queue URI changed; deletion refused")
            except Exception as error:
                errors.append(str(error))
        if server is not None and server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)
        state["after"] = snapshot()
        if state["before"] != state["after"]:
            errors.append("Printer defaults/queues/user options differ from baseline")
        state.update({"phase": "cleanup-failed" if errors else "stopped", "cleanup_errors": errors})
        save_state(path, state)
        print(json.dumps({"phase": state["phase"], "cleanup_errors": errors}), flush=True)
        if errors:
            raise RuntimeError("; ".join(errors))


def main():
    """Parse the three bounded QA commands, returning failures without escalation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("serve", "status", "cleanup"))
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--seconds", type=int, default=2700)
    args = parser.parse_args()
    if not args.state.is_absolute() or not 10 <= args.seconds <= 3600:
        parser.error("Use an absolute QA state path and 10..3600 seconds")
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
    pid = state["supervisor_pid"]
    if (not isinstance(pid, int) or pid <= 1
            or process_identity(pid) != state["supervisor_identity"]):
        raise RuntimeError("Supervisor identity changed; refusing signal")
    os.kill(pid, signal.SIGTERM)
    for _ in range(100):
        current = load_state(args.state)
        if current["phase"] in ("stopped", "cleanup-failed"):
            print(json.dumps(current["cleanup_errors"]))
            if current["phase"] == "cleanup-failed":
                raise RuntimeError("Owned cleanup incomplete; inspect state")
            return
        time.sleep(.2)
    raise RuntimeError("Cleanup did not finish within 20 seconds; inspect state")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Capture failed: " + str(error), file=sys.stderr)
        sys.exit(1)
