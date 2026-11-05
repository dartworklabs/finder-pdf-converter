#!/bin/bash
# Execute a uniquely owned compiled app with real background arguments and no service access.
set -eu
case "${1:-}" in ''|--mutate-foreground|--reopen-only) ;; *) exit 2 ;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/fpdf-background-check.XXXXXX")
pid=''
cleanup() {
  local cleanup_status=$?
  trap - EXIT
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || :; wait "$pid" 2>/dev/null || :; fi
  if [ -f "$stage/cleanup.js" ]; then
    if ! /usr/bin/osascript -l JavaScript "$stage/cleanup.js" > "$stage/cleanup.log" 2>&1; then
      cat "$stage/cleanup.log"; cleanup_status=1
    fi
  fi
  rm -rf -- "$stage"
  exit "$cleanup_status"
}
trap cleanup EXIT
node - "$root" "$stage" "${1:-}" <<'JS'
/** Prepare one private native app and unique real preference domain for both cases. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const [root,stage,mutation]=process.argv.slice(2);
const domain='com.wonjun-lab.finder-pdf-converter.background-test.'+crypto.randomUUID();
const base=fs.readFileSync(path.join(root,'model.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'ui.js'),'utf8');
const wrapper=`
ObjC.bindFunction('exit',['void',['int']]);
${mutation==='--mutate-foreground'?"const correctLaunchOptions=installerLaunchOptions;installerLaunchOptions=function(args){const value=correctLaunchOptions(args);value.background=false;return value;};":''}
const fixtureDomain=${JSON.stringify(domain)};
const fixtureStage=${JSON.stringify(stage)};
const fixtureReopen=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_TEST_REOPEN'))==='true';
let fixtureTimer=null,fixtureObserver=null,fixturePhase=0,fixtureDeadline=0;
/** Write only this fixture's external native-state receipt. */
function fixtureWrite(name,value){$(JSON.stringify(value)).writeToFileAtomicallyEncodingError(fixtureStage+'/'+name,true,$.NSUTF8StringEncoding,null);}
/** Count actual executions of the harmless owned inspection task. */
function fixtureInspections(){const text=$.NSString.stringWithContentsOfFileEncodingError(fixtureStage+'/inspect-launches',$.NSUTF8StringEncoding,null);return text&&!text.isNil()?(ObjC.unwrap(text).match(/inspect/g)||[]).length:0;}
/** Remove owned native objects and scoped preferences before ending this fixture. */
function fixtureStop(code){
    if(fixtureTimer)fixtureTimer.invalidate;
    if(installerUI.task&&installerUI.task.running){installerUI.task.terminate;installerUI.task.waitUntilExit;}
    if(installerUI.timer)installerUI.timer.invalidate;
    installerUI.running=false;installerCleanTask();
    if(installerUI.statusItem){$.NSStatusBar.systemStatusBar.removeStatusItem(installerUI.statusItem);installerUI.statusItem=null;}
    const preferences=installerPreferences();preferences.removePersistentDomainForName(fixtureDomain);preferences.synchronize;
    $.exit(code);
}
ObjC.registerSubclass({name:'FPDFPrivateReopenObserver',superclass:'NSObject',methods:{'tick:':{types:['void',['id']],implementation:()=>{
    try{
        const count=fixtureInspections();
        if(fixturePhase===0&&!installerUI.running&&count===1){
            installerClose();fixturePhase=1;fixtureDeadline=Date.now()+5000;
            fixtureWrite('hidden.json',{pid:Number($.getpid()),visible:!!installerUI.window.visible,inspections:count});
        }else if(fixturePhase===1&&!installerUI.running&&count===2&&installerUI.window.visible){
            fixtureWrite('reopened.json',{pid:Number($.getpid()),visible:true,inspections:count});fixtureStop(0);
        }
        if(Date.now()>fixtureDeadline){fixtureWrite('failure',{message:'Actual AppleEvent reopen must show same process and refresh inspection',pid:Number($.getpid()),visible:!!installerUI.window.visible,inspections:count,phase:fixturePhase});fixtureStop(7);}
    }catch(error){fixtureWrite('failure',{message:String(error)});fixtureStop(7);}
}}}});
installerPreferences=function(){return $.NSUserDefaults.alloc.initWithSuiteName(fixtureDomain);};
installerPreferenceDomain=function(){return fixtureDomain;};
installerLoginService=function(){return {status:0};};
installerLoginEligible=function(){return false;};
installerBackendTask=function(operation,handle){
    if(fixtureReopen){
        if(operation!=='inspect')throw Error('Reopen fixture refuses backend mutation');
        const response=JSON.stringify({schemaVersion:1,operation:'inspect',outcome:{kind:'current',apps:{hwp:false,word:false,powerpoint:false,excel:false}}});
        const task=$.NSTask.alloc.init;task.launchPath='/bin/bash';
        task.arguments=$(['-c','echo inspect >> "$1"; printf "%s" "$2"','owned-reopen',fixtureStage+'/inspect-launches',response]);
        task.standardInput=$.NSFileHandle.fileHandleWithNullDevice;task.standardOutput=handle;task.standardError=$.NSFileHandle.fileHandleWithNullDevice;
        return task;
    }
    $('unexpected backend').writeToFileAtomicallyEncodingError(fixtureStage+'/backend-effect',true,$.NSUTF8StringEncoding,null);
    throw Error('Background must not inspect or mutate');
};
const actualFixtureRun=run;
run=function(args){
    const enabled=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_TEST_MENU'))==='true';
    const preferences=installerPreferences();
    preferences.setObjectForKey($(JSON.stringify(enabled)),'staticMenu');preferences.synchronize;
    $('started').writeToFileAtomicallyEncodingError(fixtureStage+'/started',true,$.NSUTF8StringEncoding,null);
    try{
        actualFixtureRun(args);
        if(fixtureReopen){
            fixtureDeadline=Date.now()+5000;fixtureObserver=$.FPDFPrivateReopenObserver.alloc.init;
            fixtureTimer=$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(0.05,fixtureObserver,'tick:',null,true);
            return;
        }
        const facts={visible:!!(installerUI.window&&installerUI.window.visible),task:!!installerUI.task,menu:!!installerUI.statusItem};
        $(JSON.stringify(facts)).writeToFileAtomicallyEncodingError(fixtureStage+'/facts.json',true,$.NSUTF8StringEncoding,null);
        if(facts.visible||facts.task||facts.menu!==enabled)throw Error('Background exposed a window, backend or incorrect menu');
        $.exit(0);
    }catch(error){
        $(String(error)).writeToFileAtomicallyEncodingError(fixtureStage+'/failure',true,$.NSUTF8StringEncoding,null);
        $.exit(7);
    }
};
`;
fs.writeFileSync(path.join(stage,'app.js'),base+'\n'+wrapper);
fs.writeFileSync(path.join(stage,'cleanup.js'),`ObjC.import('Foundation');const p=$.NSUserDefaults.alloc.initWithSuiteName(${JSON.stringify(domain)});p.removePersistentDomainForName(${JSON.stringify(domain)});p.synchronize;const remaining=p.persistentDomainForName(${JSON.stringify(domain)});if(remaining&&!remaining.isNil()&&Number(remaining.count)>0)throw Error('Owned background preference domain survived cleanup');\n`);
JS
app="$stage/Private Background Contract.app"
/usr/bin/osacompile -s -l JavaScript -o "$app" "$stage/app.js"
for language in en ko; do
  mkdir "$app/Contents/Resources/$language.lproj"
  cp "$root/resources/$language.lproj/Installer.json" "$app/Contents/Resources/$language.lproj/Installer.json"
done
/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string com.wonjun-lab.finder-pdf-converter.private-background-contract' "$app/Contents/Info.plist"
/usr/bin/codesign --force --sign - "$app" >/dev/null 2>&1
/usr/bin/codesign --verify --strict "$app"
if [ "${1:-}" != --reopen-only ]; then
for menu in false true; do
  rm -f "$stage/started" "$stage/facts.json" "$stage/failure" "$stage/backend-effect"
  FPDF_TEST_MENU="$menu" "$app/Contents/MacOS/applet" --background > "$stage/app.log" 2>&1 &
  pid=$!
  deadline=$((SECONDS+10))
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.1; done
  if kill -0 "$pid" 2>/dev/null; then cat "$stage/app.log"; printf '%s\n' 'Background native app did not finish its bounded fixture'; exit 1; fi
  result=0
  wait "$pid" || result=$?
  pid=''
  cat "$stage/app.log"
  if [ -f "$stage/failure" ]; then cat "$stage/failure"; exit 1; fi
  [ "$result" -eq 0 ] && [ -f "$stage/started" ] && [ ! -e "$stage/backend-effect" ] || exit 1
  if [ "$menu" = true ]; then
    node - "$stage/facts.json" <<'JS'
/** Background with a menu may retain that item but must expose no window or task. */
const assert=require('node:assert/strict');
assert.deepEqual(JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8')),{visible:false,task:false,menu:true});
JS
  fi
  /usr/bin/osascript -l JavaScript "$stage/cleanup.js"
done
printf '%s\n' 'management background: actual compiled arguments, menu off clean exit, menu on without window/backend, scoped cleanup passed'
fi
if [ "${1:-}" != --mutate-foreground ]; then
  rm -f "$stage/started" "$stage/failure" "$stage/hidden.json" "$stage/reopened.json" "$stage/inspect-launches"
  FPDF_TEST_MENU=true FPDF_TEST_REOPEN=true "$app/Contents/MacOS/applet" > "$stage/app.log" 2>&1 &
  pid=$!
  deadline=$((SECONDS+10))
  while [ ! -e "$stage/hidden.json" ] && kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.05; done
  [ -e "$stage/hidden.json" ] || { cat "$stage/app.log"; [ ! -e "$stage/failure" ] || cat "$stage/failure"; exit 1; }
  /usr/bin/open -a "$app"
  while kill -0 "$pid" 2>/dev/null && [ "$SECONDS" -lt "$deadline" ]; do /bin/sleep 0.05; done
  if kill -0 "$pid" 2>/dev/null; then printf '%s\n' 'Reopen native app did not self-finish'; exit 1; fi
  result=0; wait "$pid" || result=$?; pid=''
  cat "$stage/app.log"
  if [ -e "$stage/failure" ]; then cat "$stage/failure"; exit 1; fi
  [ "$result" -eq 0 ] || exit "$result"
  node - "$stage/hidden.json" "$stage/reopened.json" <<'JS'
/** Real LaunchServices reopen must target the existing process and trigger fresh inspection. */
const assert=require('node:assert/strict');const fs=require('node:fs');
const [before,after]=process.argv.slice(2).map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
assert.equal(before.visible,false);assert.equal(before.inspections,1);
assert.equal(after.pid,before.pid,'AppleEvent reopen must preserve the owned process');
assert.equal(after.visible,true);assert.equal(after.inspections,2,'AppleEvent reopen must refresh inspection');
console.log(JSON.stringify({nativeAppleEventReopen:true,pid:after.pid,beforeVisible:before.visible,afterVisible:after.visible,inspections:after.inspections}));
JS
  /usr/bin/osascript -l JavaScript "$stage/cleanup.js"
  printf '%s\n' 'management reopen: actual compiled AppleEvent opens existing process and refreshes inspection, scoped cleanup passed'
fi
