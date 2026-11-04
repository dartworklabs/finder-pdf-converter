use framework "Foundation"
use scripting additions

-- Export one caller-owned private XLSX copy using its saved print settings.
-- The caller serializes Excel use and supplies two absolute paths. Open links
-- are not updated. Only this read-only workbook is closed, without saving.
on run argv
    if (count argv) is not 2 then error "XLSX 변환에는 입력·출력 경로가 필요합니다."
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    if inputPath does not start with "/" or outputPath does not start with "/" then error "절대 경로가 필요합니다."
    set inputFile to POSIX file inputPath as alias
    set openedWorkbook to missing value
    try
        with timeout of 180 seconds
            tell application "Microsoft Excel"
                -- Refuse a caller path already open, so even a mistaken retry
                -- cannot take ownership of an existing workbook.
                -- Excel's workbook iterator is unreliable; filter natively by
                -- the caller path and its canonical spelling instead.
                repeat with queryPath in {inputPath, my canonicalPath(inputPath)}
                    set queryText to queryPath as text
                    if (count (get every workbook whose full name is queryText)) > 0 then error "변환용 Excel 사본이 이미 열려 있습니다."
                end repeat
                set openedWorkbook to open workbook workbook file name (inputFile as text) update links do not update links read only true ignore read only recommended true editable true add to mru false
                if openedWorkbook is missing value then error "변환용 Excel 통합 문서를 찾을 수 없습니다."
                -- Some Excel versions ignore the open-event read-only flag on
                -- writable files. The caller makes the private copy mode 0400;
                -- require Excel's own confirmation before exporting it.
                if not (read only of openedWorkbook) then error "Excel 변환용 사본이 읽기 전용으로 열리지 않았습니다."
                save workbook as openedWorkbook filename outputPath file format PDF file format add to most recently used list false
                -- Excel can report success for an unavailable destination.
                -- The caller additionally validates PDF bytes before publish.
                if not ((current application's NSFileManager's defaultManager())'s fileExistsAtPath:outputPath) then error "Excel에서 PDF 파일을 만들지 못했습니다."
                close openedWorkbook saving no
                set openedWorkbook to missing value
            end tell
        end timeout
    on error errorMessage number errorNumber
        if openedWorkbook is not missing value then
            try
                tell application "Microsoft Excel" to close openedWorkbook saving no
            end try
        end if
        error errorMessage number errorNumber
    end try
    return outputPath
end run

-- Match normalized POSIX spellings without selecting or activating user files.
on canonicalPath(pathText)
    set resolvedPath to (current application's NSString's stringWithString:pathText)'s stringByStandardizingPath()'s stringByResolvingSymlinksInPath()
    return resolvedPath's precomposedStringWithCanonicalMapping() as text
end canonicalPath
