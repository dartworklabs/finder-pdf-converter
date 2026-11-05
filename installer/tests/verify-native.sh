#!/bin/bash
# Exercise JXA protocol registration and safety guards without opening any UI.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/fpdf-native-check.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
cat "$root/model.js" > "$stage/check.js"
# Do not let osascript invoke the GUI entry point after loading declarations.
sed 's/^function run(/function nativeTestEntry(/' "$root/ui.js" >> "$stage/check.js"
printf '\ninstallerUI.strings = ' >> "$stage/check.js"
cat "$root/resources/en.lproj/Installer.json" >> "$stage/check.js"
printf ';\n' >> "$stage/check.js"
cat >> "$stage/check.js" <<'JXA'
const controller = $.FPDFInstallerController.alloc.init;
installerUI.running = true;
if (Number(controller.applicationShouldTerminate(null)) !== 0) throw Error('Quit must wait while a backend runs');
if (controller.windowShouldClose(null) !== false) throw Error('Window close must wait while a backend runs');
installerUI.running = false;
if (Number(controller.applicationShouldTerminate(null)) !== 1) throw Error('Quit must be allowed after a complete result');
/** Create only a test-owned read-only process; no product backend or files are touched. */
function ownedSleepTask(seconds) {
    const task = $.NSTask.alloc.init;
    task.launchPath = '/bin/sleep'; task.arguments = $([String(seconds || 5)]);
    task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
    task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
    task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
    task.launch;
    return task;
}
for (const operation of ['install','recover','inspect']) {
    const task = ownedSleepTask();
    try {
        installerUI.task = task; installerUI.running = true; installerUI.invoked = operation;
        if (operation === 'inspect') {
            if (Number(controller.applicationShouldTerminate(null)) !== 1 || installerUI.running) throw Error('Read-only inspection must allow Quit');
            task.waitUntilExit;
            if (task.running) throw Error('Owned inspection process was not terminated');
        } else {
            if (Number(controller.applicationShouldTerminate(null)) !== 0) throw Error('Mutation Quit guard was weakened');
            if (controller.windowShouldClose(null) !== false) throw Error('Mutation close guard was weakened');
            if (installerStopInspection() !== false || !task.running) throw Error('Mutation task was terminated');
        }
    } finally {
        if (task.running) task.terminate;
        task.waitUntilExit;
        installerUI.task = null; installerUI.running = false;
    }
}
$.NSApplication.sharedApplication;
installerUI.body=$.NSTextField.labelWithString('');
for (const failingSnapshot of [0,1,2]) {
const realSnapshot=installerProcessSnapshot;
let snapshotCalls=0;
// Exercise separate nested Foundation task groups plus a racing shell child,
// while an unrelated owned sentinel must remain alive throughout cancellation.
const nestedDir = ObjC.unwrap($.NSTemporaryDirectory())+'fpdf-nested-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(nestedDir,false,$({NSFilePosixPermissions:448}),null);
const nestedScript=nestedDir+'/child.js', nestedMeta=nestedDir+'/child.json';
const nestedCode = "ObjC.import('Foundation');const t=$.NSTask.alloc.init;t.launchPath='/bin/bash';t.arguments=$(['-c','for n in 1 2 3 4 5 6 7 8 9 10; do /bin/sleep 60 & /bin/sleep 0.01; done; wait']);t.standardOutput=$.NSFileHandle.fileHandleWithNullDevice;t.standardError=$.NSFileHandle.fileHandleWithNullDevice;t.launch;$(JSON.stringify({child:Number(t.processIdentifier)})).writeToFileAtomicallyEncodingError("+JSON.stringify(nestedMeta)+",true,$.NSUTF8StringEncoding,null);t.waitUntilExit;";
$(nestedCode).writeToFileAtomicallyEncodingError(nestedScript,true,$.NSUTF8StringEncoding,null);
const nestedTask=$.NSTask.alloc.init;
nestedTask.launchPath='/usr/bin/osascript';nestedTask.arguments=$(['-l','JavaScript',nestedScript]);
nestedTask.standardOutput=$.NSFileHandle.fileHandleWithNullDevice;nestedTask.standardError=$.NSFileHandle.fileHandleWithNullDevice;
const unrelatedTask=ownedSleepTask(30);
let nestedPID=0;
try {
    nestedTask.launch;
    const deadline=Date.now()+3000;
    while(Date.now()<deadline) {
        const text=$.NSString.stringWithContentsOfFileEncodingError(nestedMeta,$.NSUTF8StringEncoding,null);
        if(text&&!text.isNil()){nestedPID=JSON.parse(ObjC.unwrap(text)).child;break;}
        $.NSThread.sleepForTimeInterval(0.01);
    }
    if(!nestedPID)throw Error('Nested task fixture did not start');
    installerUI.task=nestedTask;installerUI.invoked='inspect';installerUI.running=true;
    if(failingSnapshot>0) {
        installerProcessSnapshot=function(pid,budget){snapshotCalls++;return snapshotCalls===failingSnapshot?{kind:'unavailable'}:realSnapshot(pid,budget);};
        if(installerPrepareClose()||!installerUI.running||installerUI.task!==nestedTask||!nestedTask.running)throw Error('Failed snapshot discarded or killed the owned task');
        if(ObjC.unwrap(installerUI.body.stringValue)!==installerUI.strings.inspectCleanupBody)throw Error('Unconfirmed cleanup was not explained');
        installerProcessSnapshot=realSnapshot;
        const resumedDeadline=Date.now()+1000;
        let resumed=realSnapshot(Number(nestedTask.processIdentifier),2);
        while(resumed.kind==='owned'&&resumed.processes.some(row=>row.state.charAt(0)==='T')&&Date.now()<resumedDeadline){$.NSThread.sleepForTimeInterval(0.01);resumed=realSnapshot(Number(nestedTask.processIdentifier),2);}
        if(resumed.kind!=='owned'||resumed.processes.some(row=>row.state.charAt(0)==='T'))throw Error('Failed snapshot left an owned process stopped');
        if(!unrelatedTask.running)throw Error('Failed snapshot terminated unrelated sentinel');
    }
    if(!installerPrepareClose()||!installerUI.inspectionCleanupVerified)throw Error('Nested ownership cleanup retry was not verified');
    nestedTask.waitUntilExit;
    const reapDeadline=Date.now()+1500;
    while($.kill(-nestedPID,0)===0&&Date.now()<reapDeadline)$.NSThread.sleepForTimeInterval(0.01);
    if($.kill(-nestedPID,0)===0)throw Error('Nested inspection group survived cancellation');
    if(!unrelatedTask.running)throw Error('Unrelated sentinel was terminated');
    console.log(JSON.stringify({snapshotFailureAt:failingSnapshot,taskRetainedOnFailure:failingSnapshot>0,noStoppedLeaks:true,retryCleanedTree:true,unrelatedPreserved:true}));
} finally {
    installerProcessSnapshot=realSnapshot;
    if(nestedTask.running){nestedTask.terminate;nestedTask.waitUntilExit;}
    if(nestedPID>1&&Number($.getpgid(nestedPID))===nestedPID)$.kill(-nestedPID,9);
    if(unrelatedTask.running)unrelatedTask.terminate;
    unrelatedTask.waitUntilExit;
    $.NSFileManager.defaultManager.removeItemAtPathError(nestedDir,null);
    installerUI.task=null;installerUI.running=false;
}
}
// Exercise the timeout path with real AppKit controls and an owned sleeping task,
// without creating or showing a window and without waiting for the deadline.
$.NSApplication.sharedApplication;
installerUI.title = $.NSTextField.labelWithString('');
installerUI.body = $.NSTextField.labelWithString('');
installerUI.steps = $.NSTextField.labelWithString('');
installerUI.primary = $.NSButton.alloc.init;
installerUI.close = $.NSButton.alloc.init;
installerUI.details = $.NSButton.alloc.init;
installerUI.spinner = $.NSProgressIndicator.alloc.init;
// Test the real native menu adapter against a real AppKit menu tree.
const nativeMenu = $.NSMenu.alloc.initWithTitle('');
const nativeAppMenu = $.NSMenu.alloc.initWithTitle('Application');
const nativeAppItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('', null, '');
nativeAppItem.submenu = nativeAppMenu; nativeMenu.addItem(nativeAppItem);
const unrelatedQ = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Other shortcut', 'terminate:', 'q');
unrelatedQ.target = $.NSApp;
unrelatedQ.keyEquivalentModifierMask = Number($.NSEventModifierFlagCommand) | Number($.NSEventModifierFlagShift);
nativeAppMenu.addItem(unrelatedQ);
const nativeQuitItem = $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent('Quit', 'terminate:', 'q');
nativeQuitItem.target = $.NSApp; nativeAppMenu.addItem(nativeQuitItem);
installerUI.controller = controller;
if (!installerWireQuit(nativeMenu)) throw Error('Native Quit menu item was not found');
if (unrelatedQ.target.isEqual(controller)) throw Error('Another modifier shortcut was rebound');
if (!nativeQuitItem.target.isEqual(controller)) throw Error('Quit still targets the applet');
if (ObjC.unwrap($.NSStringFromSelector(nativeQuitItem.action)) !== 'closeInstaller:') throw Error('Quit bypasses the close guard');
if (Number(nativeQuitItem.keyEquivalentModifierMask) !== Number($.NSEventModifierFlagCommand)) throw Error('Command-Q shortcut was lost');
const timedTask = ownedSleepTask();
try {
    installerUI.task = timedTask; installerUI.running = true; installerUI.invoked = 'inspect';
    installerUI.startedAt = Number($.NSProcessInfo.processInfo.systemUptime) * 1000 - 46000;
    installerTick();
    if (installerUI.running || installerUI.outcome.kind !== 'failed' || installerUI.outcome.code !== 'operation-failed') throw Error('Inspection deadline did not show a bounded failure');
    if (ObjC.unwrap(installerUI.body.stringValue) !== installerUI.strings.inspectUnavailableBody) throw Error('Inspection timeout guidance was omitted');
} finally {
    if (timedTask.running) timedTask.terminate;
    timedTask.waitUntilExit;
    installerUI.task = null; installerUI.running = false;
}
// Real stdout-file cases cover accepted, malformed, oversized and invalid UTF-8.
const validResponse=JSON.stringify({schemaVersion:1,operation:'inspect',outcome:{kind:'fresh',apps:{hwp:false,word:false,powerpoint:false,excel:false}}});
for(const response of [
    {text:validResponse,expected:'fresh'},
    {text:'{truncated',expected:'protocol-error'},
    {text:validResponse+' '.repeat(20000),expected:'protocol-error'},
    {text:'\\377',binary:true,expected:'protocol-error'}
]) {
    const responseDir=ObjC.unwrap($.NSTemporaryDirectory())+'fpdf-native-response-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(responseDir,false,$({NSFilePosixPermissions:448}),null);
    const responsePath=responseDir+'/response.json';
    $.NSFileManager.defaultManager.createFileAtPathContentsAttributes(responsePath,$.NSData.data,$({NSFilePosixPermissions:384}));
    const responseHandle=$.NSFileHandle.fileHandleForWritingAtPath(responsePath);
    const responseTask=$.NSTask.alloc.init;
    responseTask.launchPath='/usr/bin/printf';responseTask.arguments=$([response.binary?'%b':'%s',response.text]);
    responseTask.standardOutput=responseHandle;responseTask.standardError=$.NSFileHandle.fileHandleWithNullDevice;
    try {
        responseTask.launch;responseTask.waitUntilExit;
        installerUI.outputDirectory=responseDir;installerUI.outputPath=responsePath;installerUI.outputHandle=responseHandle;
        installerUI.task=responseTask;installerUI.running=true;installerUI.invoked='inspect';
        installerUI.timer=$.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(60,controller,'tick:',null,false);
        installerTick();
        if(installerUI.outcome.kind!==response.expected)throw Error('Native bounded stdout response was mishandled');
    } finally {
        if(responseTask.running){responseTask.terminate;responseTask.waitUntilExit;}
        installerCleanTask();$.NSFileManager.defaultManager.removeItemAtPathError(responseDir,null);installerUI.running=false;
    }
}
// An actual owned launch marker cannot be created when timer setup fails.
const actualFactory=installerBackendTask,actualTimer=installerScheduleTimer;
const markerDir=ObjC.unwrap($.NSTemporaryDirectory())+'fpdf-launch-order-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(markerDir,false,$({NSFilePosixPermissions:448}),null);
const marker=markerDir+'/backend-started';
const markerTask=$.NSTask.alloc.init;markerTask.launchPath='/usr/bin/touch';markerTask.arguments=$([marker]);
let timerFailureReached=false;
try {
    installerUI.preview=false;installerUI.running=false;installerUI.finished=false;installerUI.task=null;installerUI.timer=null;
    const scheduled=actualTimer();if(!scheduled.isValid)throw Error('Native timer could not be scheduled');scheduled.invalidate;
    installerBackendTask=function(operation,handle){markerTask.standardOutput=handle;markerTask.standardError=$.NSFileHandle.fileHandleWithNullDevice;return markerTask;};
    installerScheduleTimer=function(){timerFailureReached=true;throw Error('Injected timer setup failure');};
    installerStart('install');
    if(markerTask.running)markerTask.waitUntilExit;
    if(!timerFailureReached||$.NSFileManager.defaultManager.fileExistsAtPath(marker))throw Error('Timer setup failure started the backend');
    if(installerUI.running||installerUI.task!==null||installerUI.timer!==null)throw Error('Prelaunch failure retained invalid lifecycle state');
} finally {
    installerBackendTask=actualFactory;installerScheduleTimer=actualTimer;
    if(markerTask.running){markerTask.terminate;markerTask.waitUntilExit;}
    installerCleanTask();$.NSFileManager.defaultManager.removeItemAtPathError(markerDir,null);installerUI.running=false;
}
installerUI.preview = true;
installerStart('install');
if (installerUI.task !== null || installerUI.running) throw Error('Preview invoked the backend');
for (const arguments_ of [['--source-root','/'],['--locale','en'],['--preview','arbitrary'],['--preview','fresh','--preview','update']]) {
    let rejected = false;
    try { installerLaunchOptions(arguments_); } catch (_error) { rejected = true; }
    if (!rejected) throw Error('Unsafe launch arguments were accepted');
}
for (const language of ['en', 'ko']) {
    const parsed = installerLaunchOptions(['-AppleLanguages', '(' + language + ')']);
    if (parsed.nativeLanguage !== language || parsed.preview !== null) throw Error('Process-only language pair was not decoded');
    const preview = installerLaunchOptions(['-AppleLanguages', '(' + language + ')', '--preview', 'fresh']);
    if (preview.nativeLanguage !== language || preview.preview !== 'fresh') throw Error('Native language pair was not stripped');
}
for (const arguments_ of [
    ['-AppleLanguages'], ['-AppleLanguages','en'], ['-AppleLanguages','(fr)'],
    ['-AppleLanguages','(en,ko)'], ['-AppleLanguages','("en")'],
    ['-AppleLanguages','(en)','-AppleLanguages','(ko)'],
    ['--preview','fresh','-AppleLanguages','(ko)'], ['-AppleLocale','en_US']
]) {
    let rejected = false;
    try { installerLaunchOptions(arguments_); } catch (_error) { rejected = true; }
    if (!rejected) throw Error('Invalid native process arguments were accepted');
}
JXA
/usr/bin/osascript -l JavaScript "$stage/check.js"
printf '%s\n' 'installer native: protocol encodings, real owned-task inspection timeout/cancel and mutation Quit/window guards, inert preview, bounded stdout, timer-before-launch, process-only language and launch argument refusal passed'
