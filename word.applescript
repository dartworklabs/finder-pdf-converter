use framework "Foundation"
use scripting additions

-- Export exactly one private DOCX copy to the supplied absolute PDF path.
-- The caller owns both paths and serializes app use. Existing user documents
-- remain open; only the exact copy opened here is closed without saving.
-- No activate command or application-wide setting is used.
on run argv
    if (count argv) is not 2 then error "DOCX 변환에는 입력·출력 경로가 필요합니다."
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    if inputPath does not start with "/" or outputPath does not start with "/" then error "절대 경로가 필요합니다."
    set inputFile to POSIX file inputPath as alias
    set openedDocument to missing value
    try
        with timeout of 180 seconds
            tell application "Microsoft Word"
                -- Word's open event does not reliably return a document.
                -- Resolve only the exact private path, never active document.
                open inputFile read only true add to recent files false confirm conversions false
                try
                    set openedDocument to first document whose posix full name is inputPath
                on error
                    set openedDocument to my documentAtAliasPath(inputPath)
                end try
                if openedDocument is missing value then error "변환용 Word 문서를 찾을 수 없습니다."
                save as openedDocument file name outputPath file format format PDF add to recent files false
                close openedDocument saving no
                set openedDocument to missing value
            end tell
        end timeout
    on error errorMessage number errorNumber
        if openedDocument is not missing value then
            try
                tell application "Microsoft Word" to close openedDocument saving no
            end try
        end if
        error errorMessage number errorNumber
    end try
    return outputPath
end run

-- Retry only equivalent absolute path spellings after Word's exact query.
-- Word does not reliably enumerate its document collection, so use its native
-- whose filter for each known alias instead of traversing user documents.
on documentAtAliasPath(inputPath)
    set canonicalInput to my canonicalPath(inputPath)
    set queryPaths to {canonicalInput}
    if canonicalInput starts with "/private/tmp/" or canonicalInput starts with "/private/var/" then set end of queryPaths to text 9 thru -1 of canonicalInput
    tell application "Microsoft Word"
        repeat with queryPath in queryPaths
            set queryText to queryPath as text
            try
                return first document whose posix full name is queryText
            end try
        end repeat
    end tell
    return missing value
end documentAtAliasPath

-- Compare standardized, symlink-resolved paths with macOS Unicode spelling.
on canonicalPath(pathText)
    set resolvedPath to (current application's NSString's stringWithString:pathText)'s stringByStandardizingPath()'s stringByResolvingSymlinksInPath()
    return resolvedPath's precomposedStringWithCanonicalMapping() as text
end canonicalPath
