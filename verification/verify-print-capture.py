"""Check QA capture identity parsing and synthetic fixture shape without printing."""

import json
import random
import runpy
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import unittest

CAPTURE = runpy.run_path(str(Path(__file__).with_name("print-capture.py")))


class CaptureContracts(unittest.TestCase):
    """Pin locale-safe exact-target parsing and the owned synthetic fixture."""

    def test_uri_is_recognized_in_english_and_korean(self):
        """The installed macOS ignores LC_ALL for lpstat display language."""
        randomizer = random.Random(4137)
        for _ in range(64):
            queue = "fdf_qa_" + "".join(randomizer.choices("0123456789abcdef", k=32))
            uri = f"ipp://localhost:{randomizer.randint(1024, 65535)}/ipp/print"
            for output in (
                f"device for {queue}: {uri}\n",
                f"{queue}에 대한 기기: {uri}\n",
            ):
                self.assertEqual(CAPTURE["parse_queue_uri"](queue, output), uri)

    def test_foreign_or_ambiguous_destinations_are_rejected(self):
        """A response cannot redirect cleanup to physical or ambiguous targets."""
        queue = "fdf_qa_" + "a" * 32
        for output in (
            "device for foreign: ipp://localhost:1234/ipp/print\n",
            f"device for {queue}: socket://physical:9100\n",
            f"device for foreign{queue}: ipp://localhost:1234/ipp/print\n",
            f"device for {queue}foreign: ipp://localhost:1234/ipp/print\n",
            f"device for {queue}: ipp://192.0.2.1:631/ipp/print\n",
            f"device for {queue}: ipp://localhost:1234/ipp/print\nextra\n",
            "",
        ):
            with self.assertRaises(RuntimeError):
                CAPTURE["parse_queue_uri"](queue, output)

    def test_completed_job_requires_exact_queue_media_and_success(self):
        """Only completed CUPS jobs for the owned destination can authorize a checkpoint."""
        self.assertIn(
            "parse_completed_job",
            CAPTURE,
            "Completed-job authorization is required before preference writes",
        )
        queue = "fdf_qa_" + "a" * 32
        attributes = f"""job-id (integer) = 42
job-state (enum) = completed
job-printer-uri (uri) = ipp://localhost:631/printers/{queue}
media (keyword) = na_letter_8.5x11in
"""
        self.assertEqual(
            CAPTURE["parse_completed_job"](queue, 42, "na_letter_8.5x11in", attributes)[
                "job_id"
            ],
            42,
        )
        self.assertEqual(
            CAPTURE["parse_completed_job"](
                queue, 42, "Letter", attributes.replace("na_letter_8.5x11in", "Letter")
            )["job_id"],
            42,
        )
        for bad in (
            attributes.replace(queue, "foreign"),
            attributes.replace("completed", "processing"),
            attributes.replace("42", "43"),
            attributes.replace("na_letter", "iso_a4"),
            attributes + "job-id (integer) = 43\n",
        ):
            with self.assertRaises(RuntimeError):
                CAPTURE["parse_completed_job"](queue, 42, "na_letter_8.5x11in", bad)

    def test_job_evidence_is_new_private_stable_pdf_only(self):
        """A linked or already acknowledged spool file cannot authorize restoration."""
        self.assertIn(
            "new_job_files",
            CAPTURE,
            "Preference checkpoints require fresh owned spool evidence",
        )
        with tempfile.TemporaryDirectory(prefix="fpdf-capture-evidence-") as temporary:
            spool = Path(temporary)
            pdf = spool / "job-1.pdf"
            CAPTURE["synthetic_pdf"](pdf, [("Owned", 200, 300)])
            files = CAPTURE["new_job_files"](spool, [])
            self.assertEqual([item["name"] for item in files], [pdf.name])
            self.assertEqual(CAPTURE["new_job_files"](spool, files), [])
            (spool / "job-2.pdf").symlink_to(pdf)
            with self.assertRaises(RuntimeError):
                CAPTURE["new_job_files"](spool, files)

    def test_media_authorization_rejects_remote_alias_and_duplicate_attributes(self):
        """Generated exact identities authorize while remote targets and duplicates refuse."""
        rng = random.Random(49217)
        for number in range(48):
            queue = "fdf_qa_" + "".join(rng.choices("0123456789abcdef", k=32))
            job = rng.randrange(1, 100000)
            attributes = f"job-id (integer) = {job}\njob-state (enum) = completed\njob-printer-uri (uri) = ipp://localhost:631/printers/{queue}\nmedia (keyword) = na_letter_8.5x11in\n"
            self.assertEqual(
                CAPTURE["parse_completed_job"](queue, job, "Letter", attributes)[
                    "job_id"
                ],
                job,
                (49217, number),
            )
            for invalid in (
                attributes.replace("localhost", "remote.example"),
                attributes.replace("/printers/", "/printers/../printers/"),
                attributes + "media (keyword) = na_letter_8.5x11in\n",
            ):
                with self.assertRaises(RuntimeError):
                    CAPTURE["parse_completed_job"](queue, job, "Letter", invalid)

    def test_private_state_rejects_ambiguous_or_public_manifests(self):
        """A manifest cannot grant authority through duplicate fields or public permissions."""
        with tempfile.TemporaryDirectory(prefix="fpdf-capture-state-") as temporary:
            path = Path(temporary) / "state.json"
            state = {
                "version": 2,
                "queue": "fdf_qa_" + "a" * 32,
                "phase": "ready",
                "supervisor_pid": 42,
                "supervisor_identity": "fixture",
                "capture_root": temporary,
                "spool": temporary + "/spool",
            }
            CAPTURE["save_state"](path, state)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(CAPTURE["load_state"](path), state)
            path.write_text(json.dumps(state)[:-1] + f',"queue":"{state["queue"]}"}}')
            with self.assertRaises(RuntimeError):
                CAPTURE["load_state"](path)
            CAPTURE["save_state"](path, state)
            path.chmod(0o644)
            with self.assertRaises(RuntimeError):
                CAPTURE["load_state"](path)

    def test_incomplete_and_changed_spool_files_never_authorize_checkpoints(self):
        """A recognized PDF must finish and previously recorded evidence must remain exact."""
        with tempfile.TemporaryDirectory(prefix="fpdf-capture-spool-") as temporary:
            spool = Path(temporary)
            pdf = spool / "job.pdf"
            pdf.write_bytes(b"%PDF-1.4\ntruncated")
            with self.assertRaises(RuntimeError):
                CAPTURE["new_job_files"](spool, [])
            pdf.unlink()
            CAPTURE["synthetic_pdf"](pdf, [("Owned", 200, 300)])
            previous = CAPTURE["new_job_files"](spool, [])
            pdf.write_bytes(pdf.read_bytes().replace(b"Owned", b"Other"))
            with self.assertRaises(RuntimeError):
                CAPTURE["new_job_files"](spool, previous)

    def test_server_cleanup_stops_owned_process_but_refuses_changed_identity(self):
        """Recovery terminates a real harmless owned process and preserves a mismatched one."""
        for matching in (False, True):
            process = subprocess.Popen(["/bin/sleep", "30"])
            try:
                identity = CAPTURE["process_identity"](process.pid)
                state = {
                    "server_pid": process.pid,
                    "server_identity": identity if matching else "foreign identity",
                }
                if matching:
                    CAPTURE["stop_owned_server"](state)
                    process.wait(timeout=2)
                    self.assertIsNotNone(process.returncode)
                else:
                    with self.assertRaises(RuntimeError):
                        CAPTURE["stop_owned_server"](state)
                    self.assertIsNone(process.poll())
            finally:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=2)

    def test_fixture_has_distinct_labels_and_valid_xref_offsets(self):
        """Fixture generation preserves selected labels and each PDF object offset."""
        with tempfile.TemporaryDirectory(prefix="fpdf-capture-fixture-") as temporary:
            path = Path(temporary) / "synthetic.pdf"
            CAPTURE["synthetic_pdf"](path, [("Order1", 595, 842), ("Order2", 200, 300)])
            data = path.read_bytes()
            self.assertIn(b"/Count 2", data)
            self.assertIn(b"(Order1)", data)
            self.assertIn(b"(Order2)", data)
            self.assertIn(b"/MediaBox [0 0 200 300]", data)
            xref = int(data.split(b"startxref\n")[1].splitlines()[0])
            self.assertEqual(data[xref : xref + 4], b"xref")
            entries = data[xref:].splitlines()[3:10]
            for index, entry in enumerate(entries, 1):
                offset = int(entry.split()[0])
                self.assertTrue(data[offset:].startswith(f"{index} 0 obj\n".encode()))


if __name__ == "__main__":
    unittest.main()
