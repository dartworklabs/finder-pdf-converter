"""Verify scoped print preference recovery and typed macOS persistence."""

import datetime
import importlib.util
import os
import plistlib
import random
import stat
import tempfile
import unittest
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "print_preferences", Path(__file__).with_name("print_preferences.py")
)
if spec is None or spec.loader is None:
    raise ImportError("Cannot load print preference guard")
prefs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prefs)


class MemoryPreferences:
    """Give guard tests independent key-value domains without touching printers."""

    def __init__(self):
        """Start with no preference values."""
        self.domains = {}

    def read(self, domain):
        """Return a detached domain copy."""
        return prefs.clone(self.domains.get(domain, {}))

    def set(self, domain, key, value):
        """Apply one exact key mutation."""
        target = self.domains.setdefault(domain, {})
        if value["present"]:
            target[key] = prefs.clone(value["value"])
        else:
            target.pop(key, None)


class PreferenceGuardTests(unittest.TestCase):
    """Preserve typed prior values and refuse unowned preference changes."""

    def setUp(self):
        """Prepare a private scratch directory and a unique virtual queue."""
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name).resolve() / "guard"
        self.adapter = MemoryPreferences()
        self.queue = "fdf_qa_" + uuid.uuid4().hex
        self.domain = prefs.printer_domain(self.queue)
        self.addCleanup(self.temp.cleanup)

    def test_global_conflict_and_unrelated_edits_survive(self):
        """Only exact checkpointed postimages revert; unrelated edits remain."""
        self.adapter.domains[prefs.GLOBAL] = {
            "Last Used Settings": {"original": 1},
            "unrelated": True,
        }
        prefs.start(self.directory, self.queue, self.adapter)
        settings = {"com.apple.print.PageToPaperMappingMediaName": "Letter"}
        self.adapter.domains[self.domain] = {prefs.LAST: settings}
        self.adapter.domains[prefs.GLOBAL]["Last Used Settings"] = {
            prefs.ID: "Last Used Settings",
            prefs.SETTINGS: settings,
        }
        prefs.checkpoint(
            self.directory,
            {
                "queue": self.queue,
                "locale": "en",
                "media": "Letter",
                "job_files": [{"name": "job.pdf", "sha256": "a" * 64, "bytes": 1}],
            },
            self.adapter,
        )
        self.adapter.domains[prefs.GLOBAL]["Last Used Settings"] = {"concurrent": 2}
        self.adapter.domains[prefs.GLOBAL]["unrelated"] = "changed"
        result = prefs.restore(self.directory, self.adapter)
        self.assertTrue(result["conflicts"])
        self.assertEqual(
            self.adapter.read(prefs.GLOBAL)["Last Used Settings"], {"concurrent": 2}
        )
        self.assertEqual(self.adapter.read(prefs.GLOBAL)["unrelated"], "changed")
        self.assertNotIn(prefs.LAST, self.adapter.read(self.domain))

    def test_seeded_changed_and_absent_values_roundtrip(self):
        """For generated baselines each recorded owned key returns to its prior value."""
        rng = random.Random(47931)
        for number in range(32):
            with self.subTest(seed=47931, case=number):
                directory = self.directory.with_name("g" + str(number))
                adapter = MemoryPreferences()
                original = (
                    {"Last Used Settings": {"seed": rng.randrange(10000)}}
                    if rng.choice([True, False])
                    else {}
                )
                adapter.domains[prefs.GLOBAL] = prefs.clone(original)
                prefs.start(directory, self.queue, adapter)
                setting = {
                    "com.apple.print.PageToPaperMappingMediaName": "A4",
                    "n": rng.randrange(100000),
                }
                adapter.domains[self.domain] = {prefs.LAST: setting}
                adapter.domains[prefs.GLOBAL]["Last Used Settings"] = {
                    prefs.ID: "Last Used Settings",
                    prefs.SETTINGS: setting,
                }
                evidence = {
                    "queue": self.queue,
                    "locale": "en",
                    "media": "A4",
                    "job_files": [
                        {"name": "a.pdf", "sha256": format(number, "064x"), "bytes": 1}
                    ],
                }
                prefs.checkpoint(directory, evidence, adapter)
                self.assertEqual(prefs.restore(directory, adapter)["conflicts"], [])
                self.assertEqual(adapter.read(prefs.GLOBAL), original)
                self.assertEqual(prefs.restore(directory, adapter)["conflicts"], [])

    def test_uncheckpointed_and_symlink_refused(self):
        """Unattributed changes and linked journals never become write authority."""
        prefs.start(self.directory, self.queue, self.adapter)
        self.adapter.domains[prefs.GLOBAL] = {"최근 사용한 설정": {"external": True}}
        self.assertTrue(prefs.restore(self.directory, self.adapter)["conflicts"])
        journal = self.directory / "journal.plist"
        journal.unlink()
        journal.symlink_to("/etc/passwd")
        with self.assertRaises(RuntimeError):
            prefs.restore(self.directory, self.adapter)

    def test_two_languages_and_media_restore_in_order(self):
        """Sequential English and Korean jobs restore both prior recent values."""
        original = {prefs.RECENT[0]: {"old": "en"}, prefs.RECENT[1]: {"old": "ko"}}
        self.adapter.domains[prefs.GLOBAL] = prefs.clone(original)
        prefs.start(self.directory, self.queue, self.adapter)
        for index, (language, media) in enumerate((("en", "Letter"), ("ko", "Legal"))):
            setting = {"com.apple.print.PageToPaperMappingMediaName": media}
            self.adapter.domains[self.domain] = {prefs.LAST: setting, "test-key": index}
            key = prefs.RECENT[index]
            self.adapter.domains[prefs.GLOBAL][key] = {
                prefs.ID: key,
                prefs.SETTINGS: setting,
            }
            evidence = {
                "queue": self.queue,
                "locale": language,
                "media": media,
                "job_files": [
                    {"name": "job.pdf", "sha256": str(index) * 64, "bytes": 10}
                ],
            }
            prefs.checkpoint(self.directory, evidence, self.adapter)
        self.assertEqual(prefs.restore(self.directory, self.adapter)["conflicts"], [])
        self.assertEqual(self.adapter.read(prefs.GLOBAL), original)
        self.assertEqual(self.adapter.read(self.domain), {})
        with self.assertRaises(RuntimeError):
            prefs.checkpoint(self.directory, evidence, self.adapter)

    def test_invalid_replayed_and_mismatched_evidence_is_rejected(self):
        """A stale job, wrong queue, wrong media, or mismatching settings cannot grant ownership."""
        prefs.start(self.directory, self.queue, self.adapter)
        evidence = {
            "queue": self.queue,
            "locale": "en",
            "media": "Letter",
            "job_files": [{"name": "a.pdf", "sha256": "a" * 64, "bytes": 10}],
        }
        setting = {"com.apple.print.PageToPaperMappingMediaName": "Letter"}
        self.adapter.domains[self.domain] = {prefs.LAST: setting}
        self.adapter.domains[prefs.GLOBAL] = {
            prefs.RECENT[0]: {
                prefs.ID: prefs.RECENT[0],
                prefs.SETTINGS: {"wrong": True},
            }
        }
        with self.assertRaises(RuntimeError):
            prefs.checkpoint(self.directory, evidence, self.adapter)
        self.adapter.domains[prefs.GLOBAL][prefs.RECENT[0]][prefs.SETTINGS] = setting
        for changed in (
            {**evidence, "queue": "physical"},
            {**evidence, "media": "Legal"},
            {**evidence, "job_files": []},
            {**evidence, "locale": "fr"},
            {
                **evidence,
                "job_files": [{"name": "../x", "sha256": "a" * 64, "bytes": 1}],
            },
        ):
            with self.assertRaises(RuntimeError):
                prefs.checkpoint(self.directory, changed, self.adapter)
        prefs.checkpoint(self.directory, evidence, self.adapter)
        with self.assertRaises(RuntimeError):
            prefs.checkpoint(self.directory, evidence, self.adapter)
        fresh_evidence = {
            **evidence,
            "job_files": [{"name": "a.pdf", "sha256": "b" * 64, "bytes": 10}],
        }
        with self.assertRaises(RuntimeError):
            prefs.checkpoint(self.directory, fresh_evidence, self.adapter)

    def test_invalid_queue_collision_and_linked_directory_are_rejected(self):
        """The guard never claims foreign queues, existing domains, or linked paths."""
        with self.assertRaises(RuntimeError):
            prefs.start(self.directory, "physical", self.adapter)
        self.adapter.domains[self.domain] = {"existing": 1}
        with self.assertRaises(RuntimeError):
            prefs.start(self.directory, self.queue, self.adapter)
        linked = self.directory.with_name("linked")
        linked.symlink_to(self.directory.parent, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            prefs.start(linked / "guard", self.queue, self.adapter)

    def test_interrupted_restore_can_be_retried(self):
        """The durable journal survives a write failure and permits idempotent recovery."""
        prefs.start(self.directory, self.queue, self.adapter)
        setting = {"com.apple.print.PageToPaperMappingMediaName": "Letter"}
        self.adapter.domains[self.domain] = {prefs.LAST: setting}
        self.adapter.domains[prefs.GLOBAL] = {
            prefs.RECENT[0]: {prefs.ID: prefs.RECENT[0], prefs.SETTINGS: setting}
        }
        evidence = {
            "queue": self.queue,
            "locale": "en",
            "media": "Letter",
            "job_files": [{"name": "a.pdf", "sha256": "a" * 64, "bytes": 10}],
        }
        prefs.checkpoint(self.directory, evidence, self.adapter)

        class FailOnce(MemoryPreferences):
            """Interrupt the first write while retaining shared backing values."""

            def set(self, domain, key, value):
                """Fail before the write to simulate a recoverable native error."""
                raise RuntimeError("simulated write failure")

        failing = FailOnce()
        failing.domains = self.adapter.domains
        with self.assertRaises(RuntimeError):
            prefs.restore(self.directory, failing)
        with self.assertRaises(RuntimeError):
            prefs.checkpoint(self.directory, evidence, self.adapter)
        self.assertEqual(prefs.restore(self.directory, self.adapter)["conflicts"], [])
        self.assertEqual(self.adapter.read(prefs.GLOBAL), {})
        self.assertEqual(self.adapter.read(self.domain), {})

    def test_real_and_memory_adapter_roundtrip_types(self):
        """Both adapters preserve typed values and absence in separate owned domains."""
        values = {
            "bool": True,
            "int": 9,
            "float": 1.25,
            "data": b"\x00\xff",
            "date": datetime.datetime(2020, 2, 3, 4, 5, 6),
            "dict": {"list": [True, 3, "x"]},
        }
        for adapter in (MemoryPreferences(), prefs.CFPreferences()):
            domain = "org.example.finder-pdf-qa-" + uuid.uuid4().hex
            with self.subTest(adapter=type(adapter).__name__):
                path = Path.home() / "Library" / "Preferences" / (domain + ".plist")
                self.assertFalse(path.exists())
                self.assertEqual(adapter.read(domain), {})
                try:
                    for key, value in values.items():
                        adapter.set(domain, key, {"present": True, "value": value})
                    self.assertEqual(
                        prefs.encode(adapter.read(domain)), prefs.encode(values)
                    )
                    adapter.set(domain, "bool", {"present": False})
                    self.assertNotIn("bool", adapter.read(domain))
                finally:
                    for key in values:
                        adapter.set(domain, key, {"present": False})
                    self.assertEqual(adapter.read(domain), {})
                    if isinstance(adapter, prefs.CFPreferences) and path.exists():
                        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, "rb") as stream:
                            info = os.fstat(stream.fileno())
                            self.assertTrue(
                                stat.S_ISREG(info.st_mode)
                                and info.st_uid == os.getuid()
                            )
                            on_disk = plistlib.load(stream)
                            self.assertTrue(set(on_disk).issubset(values))
                            for key, value in on_disk.items():
                                self.assertEqual(
                                    prefs.encode(value), prefs.encode(values[key])
                                )
                            self.assertEqual(os.lstat(path).st_ino, info.st_ino)
                            path.unlink()


if __name__ == "__main__":
    unittest.main()
