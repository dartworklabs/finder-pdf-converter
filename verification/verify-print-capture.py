#!/usr/bin/env python3
"""Check QA capture identity parsing and synthetic fixture shape without printing."""

from pathlib import Path
import random
import runpy
import tempfile
import unittest

CAPTURE = runpy.run_path(str(Path(__file__).with_name("print-capture.py")))


class CaptureContracts(unittest.TestCase):
    """Pin locale-safe exact-target parsing and the owned synthetic fixture."""

    def test_uri_is_recognized_in_english_and_korean(self):
        """The installed macOS ignores LC_ALL for lpstat display language."""
        randomizer = random.Random(4137)
        for _ in range(64):
            queue = "fdf_qa_" + "".join(randomizer.choices("0123456789abcdef", k=32))
            uri = "ipp://localhost:{}/ipp/print".format(randomizer.randint(1024, 65535))
            for output in ("device for {}: {}\n".format(queue, uri),
                           "{}에 대한 기기: {}\n".format(queue, uri)):
                self.assertEqual(CAPTURE["parse_queue_uri"](queue, output), uri)

    def test_foreign_or_ambiguous_destinations_are_rejected(self):
        """A response cannot redirect cleanup to physical or ambiguous targets."""
        queue = "fdf_qa_" + "a" * 32
        for output in ("device for foreign: ipp://localhost:1234/ipp/print\n",
                       "device for {}: socket://physical:9100\n".format(queue),
                       "device for foreign{}: ipp://localhost:1234/ipp/print\n".format(queue),
                       "device for {}foreign: ipp://localhost:1234/ipp/print\n".format(queue),
                       "device for {}: ipp://192.0.2.1:631/ipp/print\n".format(queue),
                       "device for {}: ipp://localhost:1234/ipp/print\nextra\n".format(queue),
                       ""):
            with self.assertRaises(RuntimeError):
                CAPTURE["parse_queue_uri"](queue, output)

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
            self.assertEqual(data[xref:xref + 4], b"xref")
            entries = data[xref:].splitlines()[3:10]
            for index, entry in enumerate(entries, 1):
                offset = int(entry.split()[0])
                self.assertTrue(data[offset:].startswith("{} 0 obj\n".format(index).encode()))


if __name__ == "__main__":
    unittest.main()
