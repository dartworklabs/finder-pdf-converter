#!/bin/bash
# Exercise actual native checkbox transitions through the owned login adapter only.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/fpdf-login-control.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT
cat "$root/model.js" > "$stage/check.js"
sed 's/^function run(/function nativeTestEntry(/' "$root/ui.js" >> "$stage/check.js"
printf '\ninstallerUI.strings = ' >> "$stage/check.js"
cat "$root/resources/en.lproj/Installer.json" >> "$stage/check.js"
printf ';\n' >> "$stage/check.js"
cat >> "$stage/check.js" <<'JXA'
$.NSApplication.sharedApplication;
$.NSApp.setActivationPolicy(2);
installerUI.preview=false;
installerUI.controller=$.FPDFInstallerController.alloc.init;
installerUI.loginToggle=$.NSButton.checkboxWithTitleTargetAction('Private login control',installerUI.controller,'toggleLogin:');
installerUI.loginStatus=$.NSTextField.labelWithString('');
let observed='3',after='1',effects=[],errors=0;
const service={
    get status(){return observed;},
    registerAndReturnError:error=>{effects.push({kind:'register',clickedState:Number(installerUI.loginToggle.state)});observed=after;return true;},
    unregisterAndReturnError:error=>{effects.push({kind:'unregister',clickedState:Number(installerUI.loginToggle.state)});observed=after;return true;},
};
installerLoginService=function(){return service;};
installerLoginEligible=function(){return true;};
installerLoginError=function(){errors++;};
installerPreferences=function(){throw Error('Native control fixture has no preference authority');};
installerBackendTask=function(){throw Error('Native control fixture has no backend authority');};
for(const menu of [false,true]){
    installerUI.menuEnabled=menu;
    for(const scenario of [
        {before:'3',after:'1',effect:'register'},
        {before:'0',after:'1',effect:'register'},
        {before:'2',after:'0',effect:'unregister'},
        {before:'1',after:'0',effect:'unregister'},
    ]){
        observed=scenario.before;after=scenario.after;effects=[];errors=0;
        installerRefreshLogin();
        const before=Number(installerUI.loginToggle.state);
        if(!installerUI.loginToggle.enabled)throw Error('Readable native state disabled an eligible checkbox');
        // AppKit determines the click transition; setting state=1 directly would
        // miss the real off→mixed cycle that caused the observed product defect.
        installerUI.loginToggle.performClick(null);
        console.log(JSON.stringify({nativeCheckbox:true,menu:menu,beforeService:scenario.before,beforeButton:before,effects:effects,afterService:observed,errors:errors,realRegistration:false}));
        if(effects.length!==1||effects[0].kind!==scenario.effect)
            throw Error('Native checkbox click from service '+scenario.before+' must '+scenario.effect);
        if(errors||installerUI.menuEnabled!==menu||observed!==scenario.after)
            throw Error('Native checkbox click contradicted the resulting service state or menu preference');
    }
}
console.log('management login control: real native off/pending/on clicks invoke intended owned service effect; no real settings/registration/backend passed');
JXA
/usr/bin/osascript -l JavaScript "$stage/check.js"
