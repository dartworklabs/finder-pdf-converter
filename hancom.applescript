use framework "Foundation"
use scripting additions

property operationPhase : "starting"

-- Export one private HWP/HWPX copy to a new PDF. The caller serializes jobs,
-- owns both absolute paths, validates PDF bytes, and publishes the result.
-- Existing Hancom windows are preserved. A unique private basename identifies
-- our new window; AXDocument must also match its path when Hancom exposes it.
on run argv
    if (count argv) is not 2 then error "HANCOM_ARGUMENTS: expected input and output absolute paths" number 64
    set sourcePath to item 1 of argv
    set outputPath to item 2 of argv
    if sourcePath does not start with "/" or outputPath does not start with "/" then error "HANCOM_ARGUMENTS: absolute paths required" number 64
    set inputFile to POSIX file sourcePath as alias
    set sourceName to name of (info for inputFile)
    set outputURL to current application's NSURL's fileURLWithPath:outputPath
    set outputName to outputURL's lastPathComponent() as text
    set outputDirectory to outputURL's URLByDeletingLastPathComponent()'s |path|() as text
    if outputName does not end with ".pdf" then error "HANCOM_ARGUMENTS: PDF extension required" number 64
    if my fileExists(outputPath) then error "HANCOM_OUTPUT_EXISTS: output already exists" number 65
    if not my fileExists(outputDirectory) then error "HANCOM_ARGUMENTS: output directory does not exist" number 64
    tell application "System Events"
        if not UI elements enabled then error "HANCOM_ACCESSIBILITY: enable Accessibility for the invoking app" number 69
        set baselineWindowNames to {}
        if exists process "Hancom Office HWP" then
            tell process "Hancom Office HWP"
                repeat with existingWindow in windows
                    set end of baselineWindowNames to my normalized(name of existingWindow)
                end repeat
            end tell
        end if
        if my normalized(sourceName) is in baselineWindowNames then error "HANCOM_BUSY: private copy name already open" number 75
    end tell
    set openedByUs to false
    try
        tell application "Hancom Office HWP"
            open inputFile
        end tell
        set openedByUs to true
        set deadline to (current date) + 45
        repeat
            if my ownedDocument(sourceName, sourcePath) is not missing value then exit repeat
            if (current date) > deadline then error "HANCOM_OPEN_TIMEOUT: document did not open; close any Hancom alert before retrying" number 70
            delay 0.2
        end repeat
        set operationPhase to "activate"
        my activateOwnedDocument(sourceName, sourcePath)
        my assertDocument(sourceName, sourcePath)
        tell application "System Events" to tell process "Hancom Office HWP"
            set operationPhase to "export-menu"
            click menu bar item "파일" of menu bar 1
            click menu item "PDF로 저장하기..." of menu "파일" of menu bar 1
        end tell
        set operationPhase to "wait-save-panel"
        set deadline to (current date) + 15
        repeat
            my assertFrontmost()
            tell application "System Events" to tell process "Hancom Office HWP"
                if exists window "PDF로 저장하기" then exit repeat
            end tell
            if (current date) > deadline then error "HANCOM_EXPORT_TIMEOUT: PDF save dialog did not appear" number 70
            delay 0.1
        end repeat
        set directoryName to (current application's NSURL's fileURLWithPath:outputDirectory)'s lastPathComponent() as text
        set inputDirectory to (current application's NSURL's fileURLWithPath:sourcePath)'s URLByDeletingLastPathComponent()'s |path|() as text
        tell application "System Events" to tell process "Hancom Office HWP"
            set displayedDirectory to value of pop up button 1 of splitter group 1 of window "PDF로 저장하기"
        end tell
        -- Batch jobs keep source and result inside one unique private folder.
        -- When native export already selects that folder, no global input is
        -- needed. The caller still verifies the exact requested PDF path.
        if my canonicalPath(inputDirectory) is not my canonicalPath(outputDirectory) or my normalized(displayedDirectory) is not my normalized(directoryName) then
            set operationPhase to "go-folder"
            my assertFrontmost()
            tell application "System Events" to tell process "Hancom Office HWP"
                key code 5 using {command down, shift down}
            end tell
            delay 0.8
            my assertFrontmost()
            tell application "System Events" to tell process "Hancom Office HWP"
                set value of text field 1 of sheet 1 of window "PDF로 저장하기" to outputDirectory & "/"
                key code 124
                key code 49
                key code 51
                delay 0.5
                key code 36
            end tell
            delay 0.2
        end if
        set operationPhase to "save-name"
        my assertFrontmost()
        if my fileExists(outputPath) then error "HANCOM_OUTPUT_EXISTS: output appeared before save" number 65
        tell application "System Events" to tell process "Hancom Office HWP"
            set value of text field 2 of splitter group 1 of window "PDF로 저장하기" to outputName
            click button "저장" of splitter group 1 of window "PDF로 저장하기"
        end tell
        set deadline to (current date) + 120
        repeat
            if my fileExists(outputPath) then
                tell application "System Events" to tell process "Hancom Office HWP"
                    if not (exists window "PDF로 저장하기") then exit repeat
                end tell
            end if
            if (current date) > deadline then error "HANCOM_EXPORT_TIMEOUT: no completed PDF; check Hancom for an alert" number 70
            delay 0.2
        end repeat
        set operationPhase to "close-copy"
        my closeOwnedDocument(sourceName, sourcePath)
        set deadline to (current date) + 10
        repeat
            if my ownedDocument(sourceName, sourcePath) is missing value then exit repeat
            if (current date) > deadline then error "HANCOM_CLOSE_TIMEOUT: document window did not close" number 70
            delay 0.1
        end repeat
        return outputPath
    on error messageText number errorNumber
        -- Only dismiss our known export dialog; unknown alerts and user windows
        -- remain untouched so no unrelated document or edit can be discarded.
        if openedByUs then
            try
                tell application "System Events" to tell process "Hancom Office HWP"
                    if my ownedDocument(sourceName, sourcePath) is not missing value then
                        if exists window "PDF로 저장하기" then click button "취소" of splitter group 1 of window "PDF로 저장하기"
                    end if
                end tell
                my closeOwnedDocument(sourceName, sourcePath)
            end try
        end if
        error messageText number errorNumber
    end try
end run

-- Return whether a local path exists without constructing a shell command.
on fileExists(filePath)
    return (current application's NSFileManager's defaultManager()'s fileExistsAtPath:filePath) as boolean
end fileExists

-- Compare decomposed macOS filenames with the spelling supplied by the caller.
on normalized(valueText)
    return (current application's NSString's stringWithString:valueText)'s precomposedStringWithCanonicalMapping() as text
end normalized

-- Global keyboard input is permitted only while Hancom owns the foreground.
on assertFrontmost()
    tell application "System Events" to tell process "Hancom Office HWP"
        if not frontmost then error "HANCOM_INTERRUPTED: foreground application changed during " & operationPhase number 75
    end tell
end assertFrontmost

-- Return the unique new document window, requiring its absolute path whenever
-- AXDocument is available. A missing path falls back to the collision-checked
-- unique private basename; any conflicting non-empty path is rejected.
on ownedDocument(sourceName, sourcePath)
    set matchedWindow to missing value
    set matchedCount to 0
    tell application "System Events" to tell process "Hancom Office HWP"
        repeat with candidate in windows
            if my normalized(name of candidate) is my normalized(sourceName) then
                set documentURL to missing value
                try
                    set documentURL to value of attribute "AXDocument" of candidate
                end try
                if documentURL is not missing value and documentURL is not "" then
                    set parsedURL to current application's NSURL's URLWithString:documentURL
                    set documentPath to parsedURL's |path|()
                    if documentPath is missing value then error "HANCOM_INTERRUPTED: document URL is invalid" number 75
                    if my canonicalPath(documentPath as text) is not my canonicalPath(sourcePath) then error "HANCOM_INTERRUPTED: document path changed" number 75
                end if
                set matchedCount to matchedCount + 1
                if matchedCount > 1 then error "HANCOM_INTERRUPTED: private copy name is no longer unique" number 75
                set matchedWindow to contents of candidate
            end if
        end repeat
    end tell
    return matchedWindow
end ownedDocument

-- Normalize filesystem spelling and symlink aliases before comparing paths.
on canonicalPath(pathText)
    return my normalized((current application's NSString's stringWithString:pathText)'s stringByResolvingSymlinksInPath() as text)
end canonicalPath

-- Raise only our newly opened copy, request activation once, and wait for the
-- asynchronous macOS foreground/main-window transition before beginning input.
-- Later user focus changes still abort through assertFrontmost.
on activateOwnedDocument(sourceName, sourcePath)
    set targetWindow to my ownedDocument(sourceName, sourcePath)
    if targetWindow is missing value then error "HANCOM_INTERRUPTED: private document disappeared" number 75
    tell application "System Events"
        perform action "AXRaise" of targetWindow
        tell process "Hancom Office HWP" to set frontmost to true
    end tell
    set activationDeadline to (current date) + 10
    repeat
        set targetWindow to my ownedDocument(sourceName, sourcePath)
        if targetWindow is missing value then error "HANCOM_INTERRUPTED: private document disappeared" number 75
        tell application "System Events"
            tell process "Hancom Office HWP" to set isForeground to frontmost
            if isForeground and (value of attribute "AXMain" of targetWindow) then return
        end tell
        if (current date) > activationDeadline then error "HANCOM_ACTIVATION_TIMEOUT: private document could not become active" number 75
        delay 0.1
    end repeat
end activateOwnedDocument

-- Before exporting or closing, require our verified private document to own
-- Hancom's main window. Other pre-existing windows remain outside our scope.
on assertDocument(sourceName, sourcePath)
    my assertFrontmost()
    set targetWindow to my ownedDocument(sourceName, sourcePath)
    if targetWindow is missing value then error "HANCOM_INTERRUPTED: private document disappeared" number 75
    tell application "System Events"
        if not (value of attribute "AXMain" of targetWindow) then error "HANCOM_INTERRUPTED: active document changed" number 75
        if (count sheets of targetWindow) is not 0 then error "HANCOM_BUSY: document has a dialog" number 75
    end tell
end assertDocument

-- Close only the collision-checked, uniquely named private window through its
-- own AX close control. This does not activate Hancom or send global input.
-- Discard a legacy-file dirty prompt only when it names that exact copy.
on closeOwnedDocument(sourceName, sourcePath)
    set targetWindow to my ownedDocument(sourceName, sourcePath)
    if targetWindow is missing value then return
    tell application "System Events"
        set closeControl to value of attribute "AXCloseButton" of targetWindow
        perform action "AXPress" of closeControl
    end tell
    set closeDeadline to (current date) + 5
    repeat
        if my ownedDocument(sourceName, sourcePath) is missing value then return
        tell application "System Events" to tell process "Hancom Office HWP"
            if exists window "한컴오피스 한글" then
                set alertText to value of static text 2 of window "한컴오피스 한글"
                if my normalized(alertText) is my normalized(sourceName & "를 저장할까요?") then
                    click button "저장 안 함" of window "한컴오피스 한글"
                    return
                else
                    error "HANCOM_BUSY: unexpected confirmation left open" number 75
                end if
            end if
        end tell
        if (current date) > closeDeadline then return
        delay 0.1
    end repeat
end closeOwnedDocument
