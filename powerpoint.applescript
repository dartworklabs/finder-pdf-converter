use framework "Foundation"
use scripting additions

-- Export exactly one caller-owned private PPTX copy as a PDF.
-- The caller supplies absolute paths, serializes app use, and owns cleanup.
-- Existing presentations remain open; no application-wide setting is changed.
on run argv
    if (count argv) is not 2 then error "PPTX 변환에는 입력·출력 경로가 필요합니다."
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    if inputPath does not start with "/" or outputPath does not start with "/" then error "절대 경로가 필요합니다."
    set inputFile to POSIX file inputPath as alias
    -- PowerPoint requires HFS text here; a POSIX file produces error -1750.
    set outputFileName to (POSIX file outputPath) as text
    set openedPrivateCopy to false
    try
        with timeout of 180 seconds
            if my indexAtPath(inputPath) is not 0 then error "변환용 사본이 이미 PowerPoint에서 열려 있습니다."
            tell application "Microsoft PowerPoint" to open inputFile
            set openedPrivateCopy to true
            set privateIndex to my indexAtPath(inputPath)
            if privateIndex is 0 then error "변환용 PowerPoint 문서를 찾을 수 없습니다."
            tell application "Microsoft PowerPoint" to save presentation privateIndex in outputFileName as save as PDF
            my closePrivateCopy(inputPath)
            set openedPrivateCopy to false
        end timeout
    on error errorMessage number errorNumber
        if openedPrivateCopy then
            try
                my closePrivateCopy(inputPath)
            end try
        end if
        error errorMessage number errorNumber
    end try
    return outputPath
end run

-- Return the index for an exact private path, or zero when absent.
-- PowerPoint's `whose full name` filter fails with -1750, so inspect paths.
on indexAtPath(inputPath)
    tell application "Microsoft PowerPoint"
        repeat with presentationIndex from 1 to (count every presentation)
            if my canonicalPath((full name of presentation presentationIndex) as text) is my canonicalPath(inputPath) then return presentationIndex
        end repeat
    end tell
    return 0
end indexAtPath

-- Resolve the exact private path again before closing, without saving.
-- This never targets the active presentation or a pre-existing user document.
on closePrivateCopy(inputPath)
    set privateIndex to my indexAtPath(inputPath)
    if privateIndex is not 0 then
        tell application "Microsoft PowerPoint" to close presentation privateIndex saving no
    end if
end closePrivateCopy

-- Compare exact standardized paths while accepting /tmp or /var aliases.
on canonicalPath(pathText)
    set resolvedPath to (current application's NSString's stringWithString:pathText)'s stringByStandardizingPath()'s stringByResolvingSymlinksInPath()
    return resolvedPath's precomposedStringWithCanonicalMapping() as text
end canonicalPath
