# Result localization public surface: fpdf_language SCRIPT, fpdf_text KEY [ARGS],
# fpdf_adapter_reason DIAGNOSTIC EXTENSION. Callers set fpdf_locale from the
# selector once per invocation. Paths, filenames and external errors are data.

# Read macOS preferred languages through the shared Foundation selector.
# A missing helper or unreadable preference falls back to English.
fpdf_language() {
    local language
    language=$(/usr/bin/osascript -l JavaScript "$1" 2>/dev/null) || language=en
    case $language in en|ko) printf '%s' "$language" ;; *) printf en ;; esac
}

# Format only trusted catalog strings; substitutions never become format code.
# Unknown keys fail rather than displaying a potentially incorrect message.
fpdf_text() {
    local key=$1 format
    shift
    case "${fpdf_locale:-en}:$key" in
        ko:title) format='PDF 변환 결과' ;; en:title) format='PDF Conversion Results' ;;
        ko:ok) format='확인' ;; en:ok) format='OK' ;;
        ko:missing_converter) format='PDF 변환기를 찾을 수 없습니다. 빠른 동작을 다시 설치해 주세요.' ;; en:missing_converter) format='The PDF converter could not be found. Reinstall the Quick Action.' ;;
        ko:launch_failed) format='PDF 변환기를 실행하지 못했습니다. (종료 코드: %s)' ;; en:launch_failed) format='The PDF converter could not start. (Exit code: %s)' ;;
        ko:no_input) format='변환할 문서를 선택해 주세요. 지원 형식: HWP, HWPX, DOCX, PPTX, XLSX, CSV, PNG, JPG, JPEG, HEIC, HEIF, DNG, TXT, MD, MARKDOWN' ;; en:no_input) format='Select files to convert. Supported formats: HWP, HWPX, DOCX, PPTX, XLSX, CSV, PNG, JPG, JPEG, HEIC, HEIF, DNG, TXT, MD, MARKDOWN' ;;
        ko:lock_folder) format='변환 잠금 폴더를 만들 수 없습니다.' ;; en:lock_folder) format='The conversion lock folder could not be created.' ;;
        ko:busy) format='다른 PDF 변환이 진행 중입니다. 완료 후 다시 실행해 주세요.' ;; en:busy) format='Another PDF conversion is running. Try again when it finishes.' ;;
        ko:work_folder) format='임시 작업 폴더를 만들 수 없습니다.' ;; en:work_folder) format='A temporary work folder could not be created.' ;;
        ko:summary) format='완료 %s개 · 건너뜀 %s개 · 실패 %s개' ;; en:summary) format='Completed: %s · Skipped: %s · Failed: %s' ;;
        ko:completed) format='완료: %s → %s' ;; en:completed) format='Completed: %s → %s' ;;
        ko:skipped) format='건너뜀: %s — %s' ;; en:skipped) format='Skipped: %s — %s' ;;
        ko:failed) format='실패: %s — %s' ;; en:failed) format='Failed: %s — %s' ;;
        ko:not_readable) format='읽을 수 있는 일반 파일이 아닙니다.' ;; en:not_readable) format='This is not a readable regular file.' ;;
        ko:unsupported) format='지원하지 않는 형식입니다.' ;; en:unsupported) format='This file format is not supported.' ;;
        ko:source_folder) format='원본 폴더에 접근할 수 없습니다.' ;; en:source_folder) format='The source folder could not be accessed.' ;;
        ko:exists) format='같은 이름의 PDF가 이미 있습니다.' ;; en:exists) format='A PDF with the same name already exists.' ;;
        ko:missing_adapter) format='변환 도우미가 없습니다. 변환기를 다시 설치해 주세요.' ;; en:missing_adapter) format='A conversion helper is missing. Reinstall the converter.' ;;
        ko:office_folder) format='%s 임시 작업 폴더를 만들 수 없습니다.' ;; en:office_folder) format='A temporary work folder for %s could not be created.' ;;
        ko:office_file) format='Office 임시 파일을 만들 수 없습니다.' ;; en:office_file) format='A temporary Office file could not be created.' ;;
        ko:copy) format='원본의 임시 사본을 만들 수 없습니다.' ;; en:copy) format='A temporary copy of the source file could not be created.' ;;
        ko:excel_readonly) format='Excel 사본을 읽기 전용으로 만들 수 없습니다.' ;; en:excel_readonly) format='The Excel copy could not be made read-only.' ;;
        ko:invalid_pdf) format='생성된 PDF를 열어 확인할 수 없습니다.' ;; en:invalid_pdf) format='The generated PDF could not be opened and verified.' ;;
        ko:stage) format='원본 폴더에 PDF를 준비할 수 없습니다.' ;; en:stage) format='The PDF could not be staged in the source folder.' ;;
        ko:race) format='저장 중 같은 이름의 PDF가 생겼습니다.' ;; en:race) format='A PDF with the same name appeared during saving.' ;;
        ko:publish) format='PDF를 안전하게 저장할 수 없습니다. 폴더 권한 또는 파일시스템의 안전한 이름 변경 지원을 확인해 주세요.' ;; en:publish) format='The PDF could not be saved safely. Check folder permissions and filesystem support for exclusive renaming.' ;;
        ko:app_error) format='변환 앱에서 오류가 발생했습니다.' ;; en:app_error) format='The conversion app reported an error.' ;;
        ko:details) format='기술 정보: %s' ;; en:details) format='Technical details: %s' ;;
        ko:automation) format='앱 자동화가 허용되지 않았습니다. 시스템 설정의 개인정보 보호 및 보안 > 자동화에서 실행 앱의 권한을 확인해 주세요.' ;; en:automation) format='App automation was not allowed. Check the calling app under System Settings > Privacy & Security > Automation.' ;;
        ko:accessibility) format='한컴 변환에 필요한 손쉬운 사용 권한이 없습니다. 시스템 설정의 개인정보 보호 및 보안 > 손쉬운 사용에서 실행 앱을 허용해 주세요.' ;; en:accessibility) format='Hancom conversion requires Accessibility permission. Allow the calling app under System Settings > Privacy & Security > Accessibility.' ;;
        ko:app_missing) format='변환에 필요한 앱을 찾을 수 없거나 실행할 수 없습니다.' ;; en:app_missing) format='The required conversion app could not be found or started.' ;;
        ko:hancom_open) format='한컴에서 문서를 열지 못했습니다. 한컴의 알림 창을 닫은 뒤 다시 실행해 주세요.' ;; en:hancom_open) format='Hancom did not open the document. Close any Hancom alert, then try again.' ;;
        ko:hancom_export) format='한컴의 PDF 내보내기가 완료되지 않았습니다. 한컴의 저장 대화상자나 알림 창을 확인해 주세요.' ;; en:hancom_export) format='Hancom did not finish exporting the PDF. Check its save dialog or alerts.' ;;
        ko:hancom_close) format='한컴에서 변환용 문서 창을 닫지 못해 변환을 중단했습니다. 한컴의 알림 창을 확인해 주세요.' ;; en:hancom_close) format='Conversion stopped because Hancom did not close the private document window. Check Hancom for an alert.' ;;
        ko:hancom_activate) format='한컴의 변환용 문서를 활성화하지 못했습니다. 한컴의 창과 알림을 확인한 뒤 다시 실행해 주세요.' ;; en:hancom_activate) format='The private Hancom document could not be activated. Check its windows and alerts, then try again.' ;;
        ko:timeout) format='변환 앱의 응답을 기다리다 시간이 초과되었습니다. 앱의 알림 창을 확인한 뒤 다시 실행해 주세요.' ;; en:timeout) format='The conversion app did not respond in time. Check the app for an alert, then try again.' ;;
        ko:interrupted) format='한컴의 활성 문서나 앱이 바뀌어 변환을 중단했습니다. 다시 실행하는 동안 한컴을 조작하지 말아 주세요.' ;; en:interrupted) format='Conversion stopped because the active Hancom app or document changed. Try again without interacting with Hancom.' ;;
        ko:app_busy) format='변환용 문서가 이미 열려 있거나 확인 창이 떠 있습니다. 앱을 확인한 뒤 다시 실행해 주세요.' ;; en:app_busy) format='The conversion copy is already open or the app has a dialog. Check the app, then try again.' ;;
        ko:text_read) format='텍스트 파일을 읽을 수 없습니다.' ;; en:text_read) format='The text file could not be read.' ;;
        ko:text_size) format='텍스트 파일은 16 MiB까지만 변환할 수 있습니다.' ;; en:text_size) format='Text files must be 16 MiB or smaller.' ;;
        ko:utf32) format='UTF-32는 지원하지 않습니다. UTF-8로 저장해 주세요.' ;; en:utf32) format='UTF-32 is not supported. Save the file as UTF-8.' ;;
        ko:encoding) format='지원하는 텍스트 인코딩이 아니거나 바이트가 손상되었습니다. UTF-8 또는 BOM이 있는 UTF-16으로 저장해 주세요.' ;; en:encoding) format='The text encoding is unsupported or the bytes are damaged. Save as UTF-8 or UTF-16 with a BOM.' ;;
        ko:binary) format='텍스트에 지원하지 않는 제어 문자나 바이너리 데이터가 있습니다.' ;; en:binary) format='The text contains unsupported control characters or binary data.' ;;
        ko:pages) format='PDF가 2,000쪽을 넘어 변환을 중단했습니다. 파일을 나눠 주세요.' ;; en:pages) format='Conversion stopped because the PDF exceeds 2,000 pages. Split the file.' ;;
        ko:csv_quotes) format='CSV 따옴표 형식이 올바르지 않습니다. 닫는 따옴표와 필드 구분자를 확인해 주세요.' ;; en:csv_quotes) format='The CSV quoting is invalid. Check closing quotes and field separators.' ;;
        ko:csv_cells) format='CSV는 행당 1,024열, 전체 100,000셀까지만 변환할 수 있습니다. 파일을 나눠 주세요.' ;; en:csv_cells) format='CSV conversion supports up to 1,024 columns per row and 100,000 cells in total. Split the file.' ;;
        ko:csv_rows) format='CSV는 20,000행까지만 변환할 수 있습니다. 파일을 나눠 주세요.' ;; en:csv_rows) format='CSV conversion supports up to 20,000 rows. Split the file.' ;;
        ko:csv_field) format='CSV 셀 하나는 262,144자까지만 변환할 수 있습니다. 긴 셀을 나눠 주세요.' ;; en:csv_field) format='Each CSV cell supports up to 262,144 characters. Split long cells.' ;;
        ko:csv_display) format='CSV 표시 분량이 4 MiB를 넘습니다. 파일을 나눠 주세요.' ;; en:csv_display) format='The CSV display content exceeds 4 MiB. Split the file.' ;;
        ko:markdown_blocks) format='Markdown 블록 수가 변환 한도(20,000개)를 넘습니다.' ;; en:markdown_blocks) format='Markdown exceeds the conversion limit of 20,000 blocks.' ;;
        ko:markdown_size) format='Markdown 크기가 변환 한도(2,000,000자)를 넘습니다.' ;; en:markdown_size) format='Markdown exceeds the conversion limit of 2,000,000 characters.' ;;
        ko:markdown_lines) format='Markdown 줄 수가 변환 한도(50,000줄)를 넘습니다.' ;; en:markdown_lines) format='Markdown exceeds the conversion limit of 50,000 lines.' ;;
        ko:markdown_columns) format='Markdown 표는 32열까지 지원합니다.' ;; en:markdown_columns) format='Markdown tables support up to 32 columns.' ;;
        ko:markdown_rows) format='Markdown 표는 본문 5,000행까지 지원합니다.' ;; en:markdown_rows) format='Markdown tables support up to 5,000 body rows.' ;;
        ko:markdown_table) format='Markdown 표의 열 수가 머리글과 다릅니다.' ;; en:markdown_table) format='The Markdown table column count differs from its header.' ;;
        *) return 1 ;;
    esac
    printf "$format" "$@"
}

# Look up an exact app-owned RAW/image Error message after wrapper removal.
# The Korean catalog key is also the Korean output; each original is stored
# once. Return 1 for an unrecognized message without producing output.
fpdf_known_adapter_reason() {
    local message=$1 english
    case $message in
        '지원하지 않거나 불완전한 DNG 파일입니다.') english='The DNG file is unsupported or incomplete.' ;;
        '끝이 잘렸거나 잘못된 DNG 데이터입니다.') english='The DNG data is truncated or invalid.' ;;
        'DNG TIFF 헤더를 읽을 수 없습니다.') english='The DNG TIFF header could not be read.' ;;
        '일반 TIFF 기반 DNG만 지원합니다.') english='Only standard TIFF-based DNG files are supported.' ;;
        'DNG 이미지 구조가 순환하거나 너무 복잡합니다.') english='The DNG image structure is cyclic or too complex.' ;;
        'DNG 이미지 항목이 너무 많습니다.') english='The DNG has too many image entries.' ;;
        'DNG 이미지 항목이 중복되어 있습니다.') english='The DNG contains duplicate image entries.' ;;
        '지원하지 않는 DNG 이미지 항목입니다.') english='The DNG contains an unsupported image entry.' ;;
        '끝이 잘린 DNG 이미지 항목입니다.') english='The DNG contains a truncated image entry.' ;;
        '잘못된 DNG 이미지 항목 형식입니다.') english='A DNG image entry has an invalid type.' ;;
        '지원하지 않는 DNG 버전입니다.') english='This DNG version is not supported.' ;;
        '잘못되거나 너무 큰 DNG RAW 크기입니다.') english='The DNG RAW dimensions are invalid or too large.' ;;
        'DNG RAW 픽셀 데이터가 없습니다.') english='The DNG RAW pixel data is missing.' ;;
        '끝이 잘린 DNG RAW 픽셀 데이터입니다.') english='The DNG RAW pixel data is truncated.' ;;
        'DNG 하위 이미지가 너무 많습니다.') english='The DNG has too many sub-images.' ;;
        '단일 RAW 원본을 포함한 DNG 파일이 아닙니다.') english='The DNG does not contain exactly one RAW source image.' ;;
        'DNG 변환에는 절대 입력·출력 경로가 필요합니다.') english='DNG conversion requires absolute input and output paths.' ;;
        'DNG 원본을 출력 파일로 덮어쓸 수 없습니다.') english='The DNG source cannot be overwritten by the output file.' ;;
        '일반 DNG 파일만 변환할 수 있습니다.') english='Only regular DNG files can be converted.' ;;
        'DNG 파일은 512 MiB 이하여야 합니다.') english='DNG files must be 512 MiB or smaller.' ;;
        'DNG PDF 출력 파일이 이미 존재합니다.') english='The DNG PDF output file already exists.' ;;
        'DNG 파일을 읽을 수 없습니다.') english='The DNG file could not be read.' ;;
        'DNG RAW 형식으로 인식되지 않는 파일입니다.') english='The file was not recognized as DNG RAW.' ;;
        '이 DNG의 RAW 원본은 현재 macOS에서 지원하지 않습니다.') english='This DNG RAW image is not supported by the current macOS version.' ;;
        'DNG RAW 디코더를 사용할 수 없습니다.') english='The DNG RAW decoder is unavailable.' ;;
        '잘못된 DNG 이미지 방향입니다.') english='The DNG image orientation is invalid.' ;;
        'DNG RAW 원본을 처리할 수 없습니다.') english='The DNG RAW source image could not be processed.' ;;
        'DNG RAW 원본의 전체 유효 해상도를 확인할 수 없습니다.') english='The full valid resolution of the DNG RAW source image could not be verified.' ;;
        'DNG RAW 이미지 방향과 해상도가 일치하지 않습니다.') english='The DNG RAW orientation and resolution do not match.' ;;
        'DNG RAW 원본 전체를 sRGB 이미지로 변환할 수 없습니다.') english='The complete DNG RAW source image could not be converted to sRGB.' ;;
        'DNG 출력의 sRGB 색 공간을 확인할 수 없습니다.') english='The sRGB color space of the DNG output could not be verified.' ;;
        'DNG PDF 출력 파일을 만들 수 없습니다.') english='The DNG PDF output file could not be created.' ;;
        'DNG PDF의 단일 페이지를 확인할 수 없습니다.') english='The DNG PDF could not be verified as a single page.' ;;
        'DNG PDF 페이지 크기가 일치하지 않습니다.') english='The DNG PDF page dimensions do not match.' ;;
        '이미지 파일을 읽을 수 없습니다.') english='The image file could not be read.' ;;
        '끝이 잘린 JPEG 이미지입니다.') english='The JPEG image is truncated.' ;;
        '끝이 잘린 PNG 이미지입니다.') english='The PNG image is truncated.' ;;
        '끝이 잘린 HEIF 이미지입니다.') english='The HEIF image is truncated.' ;;
        '잘못되었거나 끝이 잘린 HEIF 이미지입니다.') english='The HEIF image is invalid or truncated.' ;;
        '잘못된 HEIF 형식 정보입니다.') english='The HEIF format information is invalid.' ;;
        '연속 HEIF 이미지는 지원하지 않습니다.') english='HEIF image sequences are not supported.' ;;
        'HEIF 형식 정보를 읽을 수 없습니다.') english='The HEIF format information could not be read.' ;;
        'HEIF 대표 이미지가 중복되어 있습니다.') english='The HEIF contains duplicate primary images.' ;;
        '이미지 변환에는 절대 입력·출력 경로가 필요합니다.') english='Image conversion requires absolute input and output paths.' ;;
        '이미지를 읽을 수 없습니다.') english='The image could not be read.' ;;
        '지원하는 PNG, JPEG 또는 HEIF 정지 이미지가 아닙니다.') english='This is not a supported PNG, JPEG, or HEIF still image.' ;;
        '단일 이미지 또는 HEIF 대표 이미지를 읽을 수 없습니다.') english='The single image or HEIF primary image could not be read.' ;;
        '손상되었거나 불완전한 이미지입니다.') english='The image is damaged or incomplete.' ;;
        '잘못된 이미지 방향입니다.') english='The image orientation is invalid.' ;;
        '이미지 크기를 읽을 수 없습니다.') english='The image dimensions could not be read.' ;;
        '잘못된 이미지 해상도입니다.') english='The image resolution is invalid.' ;;
        '이미지를 변환할 수 없습니다.') english='The image could not be converted.' ;;
        'PDF를 저장할 수 없습니다.') english='The PDF could not be saved.' ;;
        *) return 1 ;;
    esac
    if [[ ${fpdf_locale:-en} == ko ]]; then printf '%s' "$message"; else printf '%s' "$english"; fi
}

# Translate app-authored adapter reasons and common macOS error codes.
# Unrecognized OS/third-party diagnostics remain verbatim under a separate
# localized label; they are never machine-translated or interpreted as code.
fpdf_adapter_reason() {
    local diagnostic=$1 extension=$2 key='' message
    message=$diagnostic
    # osascript adds its own path/execution prefix and one or two Error labels.
    # Strip only that fixed wrapper and the standard JXA Error number; filenames
    # and unknown native diagnostics are retained verbatim in the fallback.
    case $message in *': execution error: '*) message=${message##*': execution error: '} ;; esac
    message=${message#'execution error: '}
    while [[ $message == 'Error: '* ]]; do message=${message#'Error: '}; done
    message=${message%' (-2700)'}
    if fpdf_known_adapter_reason "$message"; then return 0; fi
    case $diagnostic in
        *HANCOM_ACCESSIBILITY*|*'(-1719)'*|*'(-25211)'*) key=accessibility ;;
        *'(-1743)'*) key=automation ;;
        *'(-10814)'*|*'(-600)'*) key=app_missing ;;
        *HANCOM_INTERRUPTED*) key=interrupted ;;
        *HANCOM_BUSY*|*'이미 열려 있습니다.'*) key=app_busy ;;
        *HANCOM_OPEN_TIMEOUT*) key=hancom_open ;;
        *HANCOM_EXPORT_TIMEOUT*) key=hancom_export ;;
        *HANCOM_CLOSE_TIMEOUT*) key=hancom_close ;;
        *HANCOM_ACTIVATION_TIMEOUT*) key=hancom_activate ;;
        *'(-1712)'*) key=timeout ;;
        *HANCOM_OUTPUT_EXISTS*|*'출력 파일이 이미 존재합니다.'*|*'출력 경로에 파일이 이미 있습니다.'*) key=exists ;;
        *'변환 도우미가 없습니다.'*) key=missing_adapter ;;
        *'텍스트 파일을 읽을 수 없습니다.'*) key=text_read ;;
        *'텍스트 파일은 16 MiB'*) key=text_size ;;
        *'UTF-32는 지원하지 않습니다.'*) key=utf32 ;;
        *'지원하는 텍스트 인코딩이 아니거나'*) key=encoding ;;
        *'텍스트에 지원하지 않는 제어 문자'*) key=binary ;;
        *'PDF가 2,000쪽'*) key=pages ;;
        *CSV*'따옴표'*) key=csv_quotes ;;
        *'CSV는 행당 1,024열'*) key=csv_cells ;;
        *'CSV는 20,000행'*) key=csv_rows ;;
        *'CSV 셀 하나는 262,144자'*) key=csv_field ;;
        *'CSV 표시 분량이 4 MiB'*) key=csv_display ;;
        *'Markdown 블록 수가 변환 한도'*) key=markdown_blocks ;;
        *'Markdown 크기가 변환 한도'*) key=markdown_size ;;
        *'Markdown 줄 수가 변환 한도'*) key=markdown_lines ;;
        *'Markdown 표는 32열'*) key=markdown_columns ;;
        *'Markdown 표는 본문 5,000행'*) key=markdown_rows ;;
        *'Markdown 표의 열 수가 머리글'*) key=markdown_table ;;
        *'Excel 변환용 사본이 읽기 전용으로 열리지 않았습니다.'*) key=excel_readonly ;;
        *'PDF를 저장할 수 없습니다.'*|*'PDF 출력 파일을 만들 수 없습니다.'*|*'Excel에서 PDF 파일을 만들지 못했습니다.'*) key=invalid_pdf ;;
        *'절대 경로가 필요합니다.'*|*'절대 입력·출력 경로가 필요합니다.'*|*'변환에는 입력·출력 경로가 필요합니다.'*|*HANCOM_ARGUMENTS*|*'변환용 Word 문서를 찾을 수 없습니다.'*|*'변환용 PowerPoint 문서를 찾을 수 없습니다.'*|*'변환용 Excel 통합 문서를 찾을 수 없습니다.'*|*'Markdown 스타일'*|*'지원하지 않는 Markdown 블록입니다.'*|*'Markdown 입력은 문자열이어야 합니다.'*|*'텍스트 페이지를 나눌 수 없습니다.'*|*'TXT, MD 또는 CSV 파일만 텍스트로 변환할 수 있습니다.'*) key=app_error ;;
    esac
    if [[ -n $key ]]; then
        fpdf_text "$key"
    else
        fpdf_text app_error
        if [[ -n $diagnostic ]]; then printf '\n  '; fpdf_text details "$diagnostic"; fi
    fi
}
