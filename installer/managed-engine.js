/* Private managed installation engine. Only managed-install.sh is public. */
ObjC.import("Foundation");
ObjC.import("stdlib");
var fm = $.NSFileManager.defaultManager;
var env = $.NSProcessInfo.processInfo.environment;
var enc = $.NSUTF8StringEncoding;
var names = [
  "PDF로 변환.workflow",
  "용지에 맞춰 인쇄.workflow",
  "PDF 합치기.workflow",
];
var resources = [
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
];
var metadata = [
  "Contents/Info.plist",
  "Contents/document.wflow",
  "Contents/Resources/en.lproj/InfoPlist.strings",
  "Contents/Resources/ko.lproj/InfoPlist.strings",
];
var backend = [
  "install.sh",
  "doctor.sh",
  "installer/managed-install.sh",
  "installer/managed-engine.js",
  "installer/stage-managed.sh",
];
var maxFiles = 500,
  maxBytes = 100 * 1024 * 1024;
/** Unwrap a bridged value while preserving missing values. */
function value(x) {
  return x === null || x === undefined ? null : ObjC.unwrap(x);
}
/** Read one process environment value. */
function envValue(k) {
  return value(env.objectForKey($(k)));
}
/** Normalize a path lexically without rewriting Unicode bytes. */
function path(p) {
  var out = [];
  p.split("/").forEach(function (v) {
    if (!v || v === ".") return;
    if (v === "..") out.pop();
    else out.push(v);
  });
  return "/" + out.join("/");
}
/** Read bounded lstat metadata without requesting extended attributes. */
function attrs(p) {
  var r = command(
    "/usr/bin/env",
    [
      "LC_ALL=C",
      "/usr/bin/stat",
      "-f",
      "%HT|%d|%i|%l|%z|%Lp|%u|%g|%.9Fm",
      "--",
      p,
    ],
    true,
  );
  if (r.code !== 0) {
    if (/No such file or directory\n?$/.test(r.error)) return null;
    throw new Error("stat");
  }
  return parseStat(r.output.trim());
}
/** Parse the fixed lstat fields without accepting malformed output. */
function parseStat(line) {
  var parts = line.split("|");
  if (
    parts.length !== 9 ||
    !parts.slice(1, 8).every(function (x) {
      return /^\d+$/.test(x);
    }) ||
    !/^-?\d+\.\d+$/.test(parts[8])
  )
    throw new Error("stat");
  var types = {
    "Regular File": "NSFileTypeRegular",
    Directory: "NSFileTypeDirectory",
    "Symbolic Link": "NSFileTypeSymbolicLink",
  };
  return {
    NSFileType: types[parts[0]] || "NSFileTypeUnknown",
    NSFileSystemNumber: parts[1],
    NSFileSystemFileNumber: parts[2],
    NSFileReferenceCount: Number(parts[3]),
    NSFileSize: Number(parts[4]),
    NSFilePosixPermissions: parseInt(parts[5], 8),
    NSFileOwnerAccountID: Number(parts[6]),
    NSFileGroupOwnerAccountID: Number(parts[7]),
    modified: Number(parts[8]),
  };
}
/** Return the filesystem type recorded in an attribute dictionary. */
function type(a) {
  return a ? a.NSFileType : null;
}
/** Check for an entry including a broken symbolic link. */
function exists(p) {
  return attrs(p) !== null;
}
/** Read a numeric filesystem attribute. */
function number(a, k) {
  return Number(a[value(k)]);
}
/** Preserve a filesystem identity as a decimal string. */
function identity(a, k) {
  return String(a[value(k)]);
}
/** List a directory or fail closed on an unreadable directory. */
function listing(p) {
  var x = fm.contentsOfDirectoryAtPathError($(p), null);
  if (x.isNil()) throw new Error("read");
  return ObjC.deepUnwrap(x);
}
/** Read at most one MiB of UTF-8 without accepting invalid bytes. */
function textFile(p) {
  var f = $.NSFileHandle.fileHandleForReadingAtPath($(p));
  if (f.isNil()) throw new Error("read");
  var d;
  try {
    d = f.readDataOfLength(1024 * 1024 + 1);
  } finally {
    f.closeFile;
  }
  if (Number(d.length) > 1024 * 1024) throw new Error("read");
  var s = $.NSString.alloc.initWithDataEncoding(d, enc);
  if (s.isNil()) throw new Error("utf8");
  return value(s);
}
/** Atomically replace and synchronize a journal file. */
function writeFile(p, s) {
  var data = $(s).dataUsingEncoding(enc);
  if (!data.writeToFileAtomically($(p), true)) throw new Error("write");
  var f = $.NSFileHandle.fileHandleForWritingAtPath($(p));
  if (f.isNil()) throw new Error("write");
  f.synchronizeFile;
  f.closeFile;
}
/** Run a fixed executable, optionally lending the held lock to its stdin, and collect output. */
function command(bin, args, captureError, outputLimit, borrowLock) {
  var t = $.NSTask.alloc.init;
  t.launchPath = $(bin);
  t.arguments = $(args);
  if (borrowLock)
    t.standardInput = $.NSFileHandle.alloc.initWithFileDescriptorCloseOnDealloc(
      9,
      false,
    );
  var pipe = $.NSPipe.pipe;
  var errorPipe = captureError ? $.NSPipe.pipe : null;
  t.standardOutput = pipe;
  t.standardError = captureError
    ? errorPipe
    : $.NSFileHandle.fileHandleWithNullDevice;
  t.launch;
  var data = outputLimit
    ? pipe.fileHandleForReading.readDataOfLength(outputLimit + 1)
    : pipe.fileHandleForReading.readDataToEndOfFile;
  if (outputLimit && Number(data.length) > outputLimit) {
    t.terminate;
    t.waitUntilExit;
    throw new Error("output");
  }
  t.waitUntilExit;
  var s = $.NSString.alloc.initWithDataEncoding(data, enc);
  var errorData = captureError
    ? errorPipe.fileHandleForReading.readDataToEndOfFile
    : null;
  var errorString = captureError
    ? $.NSString.alloc.initWithDataEncoding(errorData, enc)
    : null;
  return {
    code: Number(t.terminationStatus),
    output: s.isNil() ? "" : value(s),
    error: captureError && !errorString.isNil() ? value(errorString) : "",
  };
}
/** Hold the existing directory lock until a fixed mutating subprocess exits. */
function lockedCommand(bin, args) {
  return command(
    "/bin/bash",
    [
      "-c",
      '[ -d /dev/fd/0 ] || exit 70; "$@"; status=$?; exit "$status"',
      "lock-holder",
      bin,
    ].concat(args),
    false,
    undefined,
    true,
  );
}
/** Bound one owned subprocess group, including its shell-launched descendants. */
function boundedCommand(bin, args, seconds) {
  var wrapper =
    'set -u; limit=$1; shift; group=$(/bin/ps -o pgid= -p "$$") || exit 70; group=${group//[[:space:]]/}; [ "$group" = "$$" ] || exit 70; ( /bin/sleep "$limit" & nap=$!; trap \'/bin/kill -TERM "$nap" 2>/dev/null; exit 0\' TERM; wait "$nap" || exit 0; /bin/kill -TERM -- "-$$" ) & watchdog=$!; "$@"; status=$?; /bin/kill -TERM "$watchdog" 2>/dev/null || :; wait "$watchdog" 2>/dev/null || :; exit "$status"';
  return command(
    "/bin/bash",
    ["-c", wrapper, "bounded", String(seconds), bin].concat(args),
  );
}
/** Flush filesystem changes before advancing a durable transaction. */
function sync() {
  if (command("/bin/sync", []).code !== 0) throw new Error("sync");
}
/** Create one private directory without following an existing member. */
function mkdir(p) {
  if (
    !fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
      $(p),
      false,
      $(),
      null,
    )
  )
    throw new Error("mkdir");
}
/** Rename one known filesystem entry without overwriting a destination. */
function move(a, b) {
  if (!fm.moveItemAtPathToPathError($(a), $(b), null)) throw new Error("move");
}
/** Remove one previously validated transaction member. */
function remove(p) {
  if (!fm.removeItemAtPathError($(p), null)) throw new Error("remove");
}
/** Read the exact symbolic link target as a string. */
function link(p) {
  var v = fm.destinationOfSymbolicLinkAtPathError($(p), null);
  return v ? value(v) : null;
}
/* Snapshot every member including inode and file bytes, without following links. */
/** Capture bounded content, identity and permissions for an entire tree. */
function snapshot(root) {
  if (!exists(root)) return null;
  if (!plainDirectory(root)) throw new Error("unsafe");
  // find is confined to this directory and does not follow symbolic links.
  var found = command(
    "/bin/bash",
    ["-c", 'cd -P -- "$1" && /usr/bin/find -s -P . -print0', "snapshot", root],
    false,
    200000,
  );
  if (found.code !== 0 || !found.output.endsWith("\0"))
    throw new Error("unsafe");
  var relative = found.output.slice(0, -1).split("\0");
  if (!relative.length || relative.length > maxFiles || relative[0] !== ".")
    throw new Error("unsafe");
  var files = [],
    fileEntries = [],
    entries = [],
    paths = [],
    bytes = 0,
    argumentBytes = 0;
  relative.forEach(function (name, index) {
    if ((index && name.indexOf("./") !== 0) || (!index && name !== "."))
      throw new Error("unsafe");
    var rel = index ? name.slice(2) : "";
    if (
      rel.split("/").length > 32 ||
      rel.split("/").some(function (part) {
        return part === "." || part === "..";
      })
    )
      throw new Error("unsafe");
    var full = rel ? root + "/" + rel : root;
    argumentBytes += Number($(full).lengthOfBytesUsingEncoding(enc)) + 1;
    if (argumentBytes > 300000) throw new Error("unsafe");
    paths.push(full);
  });
  var stats = command(
    "/usr/bin/env",
    [
      "LC_ALL=C",
      "/usr/bin/stat",
      "-f",
      "%HT|%d|%i|%l|%z|%Lp|%u|%g|%.9Fm",
      "--",
    ].concat(paths),
    false,
    100000,
  );
  if (stats.code !== 0) throw new Error("unsafe");
  var lines = stats.output.trimEnd().split("\n");
  if (lines.length !== paths.length) throw new Error("unsafe");
  paths.forEach(function (full, index) {
    var a = parseStat(lines[index]),
      t = type(a),
      rel = index ? relative[index].slice(2) : "";
    var entry = [
      rel,
      t,
      identity(a, $.NSFileSystemNumber),
      identity(a, $.NSFileSystemFileNumber),
      null,
      number(a, $.NSFilePosixPermissions),
      number(a, $.NSFileOwnerAccountID),
      number(a, $.NSFileGroupOwnerAccountID),
      a.modified,
    ];
    if (t === "NSFileTypeRegular") {
      if (number(a, $.NSFileReferenceCount) !== 1) throw new Error("unsafe");
      bytes += number(a, $.NSFileSize);
      if (bytes > maxBytes) throw new Error("unsafe");
      files.push(full);
      fileEntries.push(entry);
    } else if (t === "NSFileTypeSymbolicLink") entry[4] = link(full);
    else if (t !== "NSFileTypeDirectory") throw new Error("unsafe");
    entries.push(entry);
  });
  if (files.length) {
    var hashes = command(
      "/usr/bin/shasum",
      ["-a", "256"].concat(files),
      false,
      200000,
    );
    if (hashes.code !== 0) throw new Error("hash");
    var digests = hashes.output.trimEnd().split("\n");
    if (digests.length !== files.length) throw new Error("hash");
    digests.forEach(function (line, index) {
      var match = line.match(/^\\?([a-f0-9]{64})  /);
      if (!match) throw new Error("hash");
      fileEntries[index][4] = match[1];
    });
  }
  return entries;
}
/** Compare serialized snapshot values exactly. */
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Accept only an actual directory at a path. */
function plainDirectory(p) {
  return type(attrs(p)) === "NSFileTypeDirectory";
}
/** Validate each parent and optionally create missing private directories. */
function parents(p, create) {
  var bits = p.split("/"),
    now = "";
  for (var i = 1; i < bits.length; i++) {
    now += "/" + bits[i];
    if (!exists(now)) {
      if (!create) return false;
      mkdir(now);
    }
    if (!plainDirectory(now)) throw new Error("unsafe");
  }
  return true;
}
/* Only these exact payload members can be copied into managed storage. */
/** Recognize the complete bounded installation payload before any copy. */
function payload(p, managed) {
  if (!plainDirectory(p)) throw new Error("payload");
  var expected = resources.concat(backend);
  if (managed) expected.push(".finder-pdf-receipt.json");
  names.forEach(function (n) {
    metadata.forEach(function (m) {
      expected.push(n + "/" + m);
    });
  });
  var allowed = {};
  expected.forEach(function (f) {
    var parts = f.split("/");
    for (var i = 1; i <= parts.length; i++)
      allowed[parts.slice(0, i).join("/").normalize("NFC")] =
        i === parts.length ? "file" : "dir";
  });
  var seen = {},
    count = 0,
    bytes = 0;
  function walk(d, rel) {
    listing(d).forEach(function (n) {
      var sub = rel ? rel + "/" + n : n,
        key = sub.normalize("NFC"),
        a = attrs(d + "/" + n),
        t = type(a),
        kind =
          t === "NSFileTypeDirectory"
            ? "dir"
            : t === "NSFileTypeRegular"
              ? "file"
              : "bad";
      if (++count > 100 || seen[key] || allowed[key] !== kind)
        throw new Error("payload");
      seen[key] = true;
      if (kind === "file") {
        if (number(a, $.NSFileReferenceCount) !== 1) throw new Error("payload");
        bytes += number(a, $.NSFileSize);
        if (bytes > maxBytes) throw new Error("payload");
      } else walk(d + "/" + n, sub);
    });
  }
  walk(p, "");
  if (Object.keys(seen).length !== Object.keys(allowed).length)
    throw new Error("payload");
}
/** Check the standard optional-app locations without launching apps. */
function appPresence(home) {
  var apps = [
      "Hancom Office HWP",
      "Microsoft Word",
      "Microsoft PowerPoint",
      "Microsoft Excel",
    ],
    r = {};
  ["hwp", "word", "powerpoint", "excel"].forEach(function (k, i) {
    r[k] =
      plainDirectory("/Applications/" + apps[i] + ".app") ||
      plainDirectory(home + "/Applications/" + apps[i] + ".app");
  });
  return r;
}
/* Reject unexpected whole-bundle members before replacing any workflow. */
/** Refuse all unexpected workflow members before replacing a bundle. */
function exactWorkflow(p, index) {
  var expected = [
    "Contents",
    "Contents/project",
    "Contents/Info.plist",
    "Contents/document.wflow",
    "Contents/Resources",
    "Contents/Resources/en.lproj",
    "Contents/Resources/ko.lproj",
    "Contents/Resources/en.lproj/InfoPlist.strings",
    "Contents/Resources/ko.lproj/InfoPlist.strings",
  ];
  if (index === 0) {
    resources.forEach(function (n) {
      expected.push("Contents/Resources/" + n);
    });
    expected.push(
      "Contents/Resources/review-app.sha256",
      "Contents/Resources/print-app.sha256",
      "Contents/Resources/Finder PDF Review.app",
      "Contents/Resources/Finder PDF Print.app",
    );
  }
  var found = [];
  function walk(dir, rel) {
    listing(dir).forEach(function (n) {
      var s = rel ? rel + "/" + n : n,
        key = s.normalize("NFC");
      if (
        index === 0 &&
        (key.indexOf("Contents/Resources/Finder PDF Review.app/") === 0 ||
          key.indexOf("Contents/Resources/Finder PDF Print.app/") === 0)
      )
        return;
      found.push(key);
      var a = attrs(dir + "/" + n);
      if (type(a) === "NSFileTypeDirectory") walk(dir + "/" + n, s);
    });
  }
  walk(p, "");
  expected = expected
    .map(function (s) {
      return s.normalize("NFC");
    })
    .sort();
  found.sort();
  return same(expected, found);
}
/** Refuse linked or missing source ancestors and nonregular source members. */
function sourceIsSafe(owner) {
  var files = resources.map(function (name) {
    return owner + "/" + name;
  });
  var roots = names.map(function (name) {
    return owner + "/" + name;
  });
  var levels = [
    roots,
    roots.map(function (p) {
      return p + "/Contents";
    }),
    roots.map(function (p) {
      return p + "/Contents/Resources";
    }),
    roots.reduce(function (acc, p) {
      return acc.concat([
        p + "/Contents/Resources/en.lproj",
        p + "/Contents/Resources/ko.lproj",
      ]);
    }, []),
  ];
  names.forEach(function (name) {
    metadata.forEach(function (member) {
      files.push(owner + "/" + name + "/" + member);
    });
  });
  /** Read one verified-depth group without treating paths as shell code. */
  function batch(paths) {
    if (
      paths.reduce(function (n, p) {
        return n + p.length * 4 + 1;
      }, 0) > 100000
    )
      throw new Error("unsafe");
    var r = command(
      "/usr/bin/env",
      [
        "LC_ALL=C",
        "/usr/bin/stat",
        "-f",
        "%HT|%d|%i|%l|%z|%Lp|%u|%g|%.9Fm",
        "--",
      ].concat(paths),
      false,
      100000,
    );
    if (r.code !== 0) throw new Error("unsafe");
    var lines = r.output.trimEnd().split("\n");
    if (lines.length !== paths.length) throw new Error("unsafe");
    return lines.map(parseStat);
  }
  for (var i = 0; i < levels.length; i++)
    if (
      batch(levels[i]).some(function (item) {
        return type(item) !== "NSFileTypeDirectory";
      })
    )
      return false;
  var total = 0,
    members = batch(files);
  for (var k = 0; k < members.length; k++) {
    var item = members[k];
    if (
      type(item) !== "NSFileTypeRegular" ||
      number(item, $.NSFileReferenceCount) !== 1
    )
      return false;
    total += number(item, $.NSFileSize);
    if (total > maxBytes) return false;
  }
  return true;
}
/** Verify one owner, source, links, native inventory and signatures. */
function proof(ctx, owner) {
  if (!plainDirectory(owner)) return "legacy-source-unavailable";
  try {
    if (!sourceIsSafe(owner)) return "modified-item";
  } catch (_) {
    return "modified-item";
  }
  for (var i = 0; i < 3; i++) {
    var w = ctx.targets[i + 1];
    if (
      !plainDirectory(w) ||
      !exactWorkflow(w, i) ||
      type(attrs(w + "/Contents/project")) !== "NSFileTypeSymbolicLink" ||
      link(w + "/Contents/project").normalize("NFC") !== owner.normalize("NFC")
    )
      return "owner-mismatch";
    try {
      snapshot(w);
    } catch (_) {
      return "modified-item";
    }
  }
  var appDirs = [
    "",
    "Contents",
    "Contents/MacOS",
    "Contents/Resources",
    "Contents/Resources/Scripts",
    "Contents/_CodeSignature",
  ].sort();
  for (var a = 0; a < 2; a++) {
    var app =
      ctx.targets[1] +
      "/Contents/Resources/" +
      ["Finder PDF Review.app", "Finder PDF Print.app"][a];
    var dirs;
    try {
      dirs = snapshot(app)
        .filter(function (v) {
          return v[1] === "NSFileTypeDirectory";
        })
        .map(function (v) {
          return v[0];
        })
        .sort();
    } catch (_) {
      return "modified-item";
    }
    if (!same(dirs, appDirs)) return "modified-item";
  }
  /* Read the original bytes inside Bash: NSTask may decompose Unicode argv. */
  var shell =
    'set -eu; marker="$2/Contents/Resources/Finder PDF Review.app/Contents/Resources/finder-pdf-owner"; own=$(cat "$marker"; printf .); own=${own%.}; for w in "$2" "$3" "$4"; do l=$(readlink "$w/Contents/project"; printf .); l=${l%.}; l=${l%$\'\\n\'}; [ "$l" = "$own" ] || exit 1; done; exec /bin/bash "$1" --source-root "$own"';
  var diag = boundedCommand(
    "/bin/bash",
    [
      "-c",
      shell,
      "proof",
      ctx.engineDir + "/../doctor.sh",
      ctx.targets[1],
      ctx.targets[2],
      ctx.targets[3],
    ],
    30,
  );
  if (diag.code === 15 || diag.code === 70) return "legacy-source-unavailable";
  return diag.code === 0 ? null : "modified-item";
}
/** Classify current files without mutating the user installation. */
function inspect(ctx) {
  if (exists(ctx.txn)) {
    try {
      var a = attrs(ctx.txn);
      if (type(a) !== "NSFileTypeDirectory") throw new Error("unsafe");
      var j = loadJournal(ctx);
      if (
        same(
          [
            identity(a, $.NSFileSystemNumber),
            identity(a, $.NSFileSystemFileNumber),
          ],
          j.txn,
        )
      )
        return { kind: "recovery-required", code: "interrupted" };
    } catch (_) {}
    return { kind: "recovery-required", code: "recovery-conflict" };
  }
  var any = false;
  for (var i = 0; i < 4; i++) if (exists(ctx.targets[i])) any = true;
  if (!any) return { kind: "fresh", apps: appPresence(ctx.home) };
  if (
    !exists(ctx.targets[1]) ||
    !exists(ctx.targets[2]) ||
    !exists(ctx.targets[3])
  )
    return { kind: "conflict", code: "foreign-item" };
  var owner = link(ctx.targets[1] + "/Contents/project");
  if (!owner || owner.charAt(0) !== "/")
    return { kind: "conflict", code: "foreign-item" };
  if (owner !== path(owner) || !plainDirectory(owner))
    return { kind: "conflict", code: "legacy-source-unavailable" };
  try {
    if (!parents(owner, false))
      return { kind: "conflict", code: "legacy-source-unavailable" };
  } catch (_) {
    return { kind: "conflict", code: "unsafe-path" };
  }
  if (
    owner.normalize("NFC") !== ctx.targets[0].normalize("NFC") &&
    exists(ctx.targets[0])
  )
    return { kind: "conflict", code: "foreign-item" };
  var problem = proof(ctx, owner);
  if (problem) return { kind: "conflict", code: problem };
  if (owner.normalize("NFC") !== ctx.targets[0].normalize("NFC"))
    return { kind: "legacy", apps: appPresence(ctx.home) };
  try {
    payload(owner, true);
    var receipt = textFile(owner + "/.finder-pdf-receipt.json");
    if (
      receipt.length > 100000 ||
      JSON.stringify(JSON.parse(receipt)) !== receipt ||
      !same(JSON.parse(receipt), payloadContent(owner, true, true))
    )
      throw new Error("receipt");
    var receiptHash = snapshot(owner).filter(function (v) {
      return v[0] === ".finder-pdf-receipt.json";
    })[0][4];
    var expectedMarker = receiptHash + "  .finder-pdf-receipt.json\n";
    for (var host = 0; host < 2; host++) {
      var app =
        ctx.targets[1] +
        "/Contents/Resources/" +
        ["Finder PDF Review.app", "Finder PDF Print.app"][host];
      if (
        textFile(app + "/Contents/Resources/finder-pdf-payload.sha256") !==
        expectedMarker
      )
        throw new Error("receipt");
    }
  } catch (e) {
    return { kind: "conflict", code: "modified-item" };
  }
  var a = payloadContent(ctx.input),
    b = payloadContent(owner, true);
  return {
    kind: same(a, b) ? "current" : "update",
    apps: appPresence(ctx.home),
  };
}
/* Compare payload bytes without binding the download's inode or path. */
/** Compare allowed payload content independently of source location. */
function payloadContent(p, managed, includeMetadata) {
  var s = snapshot(p);
  return s
    .filter(function (v) {
      return !managed || v[0] !== ".finder-pdf-receipt.json";
    })
    .map(function (v) {
      var item = [v[0].normalize("NFC"), v[1], v[4]];
      if (includeMetadata) item.push(v[5], v[6], v[7], v[0] ? v[8] : null);
      return item;
    });
}
/** Persist the complete bounded transaction state before a rename. */
function journal(ctx, j) {
  var txnAttrs = attrs(ctx.txn),
    file = ctx.txn + "/journal.json";
  if (
    type(txnAttrs) !== "NSFileTypeDirectory" ||
    !same(
      [
        identity(txnAttrs, $.NSFileSystemNumber),
        identity(txnAttrs, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  )
    throw new Error("journal");
  if (ctx.journalIdentity) {
    var current = attrs(file);
    if (
      type(current) !== "NSFileTypeRegular" ||
      !same(
        [
          identity(current, $.NSFileSystemNumber),
          identity(current, $.NSFileSystemFileNumber),
        ],
        ctx.journalIdentity,
      ) ||
      textFile(file) !== ctx.journalText
    )
      throw new Error("journal");
  } else if (exists(file)) throw new Error("journal");
  var contents = JSON.stringify(j);
  writeFile(file, contents);
  sync();
  var written = attrs(file);
  if (type(written) !== "NSFileTypeRegular" || textFile(file) !== contents)
    throw new Error("journal");
  ctx.journalIdentity = [
    identity(written, $.NSFileSystemNumber),
    identity(written, $.NSFileSystemFileNumber),
  ];
  ctx.journalText = contents;
}
/** Recognize bounded snapshots without interpreting their paths as authority. */
function validSnapshot(s) {
  if (!Array.isArray(s) || !s.length || s.length > maxFiles) return false;
  var seen = Object.create(null);
  return s.every(function (v, index) {
    if (
      !Array.isArray(v) ||
      v.length !== 9 ||
      typeof v[0] !== "string" ||
      v[0].length > 4096 ||
      v[0].indexOf("\0") !== -1 ||
      seen[v[0]]
    )
      return false;
    if (index === 0 && (v[0] !== "" || v[1] !== "NSFileTypeDirectory"))
      return false;
    if (
      index !== 0 &&
      (!v[0] ||
        v[0].charAt(0) === "/" ||
        v[0].split("/").some(function (part) {
          return !part || part === "." || part === "..";
        }))
    )
      return false;
    seen[v[0]] = true;
    if (
      !/^\d+$/.test(v[2]) ||
      typeof v[2] !== "string" ||
      !/^\d+$/.test(v[3]) ||
      typeof v[3] !== "string"
    )
      return false;
    if (
      ![v[5], v[6], v[7]].every(function (n) {
        return Number.isSafeInteger(n) && n >= 0;
      }) ||
      typeof v[8] !== "number" ||
      !Number.isFinite(v[8])
    )
      return false;
    if (v[1] === "NSFileTypeDirectory") return v[4] === null;
    if (v[1] === "NSFileTypeRegular")
      return typeof v[4] === "string" && /^[a-f0-9]{64}$/.test(v[4]);
    return (
      v[1] === "NSFileTypeSymbolicLink" &&
      typeof v[4] === "string" &&
      v[4].length <= 4096 &&
      v[4].indexOf("\0") === -1
    );
  });
}
/** Reject journal structures outside the fixed four-target format. */
function validJournal(j) {
  return (
    j &&
    Object.keys(j).sort().join(",") === "new,old,step,txn,version" &&
    j.version === 1 &&
    Array.isArray(j.old) &&
    j.old.length === 4 &&
    Array.isArray(j.new) &&
    j.new.length === 4 &&
    typeof j.step === "string" &&
    /^(preparing|ready|committed|(before-backup|backup|before-install|install|retire|restore)-[0-3])$/.test(
      j.step,
    ) &&
    j.old.every(function (x) {
      return x === null || validSnapshot(x);
    }) &&
    Array.isArray(j.txn) &&
    j.txn.length === 2 &&
    j.txn.every(function (v) {
      return typeof v === "string" && /^\d+$/.test(v);
    }) &&
    (j.step === "preparing"
      ? j.new.every(function (v) {
          return v === null;
        })
      : j.new.every(validSnapshot))
  );
}
/** Inject only requested failure or crash conditions in isolated tests. */
function testStep(s) {
  if (envValue("FINDER_PDF_TEST_CRASH_STEP") === s) $.exit(86);
  if (envValue("FINDER_PDF_TEST_FAIL_STEP") === s) throw new Error("injected");
}
/** Refuse a missing, unsafe or externally changed snapshot. */
function changed(p, expected) {
  try {
    return !same(snapshot(p), expected);
  } catch (e) {
    return true;
  }
}
/** Verify every live postimage and all remaining preimages before disposal. */
function validFinalization(ctx, j, requireAll) {
  for (var i = 0; i < 4; i++) {
    if (changed(ctx.targets[i], j.new[i])) return false;
    var backup = ctx.txn + "/backup-" + i;
    if (exists(backup)) {
      if (j.old[i] === null || changed(backup, j.old[i])) return false;
    } else if (requireAll && j.old[i] !== null) return false;
  }
  return true;
}
/** Register a verified commit, or report that Finder registration is unconfirmed. */
function register() {
  if (envValue("FINDER_PDF_TEST_NO_REGISTER") === "1")
    return (
      ["flush", "update"].indexOf(
        envValue("FINDER_PDF_TEST_REGISTRATION_FAIL"),
      ) < 0
    );
  try {
    return (
      lockedCommand("/System/Library/CoreServices/pbs", ["-flush"]).code === 0 &&
      lockedCommand("/System/Library/CoreServices/pbs", ["-update"]).code === 0
    );
  } catch (_) {
    return false;
  }
}
/* Recovery only moves known target names after checking full recorded snapshots. */
/** Restore recorded preimages or finalize a verified committed installation. */
function recover(ctx, j) {
  var root = attrs(ctx.txn);
  if (
    type(root) !== "NSFileTypeDirectory" ||
    !same(
      [
        identity(root, $.NSFileSystemNumber),
        identity(root, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  )
    return false;
  if (j.step === "committed") {
    if (!validFinalization(ctx, j, false)) return false;
    for (var c = 0; c < 4; c++) {
      var completedBackup = ctx.txn + "/backup-" + c;
      if (exists(completedBackup)) {
        if (!validFinalization(ctx, j, false)) return false;
        remove(completedBackup);
        sync();
      }
    }
    return true;
  }
  for (var i = 3; i >= 0; i--) {
    var live = ctx.targets[i],
      backup = ctx.txn + "/backup-" + i,
      retired = ctx.txn + "/retired-" + i,
      old = j.old[i],
      fresh = j.new[i],
      current;
    try {
      current = snapshot(live);
    } catch (e) {
      return false;
    }
    var back;
    try {
      back = snapshot(backup);
    } catch (e) {
      return false;
    }
    if (exists(retired) && changed(retired, fresh)) return false;
    if (back !== null && (old === null || !same(back, old))) return false;
    if (same(current, old) && back === null) continue;
    if (current !== null) {
      if (
        exists(retired) ||
        !same(current, fresh) ||
        (old !== null && back === null)
      )
        return false;
      journal(ctx, Object.assign({}, j, { step: "retire-" + i }));
      if (changed(live, fresh)) return false;
      move(live, retired);
      sync();
      testStep("retire-" + i);
      if (changed(retired, fresh)) return false;
    }
    if (old !== null) {
      if (back === null || exists(live)) return false;
      journal(ctx, Object.assign({}, j, { step: "restore-" + i }));
      if (changed(backup, old)) return false;
      move(backup, live);
      sync();
      testStep("restore-" + i);
      if (changed(live, old)) return false;
    }
  }
  return true;
}
/** Delete transaction data only when each remaining object is accounted for. */
function deleteTxn(ctx, j) {
  /* Validate all transaction members before recursive deletion. */
  try {
    var recorded = loadJournal(ctx);
    if (
      !same(recorded.old, j.old) ||
      !same(recorded.new, j.new) ||
      !same(recorded.txn, j.txn)
    )
      return false;
  } catch (_) {
    return false;
  }
  var allowed = { "journal.json": 1, "new-source": 1, "new-workflows": 1 };
  for (var i = 0; i < 4; i++) {
    allowed["backup-" + i] = 1;
    allowed["retired-" + i] = 1;
  }
  if (
    listing(ctx.txn).some(function (n) {
      return !allowed[n];
    })
  )
    return false;
  if (
    exists(ctx.txn + "/new-source") &&
    changed(ctx.txn + "/new-source", j.new[0])
  )
    return false;
  var workflows = ctx.txn + "/new-workflows";
  if (exists(workflows)) {
    if (!plainDirectory(workflows)) return false;
    var members = listing(workflows);
    for (var m = 0; m < members.length; m++) {
      var idx = names
        .map(function (n) {
          return n.normalize("NFC");
        })
        .indexOf(members[m].normalize("NFC"));
      if (idx < 0 || changed(workflows + "/" + members[m], j.new[idx + 1]))
        return false;
    }
  }
  for (var k = 0; k < 4; k++) {
    if (exists(ctx.txn + "/backup-" + k)) return false;
    if (
      exists(ctx.txn + "/retired-" + k) &&
      changed(ctx.txn + "/retired-" + k, j.new[k])
    )
      return false;
  }
  var root = attrs(ctx.txn);
  if (
    type(root) !== "NSFileTypeDirectory" ||
    !same(
      [
        identity(root, $.NSFileSystemNumber),
        identity(root, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  )
    return false;
  var finalSnapshot = snapshot(ctx.txn);
  if (changed(ctx.txn, finalSnapshot)) return false;
  remove(ctx.txn);
  sync();
  return true;
}
/** Read and validate a bounded regular recovery journal. */
function loadJournal(ctx) {
  var p = ctx.txn + "/journal.json",
    a = attrs(p);
  if (
    type(a) !== "NSFileTypeRegular" ||
    number(a, $.NSFileReferenceCount) !== 1 ||
    number(a, $.NSFileSize) > 1024 * 1024
  )
    throw new Error("journal");
  var contents = textFile(p);
  var after = attrs(p);
  if (
    type(after) !== "NSFileTypeRegular" ||
    !same(
      [
        identity(a, $.NSFileSystemNumber),
        identity(a, $.NSFileSystemFileNumber),
      ],
      [
        identity(after, $.NSFileSystemNumber),
        identity(after, $.NSFileSystemFileNumber),
      ],
    )
  )
    throw new Error("journal");
  if (
    ctx.journalIdentity &&
    (!same(ctx.journalIdentity, [
      identity(after, $.NSFileSystemNumber),
      identity(after, $.NSFileSystemFileNumber),
    ]) ||
      contents !== ctx.journalText)
  )
    throw new Error("journal");
  var j = JSON.parse(contents);
  if (JSON.stringify(j) !== contents) throw new Error("journal");
  if (!validJournal(j)) throw new Error("journal");
  ctx.journalIdentity = [
    identity(after, $.NSFileSystemNumber),
    identity(after, $.NSFileSystemFileNumber),
  ];
  ctx.journalText = contents;
  return j;
}
/** Bind the installation capability to the current home and fixed targets. */
function makeCtx(source, home, engineDir) {
  var support = home + "/Library/Application Support/Finder PDF Converter",
    services = home + "/Library/Services";
  return {
    home: home,
    input: source,
    engineDir: engineDir,
    support: support,
    services: services,
    txn: support + "/transaction",
    targets: [support + "/source"].concat(
      names.map(function (n) {
        return services + "/" + n;
      }),
    ),
  };
}
/** Preserve an interrupted preparation under an identity-derived fixed name. */
function retainPreparing(ctx, j) {
  if (j.step !== "preparing" || !same(loadJournal(ctx), j)) return false;
  var a = attrs(ctx.txn);
  if (
    type(a) !== "NSFileTypeDirectory" ||
    !same(
      [
        identity(a, $.NSFileSystemNumber),
        identity(a, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  )
    return false;
  for (var i = 0; i < 4; i++)
    if (changed(ctx.targets[i], j.old[i])) return false;
  if (
    listing(ctx.support).filter(function (name) {
      return name.indexOf("retained-preparation-") === 0;
    }).length >= 4
  )
    return false;
  var retained =
    ctx.support + "/retained-preparation-" + j.txn[0] + "-" + j.txn[1];
  if (exists(retained)) return false;
  if (!same(loadJournal(ctx), j)) return false;
  a = attrs(ctx.txn);
  if (
    type(a) !== "NSFileTypeDirectory" ||
    !same(
      [
        identity(a, $.NSFileSystemNumber),
        identity(a, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  )
    return false;
  move(ctx.txn, retained);
  sync();
  a = attrs(retained);
  return (
    type(a) === "NSFileTypeDirectory" &&
    same(
      [
        identity(a, $.NSFileSystemNumber),
        identity(a, $.NSFileSystemFileNumber),
      ],
      j.txn,
    )
  );
}
/** Stage every postimage, journal each move, verify, and register. */
function install(ctx) {
  var state = inspect(ctx);
  if (state.kind === "conflict" || state.kind === "recovery-required")
    return state;
  var initial = ctx.targets.map(snapshot);
  var inputSnap = snapshot(ctx.input);
  parents(ctx.support, true);
  mkdir(ctx.txn);
  var journalMade = false,
    j;
  try {
    var transactionAttrs = attrs(ctx.txn);
    j = {
      version: 1,
      old: initial,
      new: [null, null, null, null],
      step: "preparing",
      txn: [
        identity(transactionAttrs, $.NSFileSystemNumber),
        identity(transactionAttrs, $.NSFileSystemFileNumber),
      ],
    };
    journal(ctx, j);
    journalMade = true;
    testStep("preparing");
    if (
      !fm.copyItemAtPathToPathError(
        $(ctx.input),
        $(ctx.txn + "/new-source"),
        null,
      )
    )
      throw new Error("copy");
    payload(ctx.txn + "/new-source");
    if (changed(ctx.input, inputSnap)) throw new Error("changed");
    writeFile(
      ctx.txn + "/new-source/.finder-pdf-receipt.json",
      JSON.stringify(payloadContent(ctx.txn + "/new-source", false, true)),
    );
    var staged = lockedCommand("/bin/bash", [ctx.engineDir + "/stage-managed.sh"]);
    if (staged.code !== 0) throw new Error("stage");
    testStep("stage-complete");
    parents(ctx.services, true);
    var paths = [ctx.txn + "/new-source"].concat(
      names.map(function (n) {
        return ctx.txn + "/new-workflows/" + n;
      }),
    );
    j.new = paths.map(snapshot);
    j.step = "ready";
    journal(ctx, j);
    for (var i = 0; i < 4; i++)
      if (changed(ctx.targets[i], initial[i])) throw new Error("changed");
    if (changed(ctx.input, inputSnap)) throw new Error("changed");
    for (var k = 0; k < 4; k++) {
      if (initial[k] !== null) {
        j.step = "before-backup-" + k;
        journal(ctx, j);
        testStep(j.step);
        if (changed(ctx.targets[k], initial[k])) throw new Error("changed");
        move(ctx.targets[k], ctx.txn + "/backup-" + k);
        sync();
        if (changed(ctx.txn + "/backup-" + k, initial[k]))
          throw new Error("changed");
        j.step = "backup-" + k;
        journal(ctx, j);
        testStep(j.step);
      }
      j.step = "before-install-" + k;
      journal(ctx, j);
      testStep(j.step);
      if (exists(ctx.targets[k]) || changed(paths[k], j.new[k]))
        throw new Error("changed");
      move(paths[k], ctx.targets[k]);
      sync();
      if (changed(ctx.targets[k], j.new[k])) throw new Error("changed");
      j.step = "install-" + k;
      journal(ctx, j);
      testStep(j.step);
    }
    var problem = proof(ctx, ctx.targets[0]);
    if (problem !== null) throw new Error("verify " + problem);
    if (
      ctx.targets.some(function (p, i) {
        return changed(p, j.new[i]);
      })
    )
      throw new Error("verify changed");
    /* Durable commit separates verified success from recoverable finalization. */
    j.step = "committed";
    journal(ctx, j);
    testStep("committed");
    if (!validFinalization(ctx, j, true)) throw new Error("changed");
    for (var b = 0; b < 4; b++) {
      var bp = ctx.txn + "/backup-" + b;
      if (exists(bp)) {
        if (!validFinalization(ctx, j, false)) throw new Error("changed");
        remove(bp);
        sync();
        testStep("cleanup-" + b);
      }
    }
    if (!deleteTxn(ctx, j))
      return { kind: "recovery-required", code: "recovery-conflict" };
    if (!register()) return { kind: "registration-required" };
    return { kind: "installed" };
  } catch (e) {
    if (!journalMade)
      return { kind: "recovery-required", code: "recovery-conflict" };
    try {
      j = loadJournal(ctx);
      if (j.step === "preparing")
        return retainPreparing(ctx, j)
          ? { kind: "failed", code: "write-failed" }
          : { kind: "recovery-required", code: "recovery-conflict" };
      if (recover(ctx, j) && deleteTxn(ctx, j)) {
        if (j.step === "committed") {
          if (!register()) return { kind: "registration-required" };
          return { kind: "installed" };
        }
        return { kind: "restored", code: "write-failed" };
      }
    } catch (_) {}
    return { kind: "recovery-required", code: "recovery-conflict" };
  }
}
/** Parse the public operation and emit one bounded result envelope. */
function run(argv) {
  var engineDir = argv.shift();
  var home = argv.shift();
  var op = argv.length ? argv[0] : "inspect",
    result,
    exitCode = 1;
  try {
    if (
      argv.length !== 3 ||
      ["inspect", "install", "recover"].indexOf(op) < 0 ||
      argv[1] !== "--source-root" ||
      !argv[2] ||
      argv[2].charAt(0) !== "/"
    ) {
      result = { kind: "invalid-request", code: "invalid-payload" };
      exitCode = 2;
    } else {
      if (!home || home.charAt(0) !== "/") throw new Error("home");
      home = path(home);
      var input = path(argv[2]);
      if (!plainDirectory(input) || !parents(input, false))
        throw new Error("payload");
      payload(input);
      var ctx = makeCtx(input, home, engineDir);
      parents(home, false);
      parents(ctx.support, false);
      parents(ctx.services, false);
      if (op === "inspect") result = inspect(ctx);
      else if (op === "install") result = install(ctx);
      else if (!exists(ctx.txn)) result = { kind: "recovered" };
      else {
        try {
          if (!plainDirectory(ctx.txn)) throw new Error("unsafe");
          var j = loadJournal(ctx);
          if (j.step === "preparing") {
            result = retainPreparing(ctx, j)
              ? { kind: "recovered" }
              : { kind: "recovery-required", code: "recovery-conflict" };
          } else if (recover(ctx, j) && deleteTxn(ctx, j)) {
            if (j.step === "committed" && !register())
              result = { kind: "registration-required" };
            else result = { kind: "recovered" };
          } else
            result = { kind: "recovery-required", code: "recovery-conflict" };
        } catch (_) {
          result = { kind: "recovery-required", code: "recovery-conflict" };
        }
      }
      exitCode =
        [
          "fresh",
          "current",
          "update",
          "legacy",
          "installed",
          "recovered",
        ].indexOf(result.kind) >= 0
          ? 0
          : 1;
    }
  } catch (e) {
    if (e.message === "payload") {
      result = { kind: "invalid-request", code: "invalid-payload" };
      exitCode = 2;
    } else {
      result = { kind: "failed", code: "operation-failed" };
      exitCode = 1;
    }
  }
  var out =
    JSON.stringify({ schemaVersion: 1, operation: op, outcome: result }) + "\n";
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(
    $(out).dataUsingEncoding(enc),
  );
  $.exit(exitCode);
}
