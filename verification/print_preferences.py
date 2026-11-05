"""Keep narrowly owned print-test preference changes recoverable (Python 3.9+).

CFPreferences has no compare-and-swap: even immediate compare/write/recheck
cannot exclude a concurrent write in between. Run native tests while other print
panels are idle. A checkpoint requires the caller to verify a new captured job
for the exact queue; matching settings alone cannot prove who changed a preset.
"""

import ctypes
import ctypes.util
import os
import plistlib
import re
import stat
import uuid
from pathlib import Path

__all__ = ["CFPreferences", "checkpoint", "encode", "report", "restore", "start"]

GLOBAL = "com.apple.print.custompresets"
RECENT = ("Last Used Settings", "최근 사용한 설정")
LAST = "com.apple.print.v2.lastUsedSettingsPref"
ID = "com.apple.print.preset.id"
SETTINGS = "com.apple.print.preset.settings"
QUEUE = re.compile(r"fdf_qa_[0-9a-f]{32}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
MAX_BYTES = 16 * 1024 * 1024


def encode(value):
    """Serialize property-list values deterministically, including their types."""
    return plistlib.dumps(value, fmt=plistlib.FMT_BINARY, sort_keys=True)


def clone(value):
    """Detach values as a typed property-list round trip."""
    return plistlib.loads(encode(value))


def printer_domain(queue):
    """Bind the only writable per-printer domain to a unique QA queue name."""
    if not isinstance(queue, str) or not QUEUE.fullmatch(queue):
        raise RuntimeError("Invalid owned queue")
    return GLOBAL + ".forprinter." + queue


class CFPreferences:
    """Read and write individual current-user, any-host preference values."""

    def __init__(self):
        """Bind the native CoreFoundation API without third-party dependencies."""
        self.cf = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
        p = ctypes.c_void_p
        for name, result, args in (
            ("CFStringCreateWithCString", p, [p, ctypes.c_char_p, ctypes.c_uint32]),
            ("CFDataCreate", p, [p, p, ctypes.c_long]),
            ("CFPropertyListCreateWithData", p, [p, p, ctypes.c_ulong, p, p]),
            ("CFPropertyListCreateData", p, [p, p, ctypes.c_long, ctypes.c_ulong, p]),
            ("CFDataGetLength", ctypes.c_long, [p]),
            ("CFDataGetBytePtr", p, [p]),
            ("CFPreferencesCopyKeyList", p, [p, p, p]),
            ("CFPreferencesCopyValue", p, [p, p, p, p]),
            ("CFPreferencesSetValue", None, [p, p, p, p, p]),
            ("CFPreferencesSynchronize", ctypes.c_bool, [p, p, p]),
            ("CFRelease", None, [p]),
        ):
            function = getattr(self.cf, name)
            function.restype, function.argtypes = result, args
        self.user = p.in_dll(self.cf, "kCFPreferencesCurrentUser")
        self.host = p.in_dll(self.cf, "kCFPreferencesAnyHost")

    def _string(self, text):
        """Create a native Unicode string from a Python string."""
        result = self.cf.CFStringCreateWithCString(
            None, text.encode("utf-8"), 0x08000100
        )
        if not result:
            raise RuntimeError("Cannot create preference identifier")
        return result

    def _from_native(self, value):
        """Decode a native property list while preserving supported types."""
        data = self.cf.CFPropertyListCreateData(None, value, 200, 0, None)
        if not data:
            raise RuntimeError("Cannot serialize preference value")
        try:
            length = self.cf.CFDataGetLength(data)
            if length > MAX_BYTES:
                raise RuntimeError("Preference domain exceeds size limit")
            return plistlib.loads(
                ctypes.string_at(self.cf.CFDataGetBytePtr(data), length)
            )
        finally:
            self.cf.CFRelease(data)

    def _to_native(self, value):
        """Encode an approved property-list value as a native object."""
        data = encode(value)
        buffer = ctypes.create_string_buffer(data)
        native_data = self.cf.CFDataCreate(None, buffer, len(data))
        if not native_data:
            raise RuntimeError("Cannot allocate preference value")
        try:
            result = self.cf.CFPropertyListCreateWithData(
                None, native_data, 0, None, None
            )
            if not result:
                raise RuntimeError("Cannot decode preference value")
            return result
        finally:
            self.cf.CFRelease(native_data)

    def read(self, domain):
        """Synchronize and return all explicit keys in one preference domain."""
        app = self._string(domain)
        try:
            if not self.cf.CFPreferencesSynchronize(app, self.user, self.host):
                raise RuntimeError("Cannot synchronize preference domain")
            keys = self.cf.CFPreferencesCopyKeyList(app, self.user, self.host)
            if not keys:
                return {}
            try:
                names = self._from_native(keys)
            finally:
                self.cf.CFRelease(keys)
            values = {}
            for name in names:
                key = self._string(name)
                try:
                    value = self.cf.CFPreferencesCopyValue(
                        key, app, self.user, self.host
                    )
                    if value:
                        try:
                            values[name] = self._from_native(value)
                        finally:
                            self.cf.CFRelease(value)
                finally:
                    self.cf.CFRelease(key)
            return values
        finally:
            self.cf.CFRelease(app)

    def set(self, domain, name, state):
        """Write or remove exactly one key and synchronize its domain."""
        app, key = self._string(domain), self._string(name)
        value = self._to_native(state["value"]) if state["present"] else None
        try:
            self.cf.CFPreferencesSetValue(key, value, app, self.user, self.host)
            if not self.cf.CFPreferencesSynchronize(app, self.user, self.host):
                raise RuntimeError("Cannot synchronize preference write")
        finally:
            if value:
                self.cf.CFRelease(value)
            self.cf.CFRelease(key)
            self.cf.CFRelease(app)


def value_at(domain, key):
    """Distinguish a missing preference from any explicitly stored value."""
    return (
        {"present": True, "value": domain[key]} if key in domain else {"present": False}
    )


def same(a, b):
    """Compare property lists without treating booleans as integers."""
    return encode(a) == encode(b)


def _directory(path):
    """Require a private real directory without any symlink path component."""
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise RuntimeError("Preference journal directory must be absolute and unlinked")
    info = path.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise RuntimeError("Preference journal directory must be private and owned")
    return path


def _read_file(path):
    """Open and validate private state on the actual file descriptor."""
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or info.st_mode & 0o077
                or info.st_size > MAX_BYTES
            ):
                raise RuntimeError("Invalid private preference journal")
            return stream.read(MAX_BYTES + 1)
    except OSError as error:
        raise RuntimeError("Cannot open private preference journal") from error


def _save(path, state):
    """Durably replace the private journal without following a target symlink."""
    data = encode(state)
    if len(data) > MAX_BYTES:
        raise RuntimeError("Preference journal exceeds size limit")
    tmp = path.with_name(".journal-" + uuid.uuid4().hex)
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(str(tmp), str(path))
        parent = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if tmp.exists():
            tmp.unlink()


def _load(directory):
    """Parse and validate persisted authority before any preference writes."""
    path = _directory(directory) / "journal.plist"
    try:
        state = plistlib.loads(_read_file(path))
        if (
            set(state) != {"version", "queue", "baseline", "owned", "jobs", "phase"}
            or state["version"] != 1
        ):
            raise ValueError("unexpected journal structure")
        domain = printer_domain(state["queue"])
        if set(state["baseline"]) != {GLOBAL, domain} or set(state["owned"]) != {
            GLOBAL,
            domain,
        }:
            raise ValueError("unexpected domain")
        if state["phase"] not in ("active", "restoring") or not isinstance(
            state["jobs"], list
        ):
            raise ValueError("invalid jobs")
        for name in (GLOBAL, domain):
            if not isinstance(state["baseline"][name], dict) or not isinstance(
                state["owned"][name], dict
            ):
                raise TypeError("invalid values")
        if set(state["owned"][GLOBAL]) - set(RECENT):
            raise ValueError("global key outside allowlist")
        for entries in state["owned"].values():
            for entry in entries.values():
                if (
                    not isinstance(entry, dict)
                    or set(entry) not in ({"present"}, {"present", "value"})
                    or type(entry["present"]) is not bool
                    or entry["present"] != ("value" in entry)
                ):
                    raise ValueError("invalid postimage")
        return path, state
    except (ValueError, TypeError, KeyError, plistlib.InvalidFileException) as error:
        raise RuntimeError("Invalid private preference journal") from error


def _raw_backup(directory, domain):
    """Copy the existing preference file privately for manual recovery only."""
    source = Path.home() / "Library" / "Preferences" / (domain + ".plist")
    try:
        fd = os.open(str(source), os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_size > MAX_BYTES
        ):
            raise RuntimeError("Unsafe original preference file")
        data = stream.read(MAX_BYTES + 1)
    target = directory / (domain + ".raw.plist")
    fd = os.open(
        str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def start(directory, queue, adapter=None):
    """Back up the current global and owned-queue preferences before any test."""
    adapter = adapter or CFPreferences()
    domain = printer_domain(queue)
    directory = Path(directory)
    if not directory.is_absolute() or directory.parent.resolve() != directory.parent:
        raise RuntimeError("Preference directory must have an unlinked absolute parent")
    directory.mkdir(mode=0o700)
    _directory(directory)
    baseline = {GLOBAL: adapter.read(GLOBAL), domain: adapter.read(domain)}
    if domain and baseline[domain]:
        raise RuntimeError("Owned queue preference domain already exists")
    if isinstance(adapter, CFPreferences):
        for item in (GLOBAL, domain):
            _raw_backup(directory, item)
    state = {
        "version": 1,
        "queue": queue,
        "baseline": baseline,
        "owned": {GLOBAL: {}, domain: {}},
        "jobs": [],
        "phase": "active",
    }
    _save(directory / "journal.plist", state)
    return report(directory, adapter)


def checkpoint(directory, evidence, adapter=None):
    """Record only matching recent settings following a caller-verified owned job."""
    adapter = adapter or CFPreferences()
    path, state = _load(directory)
    queue = state["queue"]
    domain = printer_domain(queue)
    if state["phase"] != "active":
        raise RuntimeError("Restoration already started")
    if (
        set(evidence) != {"queue", "locale", "media", "job_files"}
        or evidence["queue"] != queue
    ):
        raise RuntimeError("Invalid job evidence")
    if (
        evidence["locale"] not in ("en", "ko")
        or not isinstance(evidence["media"], str)
        or not evidence["media"]
    ):
        raise RuntimeError("Invalid job language or media")
    files = evidence["job_files"]
    if not isinstance(files, list) or not files:
        raise RuntimeError("Missing captured job")
    hashes = []
    for item in files:
        if (
            not isinstance(item, dict)
            or set(item) != {"name", "sha256", "bytes"}
            or not isinstance(item["name"], str)
            or not item["name"]
            or "/" in item["name"]
            or not isinstance(item["sha256"], str)
            or not SHA.fullmatch(item["sha256"])
            or type(item["bytes"]) is not int
            or item["bytes"] <= 0
        ):
            raise RuntimeError("Invalid captured job evidence")
        hashes.append(item["sha256"])
    if len(set(hashes)) != len(hashes) or any(item in state["jobs"] for item in hashes):
        raise RuntimeError("Captured job already checkpointed")
    current = {GLOBAL: adapter.read(GLOBAL), domain: adapter.read(domain)}
    locale_key = RECENT[0 if evidence["locale"] == "en" else 1]
    if locale_key in state["owned"][GLOBAL]:
        raise RuntimeError("Locale already checkpointed")
    preset = current[GLOBAL].get(locale_key)
    owned_settings = current[domain].get(LAST)
    if (
        not isinstance(preset, dict)
        or preset.get(ID) != locale_key
        or not isinstance(owned_settings, dict)
        or not isinstance(preset.get(SETTINGS), dict)
        or not same(preset[SETTINGS], owned_settings)
    ):
        raise RuntimeError("Recent preset does not match owned printer settings")
    paper = owned_settings.get("com.apple.print.PageToPaperMappingMediaName")
    media_names = {
        "na_letter_8.5x11in": "Letter",
        "na_legal_8.5x14in": "Legal",
        "iso_a4_210x297mm": "A4",
    }
    if paper != media_names.get(evidence["media"], evidence["media"]):
        raise RuntimeError("Owned printer media does not match captured job")
    other = RECENT[1 if locale_key == RECENT[0] else 0]
    expected = state["owned"][GLOBAL].get(
        other, value_at(state["baseline"][GLOBAL], other)
    )
    if not same(value_at(current[GLOBAL], other), expected):
        raise RuntimeError("Other recent preset changed without a checkpoint")
    # The locale's changed value is attributable only under the caller's verified job.
    state["owned"][GLOBAL][locale_key] = value_at(current[GLOBAL], locale_key)
    for key in set(state["baseline"][domain]) | set(current[domain]):
        state["owned"][domain][key] = value_at(current[domain], key)
    state["jobs"].extend(hashes)
    _save(path, state)
    return report(directory, adapter)


def restore(directory, adapter=None):
    """Restore only exact checkpointed postimages and report every conflict."""
    adapter = adapter or CFPreferences()
    path, state = _load(directory)
    domain = printer_domain(state["queue"])
    if state["phase"] == "active":
        state["phase"] = "restoring"
        _save(path, state)
    conflicts = []
    for name in (GLOBAL, domain):
        keys = (
            set(RECENT)
            if name == GLOBAL
            else set(state["baseline"][name])
            | set(state["owned"][name])
            | set(adapter.read(name))
        )
        for key in sorted(keys):
            current = value_at(adapter.read(name), key)
            baseline = value_at(state["baseline"][name], key)
            if same(current, baseline):
                continue
            postimage = state["owned"][name].get(key)
            if postimage is None or not same(current, postimage):
                conflicts.append({"domain": name, "key": key})
                continue
            adapter.set(name, key, baseline)
            if not same(value_at(adapter.read(name), key), baseline):
                conflicts.append({"domain": name, "key": key})
    return {
        "queue": state["queue"],
        "conflicts": conflicts,
        "checkpointed_jobs": len(state["jobs"]),
    }


def report(directory, adapter=None):
    """Describe journal identity and checkpoints without exposing private values."""
    _, state = _load(directory)
    return {
        "queue": state["queue"],
        "checkpointed_jobs": len(state["jobs"]),
        "checkpointed_recent": sorted(state["owned"][GLOBAL]),
    }
