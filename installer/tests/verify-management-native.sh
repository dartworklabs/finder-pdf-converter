#!/bin/bash
# Exercise real owned native windows, preferences, status image and harmless tasks.
set -eu
case "${1:-}" in ''|--mutate-glyph|--mutate-prefscope) ;; *) exit 2 ;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/fpdf-manager-native.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
cat "$root/model.js" > "$stage/check.js"
sed 's/^function run(/function nativeTestEntry(/' "$root/ui.js" >> "$stage/check.js"
if [ "${1:-}" = --mutate-prefscope ]; then
  sed 's/const domain = installerPreferences().persistentDomainForName(.*);/const domain = installerPreferences();/' "$stage/check.js" > "$stage/mutant.js"
  mv "$stage/mutant.js" "$stage/check.js"
fi
printf '\ninstallerUI.strings = ' >> "$stage/check.js"
cat "$root/resources/en.lproj/Installer.json" >> "$stage/check.js"
printf ';\n' >> "$stage/check.js"
if [ "${1:-}" = --mutate-glyph ]; then
  cat >> "$stage/check.js" <<'JXA'
const realNativeRender=installerRender;
installerRender=function(outcome){realNativeRender(outcome);if(installerUI.statusItem&&outcome.kind==='failed')installerUI.statusItem.button.alphaValue=0.5;};
JXA
fi
cat >> "$stage/check.js" <<'JXA'
$.NSApplication.sharedApplication;
$.NSApp.setActivationPolicy(1);
const privateDirectory=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_NATIVE_STAGE'));
const launchMarker=privateDirectory+'/inspect-launches';
const domain='com.wonjun-lab.finder-pdf-converter.native-test.'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
const preferences=$.NSUserDefaults.alloc.initWithSuiteName(domain);
const actualPreferences=typeof installerPreferences==='function'?installerPreferences:null;
const actualPreferenceDomain=typeof installerPreferenceDomain==='function'?installerPreferenceDomain:null;
const actualLoginService=typeof installerLoginService==='function'?installerLoginService:null;
const actualLoginEligible=typeof installerLoginEligible==='function'?installerLoginEligible:null;
const actualLoginError=typeof installerLoginError==='function'?installerLoginError:null;
const actualBackend=installerBackendTask;
let ownedTask=null;
/** Read only the private adapter's external launch receipt. */
function launchCount(){
    const text=$.NSString.stringWithContentsOfFileEncodingError(launchMarker,$.NSUTF8StringEncoding,null);
    return text&&!text.isNil()?ObjC.unwrap(text).split('\n').filter(Boolean).length:0;
}
/** Let the normal native event queue deliver bounded callbacks during observation. */
function settle(seconds){$.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(seconds));}
/** Apply the same public status-read contract to real and owned fake services. */
function readableStatusContract(expectedStatus,label,nativeStatus){
    const observed=installerLoginObservation();
    if(!observed.readable)throw Error(label+': canonical native service status must be readable');
    if(observed.status!==expectedStatus)throw Error(label+': normalized native status was presented incorrectly');
    if(observed.nativeStatus!==nativeStatus)throw Error(label+': canonical native status did not normalize to its integer');
}
/** Capture the actual native item, including properties a constant TIFF would miss. */
function glyph(){
    const item=installerUI.statusItem;
    if(!item||item.isNil())throw Error('Enabled menu did not create a real native status item');
    const button=item.button,image=button.image,layer=button.layer;
    if(!image||image.isNil())throw Error('Static document image is absent');
    const bitmap=$.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
    const pixels=bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG,$({}));
    const frame=button.frame;
    return JSON.stringify({
        tiff:ObjC.unwrap(image.TIFFRepresentation.base64EncodedStringWithOptions(0)),
        pixels:ObjC.unwrap(pixels.base64EncodedStringWithOptions(0)),
        template:Boolean(image.template),width:Number(image.size.width),height:Number(image.size.height),
        alpha:Number(button.alphaValue),hidden:Boolean(button.hidden),
        frame:[Number(frame.origin.x),Number(frame.origin.y),Number(frame.size.width),Number(frame.size.height)],
        transform:layer&&!layer.isNil()?['rotation.x','rotation.y','rotation.z','scale.x','scale.y','scale.z','translation.x','translation.y','translation.z'].map(key=>Number(layer.valueForKeyPath('transform.'+key))):null,
    });
}
try {
    // A never-registered, missing plist can be observed without any registration
    // or setting mutation. This is the actual JXA NS_ENUM bridge contract.
    ObjC.import('ServiceManagement');
    const readOnlyService=$.SMAppService.agentServiceWithPlistName('com.wonjun-lab.finder-pdf-converter.native-contract-missing.plist');
    const rawStatus=readOnlyService.status;
    console.log(JSON.stringify({realServiceStatusType:typeof rawStatus,realServiceStatusValue:rawStatus,operation:'read-only status',registration:false}));
    if(rawStatus!==3&&rawStatus!=='3')throw Error('Missing-plist read-only fixture did not report native not-found');
    installerLoginService=function(){return readOnlyService;};
    readableStatusContract('unavailable','REAL missing-plist service',3);
    installerLoginService=actualLoginService;
    let backgroundOptions=null;
    try{backgroundOptions=installerLaunchOptions(['--background']);}catch(_error){}
    if(!backgroundOptions||backgroundOptions.background!==true)
        throw Error('Explicit background launch argument must be recognized without presentation overrides');
    for(const invalid of [['--background','--background'],['--background','--preview','fresh'],['--background','--locale','en']]){
        let rejected=false;try{installerLaunchOptions(invalid);}catch(_error){rejected=true;}
        if(!rejected)throw Error('Conflicting background presentation arguments were accepted');
    }
    installerUI.preview=false;
    installerUI.menuEnabled=true;
    installerUI.running=false;
    installerUI.finished=true;
    installerUI.controller=$.FPDFInstallerController.alloc.init;
    installerUI.window=$.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0,0,620,520),7,2,false);
    installerUI.window.title='PRIVATE native manager test';
    installerUI.window.releasedWhenClosed=false;
    for(const name of ['title','body','steps'])installerUI[name]=$.NSTextField.labelWithString('');
    for(const name of ['primary','close','details'])installerUI[name]=$.NSButton.alloc.init;
    installerUI.spinner=$.NSProgressIndicator.alloc.init;
    // Replace our owned adapter only: the real NSTask still launches and writes
    // its receipt; it cannot install, register a login item or change Services.
    installerBackendTask=function(operation,handle){
        if(['inspect','install','recover'].indexOf(operation)<0)throw Error('Unknown private operation');
        const task=$.NSTask.alloc.init;
        task.launchPath='/bin/sh';
        task.arguments=$(['-c','printf "%s\\n" "$2" >> "$1"; exec /bin/sleep 30','native-check',launchMarker,operation]);
        task.standardInput=$.NSFileHandle.fileHandleWithNullDevice;
        task.standardOutput=handle;task.standardError=$.NSFileHandle.fileHandleWithNullDevice;
        ownedTask=task;return task;
    };
    if(typeof installerOpen==='function')installerOpen();
    settle(0.1);
    if(!installerUI.window.visible||!installerUI.running||installerUI.finished||launchCount()!==1)
        throw Error('Manual reopening must show manager, reset finished and start fresh inspection');
    const originalTask=installerUI.task;
    if(!installerUI.controller.applicationShouldHandleReopenHasVisibleWindows(null,true))
        throw Error('Native application reopen event was not accepted');
    settle(0.1);
    if(installerUI.task!==originalTask||launchCount()!==1)
        throw Error('Reopening during inspection launched duplicate work');
    if(!installerStopInspection())throw Error('Owned inspect fixture did not cancel');
    if(originalTask.running)throw Error('Closing inspect left an owned task alive');
    installerUI.controller.openManager(null);settle(0.1);
    if(launchCount()!==2)throw Error('Next manager open reused stale inspection');
    if(!installerStopInspection())throw Error('Second owned inspect fixture did not cancel');
    installerClose();
    if(installerUI.window.visible)throw Error('Menu-enabled close must hide the manager window');

    // All newly routed close/quit actions must preserve actual owned mutation
    // work, independently of the existing direct prepare-close unit guard.
    const mutationTask=$.NSTask.alloc.init;
    mutationTask.launchPath='/bin/sleep';mutationTask.arguments=$(['30']);
    mutationTask.standardOutput=$.NSFileHandle.fileHandleWithNullDevice;
    mutationTask.standardError=$.NSFileHandle.fileHandleWithNullDevice;
    ownedTask=mutationTask;mutationTask.launch;
    try{
        installerUI.task=mutationTask;installerUI.running=true;
        for(const operation of ['install','recover']){
            installerUI.invoked=operation;
            installerClose();installerQuit();installerUI.controller.quitInstaller(null);
            if(installerUI.controller.windowShouldClose(null)!==false||!mutationTask.running||!installerUI.running)
                throw Error('Manager close/quit abandoned actual owned mutation work');
            installerUI.menuEnabled=true;installerUpdateMenu();
            installerUI.menuEnabled=false;installerUpdateMenu();
            if(!mutationTask.running||!installerUI.running||installerUI.statusItem!==null)
                throw Error('Disabling menu interrupted owned mutation work');
        }
    }finally{
        if(mutationTask.running)mutationTask.terminate;mutationTask.waitUntilExit;
        installerUI.task=null;installerUI.running=false;
    }

    installerUI.menuEnabled=true;
    if(typeof installerUpdateMenu==='function')installerUpdateMenu();
    settle(0.1);
    const initialGlyph=glyph();
    const initialImage=JSON.parse(initialGlyph);
    if(!initialImage.template||initialImage.width<=0||initialImage.height<=0||!initialImage.pixels)
        throw Error('Static glyph must be a nonempty native template image');
    for(const outcome of [
        {kind:'fresh',apps:{hwp:false,word:false,powerpoint:false,excel:false}},
        {kind:'installed'}, {kind:'failed',code:'operation-failed'},
    ]){
        installerRender(outcome);
        for(let tick=0;tick<4;tick++){settle(0.05);if(glyph()!==initialGlyph)throw Error('Static glyph changed across result frames');}
    }
    for(const operation of ['inspect','install','recover']){
        installerStart(operation);
        if(!installerUI.running||!installerUI.task||!installerUI.task.running)throw Error('Private busy native operation did not start');
        try{
            for(let tick=0;tick<4;tick++){settle(0.05);if(glyph()!==initialGlyph)throw Error('Static glyph changed across busy frames');}
        }finally{
            // These are harmless test-owned sleep processes, never an actual
            // install/recover effect; stop them only in fixture teardown.
            if(installerUI.task&&installerUI.task.running){installerUI.task.terminate;installerUI.task.waitUntilExit;}
            if(installerUI.timer)installerUI.timer.invalidate;
            installerUI.timer=null;installerUI.running=false;installerCleanTask();
        }
    }
    installerUI.menuEnabled=false;installerUpdateMenu();
    if(installerUI.statusItem!==null)throw Error('Disabling the menu retained its owned status item');

    if(!actualPreferences)throw Error('Scoped native preference adapter is unavailable');
    installerPreferences=function(){return preferences;};
    installerPreferenceDomain=function(){return domain;};
    preferences.removeObjectForKey('staticMenu');
    preferences.registerDefaults($({staticMenu:'true'}));
    if(ObjC.unwrap(preferences.objectForKey('staticMenu'))!=='true')throw Error('Process-only fallback fixture did not apply');
    if(installerLoadMenuPreference().enabled!==false)throw Error('Registration-domain fallback must never enable an absent own preference');
    preferences.setObjectForKey('preserve-me','unrelated');
    for(const enabled of [false,true,false]){
        if(installerSaveMenuPreference(enabled)!==true)throw Error('Owned native preference write failed');
        if(installerLoadMenuPreference().enabled!==enabled)throw Error('Preference readback contradicted confirmed write');
        if(ObjC.unwrap(preferences.objectForKey('staticMenu'))!==String(enabled))throw Error('Preference persisted an unexpected representation');
        if(ObjC.unwrap(preferences.objectForKey('unrelated'))!=='preserve-me')throw Error('Menu preference clobbered an unrelated key');
    }
    for(const malformed of ['1','null','{}','"true"','bad-json','true'+' '.repeat(20)]){
        preferences.setObjectForKey(malformed,'staticMenu');
        if(installerLoadMenuPreference().enabled!==false)throw Error('Malformed native preference enabled the menu');
        if(ObjC.unwrap(preferences.objectForKey('staticMenu'))!==malformed)throw Error('Read silently rewrote malformed preference');
        if(installerSaveMenuPreference(true)!==false)throw Error('Malformed preference was overwritten by a toggle');
    }
    preferences.setObjectForKey($(true),'staticMenu');
    if(installerLoadMenuPreference().enabled!==false)throw Error('Wrong native preference type enabled the menu');
    preferences.setObjectForKey('false','staticMenu');preferences.synchronize;
    const failingPreferences={
        persistentDomainForName:name=>preferences.persistentDomainForName(name),
        setObjectForKey:(value,key)=>preferences.setObjectForKey(value,key),
        removeObjectForKey:key=>preferences.removeObjectForKey(key),
        get synchronize(){throw Error('Injected owned-adapter synchronization failure');},
    };
    installerPreferences=function(){return failingPreferences;};
    if(installerSaveMenuPreference(true)!==false)throw Error('Synchronization exception falsely claimed persisted enablement');
    installerPreferences=function(){return preferences;};preferences.synchronize;
    if(installerLoadMenuPreference().enabled!==false)throw Error('Synchronization exception did not preserve prior preference');
    const beforeFailure=ObjC.unwrap(preferences.objectForKey('staticMenu'));
    installerPreferences=function(){throw Error('Private adapter unavailable');};
    if(installerLoadMenuPreference().enabled!==false||installerSaveMenuPreference(true)!==false)
        throw Error('Unavailable preference adapter claimed an enabled setting');
    if(ObjC.unwrap(preferences.objectForKey('staticMenu'))!==beforeFailure)
        throw Error('Unavailable preference adapter changed persisted data');
    installerPreferences=function(){return preferences;};

    // The external service is replaced only at our owned adapter factory. Native
    // controls and the app's real scoped preference store remain real throughout.
    if(!actualLoginService||!actualLoginEligible||!actualLoginError)throw Error('Owned login adapters are unavailable');
    installerUI.loginToggle=$.NSButton.alloc.init;
    installerUI.loginStatus=$.NSTextField.labelWithString('');
    installerLoginEligible=function(){return true;};
    let observedStatus=0,serviceEffects=[],loginErrors=0;
    let nextStatus=0,nativeSuccess=true,nativeThrows=false;
    const service={
        get status(){return observedStatus;},
        registerAndReturnError:error=>{serviceEffects.push('register');observedStatus=nextStatus;if(nativeThrows)throw Error('Owned register failure');return nativeSuccess;},
        unregisterAndReturnError:error=>{serviceEffects.push('unregister');observedStatus=nextStatus;if(nativeThrows)throw Error('Owned unregister failure');return nativeSuccess;},
    };
    installerLoginService=function(){return service;};
    installerLoginError=function(){loginErrors++;};
    for(const entry of [[0,'disabled',0,'loginDisabled'],[1,'enabled',1,'loginEnabled'],[2,'approval-required',-1,'loginApproval'],[3,'unavailable',0,'loginNotRegistered']]){
        for(const value of [entry[0],String(entry[0])]){
            observedStatus=value;readableStatusContract(entry[1],'Owned service '+JSON.stringify(value),entry[0]);
            installerRefreshLogin();
            if(installerLoginStatus()!==entry[1]||Number(installerUI.loginToggle.state)!==entry[2]||ObjC.unwrap(installerUI.loginStatus.stringValue)!==installerUI.strings[entry[3]])
                throw Error('Native login display contradicted actual service status');
            if(!installerUI.loginToggle.enabled)throw Error('Readable native status must allow an explicit eligible action');
        }
    }
    for(const value of [99,-1,1.5,'01','true','1x',' 1','1 ','1\n','1\r','\t1','1.0','4','-0',null,undefined,{},[],{valueOf:()=>1}]){
        observedStatus=value;installerRefreshLogin();
        if(installerLoginObservation().readable||installerLoginStatus()!=='unavailable'||installerUI.loginToggle.enabled)
            throw Error('Noncanonical native status granted login availability');
    }
    if(serviceEffects.length)throw Error('Read-only login refresh performed a service mutation');
    installerLoginService=function(){throw Error('Owned native service unavailable');};
    installerRefreshLogin();
    if(installerLoginStatus()!=='unavailable'||installerUI.loginToggle.enabled||ObjC.unwrap(installerUI.loginStatus.stringValue)!==installerUI.strings.loginUnavailable)
        throw Error('Native API failure falsely showed available login controls');
    installerLoginEligible=function(){return false;};installerRefreshLogin();
    if(installerUI.loginToggle.enabled||ObjC.unwrap(installerUI.loginStatus.stringValue)!==installerUI.strings.loginUnavailable)
        throw Error('Native API failure was concealed by a location message');
    installerLoginEligible=function(){return true;};
    installerLoginService=function(){return service;};
    for(const menu of [false,true]){
        installerUI.menuEnabled=menu;
        for(const bridgeString of [false,true]){
        for(const scenario of [
            {enable:true,before:0,after:1,ok:true,display:1,error:false},
            {enable:true,before:3,after:1,ok:true,display:1,error:false},
            {enable:true,before:0,after:2,ok:true,display:-1,error:false},
            {enable:true,before:0,after:0,ok:false,display:0,error:true},
            {enable:true,before:0,after:0,ok:true,display:0,error:true},
            {enable:true,before:0,after:0,ok:false,throws:true,display:0,error:true},
            {enable:false,before:1,after:0,ok:true,display:0,error:false},
            {enable:false,before:1,after:1,ok:false,display:1,error:true},
        ]){
            observedStatus=bridgeString?String(scenario.before):scenario.before;
            nextStatus=bridgeString?String(scenario.after):scenario.after;nativeSuccess=scenario.ok;
            nativeThrows=!!scenario.throws;
            serviceEffects=[];loginErrors=0;installerUI.loginToggle.state=scenario.enable?1:0;
            const persistedBefore=ObjC.unwrap(preferences.objectForKey('staticMenu'));
            installerToggleLogin();
            if(serviceEffects.join(',')!==(scenario.enable?'register':'unregister'))throw Error('Login action invoked an unrelated service effect');
            if(Number(installerUI.loginToggle.state)!==scenario.display||Boolean(loginErrors)!==scenario.error)
                throw Error('Login refusal or pending approval was reported untruthfully');
            if(installerUI.menuEnabled!==menu||ObjC.unwrap(preferences.objectForKey('staticMenu'))!==persistedBefore)
                throw Error('Login toggle changed the independent menu preference');
        }
        }
    }
    installerLoginEligible=function(){return false;};observedStatus=0;serviceEffects=[];
    installerUI.loginToggle.state=1;installerToggleLogin();
    if(serviceEffects.length||installerUI.loginToggle.enabled||Number(installerUI.loginToggle.state)!==0||ObjC.unwrap(installerUI.loginStatus.stringValue)!==installerUI.strings.loginMove)
        throw Error('Unretained manager registered login or concealed its location refusal');
    installerUI.preview=true;
    const before=ObjC.unwrap(preferences.objectForKey('staticMenu'));
    installerSaveMenuPreference(true);
    serviceEffects=[];installerUI.loginToggle.state=1;installerToggleLogin();
    if(serviceEffects.length)throw Error('Inert preview registered a login item');
    if(ObjC.unwrap(preferences.objectForKey('staticMenu'))!==before)throw Error('Inert preview wrote persistent preferences');
    console.log('management native: real reopen/inspect ownership, static native glyph frames, menu removal, scoped preferences, authoritative login adapter/refusals and preview preservation passed');
} finally {
    installerBackendTask=actualBackend;
    if(actualPreferences)installerPreferences=actualPreferences;
    if(actualPreferenceDomain)installerPreferenceDomain=actualPreferenceDomain;
    if(actualLoginService)installerLoginService=actualLoginService;
    if(actualLoginEligible)installerLoginEligible=actualLoginEligible;
    if(actualLoginError)installerLoginError=actualLoginError;
    if(ownedTask&&ownedTask.running){ownedTask.terminate;ownedTask.waitUntilExit;}
    if(installerUI.timer)installerUI.timer.invalidate;
    installerUI.running=false;installerCleanTask();
    if(installerUI.statusItem){$.NSStatusBar.systemStatusBar.removeStatusItem(installerUI.statusItem);installerUI.statusItem=null;}
    if(installerUI.window)installerUI.window.orderOut(null);
    preferences.removePersistentDomainForName(domain);preferences.synchronize;
    const remaining=preferences.persistentDomainForName(domain);
    if(remaining&&!remaining.isNil()&&Number(remaining.count)>0)throw Error('Owned native preference domain survived cleanup');
}
JXA
result=0
FPDF_NATIVE_STAGE="$stage" bash "$root/tests/run-native-applet.sh" "$stage" "$stage/check.js" > "$stage/result.log" 2>&1 || result=$?
cat "$stage/result.log"
[ "$result" -eq 0 ] || exit "$result"
# A native termination call can end the host successfully before the assertions.
/usr/bin/grep -Fq 'management native: real reopen/inspect ownership' "$stage/result.log"
