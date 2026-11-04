#!/bin/bash
# Exercise the batch boundary with owned app adapters; no office app is opened.
# Requires the bundled valid single-page PDF fixture. A converter override lets
# the identical assertions reject a deliberately unsafe publication mutation.
# An optional second argument selects an image adapter for decoder mutations.
set -eu
# Bash 3.2 does not consistently apply errexit to [[ ... ]]; assertions must
# explicitly fail rather than allowing the next command to mask a bad result.
fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
converter=${1:-$here/../convert.sh}
image_adapter=${2:-$here/../image.js}
workspace=$(/usr/bin/mktemp -d /private/tmp/fpdf-check.XXXXXX)
trap '/bin/rm -r -- "$workspace"' EXIT
mkdir "$workspace/app" "$workspace/docs"
cp "$converter" "$workspace/app/convert.sh"
export FPDF_FIXTURE="$here/blank.pdf"
export FPDF_READY="$workspace/ready"
export FPDF_RACE_PATH="$workspace/docs/race.pdf"
cat > "$workspace/app/word.applescript" <<'APPLE'
-- Implement the owned adapter contract using deterministic local fixtures.
on run argv
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    if (system attribute "FPDF_ADAPTER_PATH_LOG") is not "" then
        do shell script "/usr/bin/printf '%s\\n' " & quoted form of inputPath & " >> " & quoted form of (system attribute "FPDF_ADAPTER_PATH_LOG")
    end if
    if inputPath ends with ".xlsx" then
        set permissionMode to do shell script "/usr/bin/stat -f %Lp " & quoted form of inputPath
        if permissionMode is not "400" then error "Excel private copy must be read-only"
        -- Simulate even a misbehaving app editing its own private copy.
        do shell script "/bin/chmod u+w " & quoted form of inputPath
    end if
    set mode to read (POSIX file inputPath)
    if mode starts with "FAIL" then error "deliberate adapter failure"
    if mode starts with "SLOW" then
        do shell script "/usr/bin/touch " & quoted form of (system attribute "FPDF_READY")
        delay 4
    end if
    if mode starts with "RACE" then
        do shell script "/usr/bin/printf sentinel > " & quoted form of (system attribute "FPDF_RACE_PATH")
    end if
    set handle to open for access (POSIX file inputPath) with write permission
    set eof handle to 0
    write "the application changed its private copy" to handle
    close access handle
    if mode starts with "INVALID" then
        do shell script "/usr/bin/printf '%%PDF-broken' > " & quoted form of outputPath
    else
        do shell script "/bin/cp " & quoted form of (system attribute "FPDF_FIXTURE") & " " & quoted form of outputPath
    end if
end run
APPLE
cp "$workspace/app/word.applescript" "$workspace/app/hancom.applescript"
cp "$workspace/app/word.applescript" "$workspace/app/powerpoint.applescript"
cp "$workspace/app/word.applescript" "$workspace/app/excel.applescript"
cat > "$workspace/app/image.js" <<'JAVASCRIPT'
ObjC.import('Foundation');
function run(argv) {
    const manager = $.NSFileManager.defaultManager;
    if (!manager.copyItemAtPathToPathError($(ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('FPDF_FIXTURE'))), $(argv[1]), null)) {
        throw Error('fixture copy failed');
    }
}
JAVASCRIPT
run="$workspace/app/convert.sh"
docs="$workspace/docs"
printf PASS > "$docs/good.docx"
printf PASS > "$docs/한글 ' 인용 \$ 문서.HWPX"
printf FAIL > "$docs/fail.hwp"
printf INVALID > "$docs/invalid.docx"
printf ignored > "$docs/plain.bin"
printf sentinel > "$docs/good.pdf"
originals=("$docs"/*)
before=$(/usr/bin/shasum -a 256 "${originals[@]}")
set +e
/bin/bash "$run" --no-dialog -- "$docs/good.docx" "$docs/한글 ' 인용 \$ 문서.HWPX" "$docs/fail.hwp" "$docs/invalid.docx" "$docs/plain.bin" "$docs/missing.docx" > "$workspace/mixed.txt"
status=$?
set -e
[[ $status == 1 ]] || fail 'mixed batch exit code'
[[ $(cat "$docs/good.pdf") == sentinel ]] || fail 'existing PDF overwritten'
[[ -s "$docs/한글 ' 인용 \$ 문서.pdf" ]] || fail 'Korean filename export missing'
[[ ! -e "$docs/invalid.pdf" && ! -e "$docs/fail.pdf" ]] || fail 'failed export published'
[[ $(/usr/bin/shasum -a 256 "${originals[@]}") == "$before" ]] || fail 'original file changed'
/usr/bin/grep -q '완료 1개 · 건너뜀 2개 · 실패 3개' "$workspace/mixed.txt"

# Mixed formats sharing a stem publish only the first output. Images do not
# depend on a PowerPoint container, even when HOME has no Office installation.
printf PASS > "$docs/shared.PNG"
printf PASS > "$docs/shared.JPG"
printf PASS > "$docs/photo.JPEG"
printf PASS > "$docs/phone.HEIC"
printf PASS > "$docs/photo2.HEIF"
mkdir "$workspace/empty-home"
HOME="$workspace/empty-home" /bin/bash "$run" --no-dialog -- "$docs/shared.PNG" "$docs/shared.JPG" "$docs/photo.JPEG" "$docs/phone.HEIC" "$docs/photo2.HEIF" > "$workspace/images.txt"
[[ -s "$docs/shared.pdf" && -s "$docs/photo.pdf" && -s "$docs/phone.pdf" && -s "$docs/photo2.pdf" ]] || fail 'image export missing'
/usr/bin/grep -q '완료 4개 · 건너뜀 1개 · 실패 0개' "$workspace/images.txt"

# A newline-ending directory must never resolve to its ordinary sibling.
ordinary_directory="$docs/selected"
newline_directory="$docs/"$'selected\n'
mkdir "$ordinary_directory" "$newline_directory"
printf 'PASS ordinary sibling' > "$ordinary_directory/file.PNG"
printf 'PASS selected newline directory' > "$newline_directory/file.PNG"
newline_before=$(/usr/bin/shasum -a 256 "$ordinary_directory/file.PNG" "$newline_directory/file.PNG")
/bin/bash "$run" --no-dialog -- "$newline_directory/file.PNG" > "$workspace/newline.txt"
[[ -s "$newline_directory/file.pdf" && ! -e "$ordinary_directory/file.pdf" ]] || fail 'newline directory resolved to sibling'
[[ $(/usr/bin/shasum -a 256 "$ordinary_directory/file.PNG" "$newline_directory/file.PNG") == "$newline_before" ]] || fail 'newline directory originals changed'

# The PowerPoint adapter receives a private copy in its own container.
if [[ -d "$HOME/Library/Containers/com.microsoft.Powerpoint/Data/tmp" ]]; then
    printf PASS > "$docs/slides.PPTX"
    expected=$(/usr/bin/shasum -a 256 "$docs/slides.PPTX")
    /bin/bash "$run" --no-dialog -- "$docs/slides.PPTX" > "$workspace/ppt.txt"
    [[ -s "$docs/slides.pdf" ]] || fail 'PowerPoint export missing'
    [[ $(/usr/bin/shasum -a 256 "$docs/slides.PPTX") == "$expected" ]] || fail 'PowerPoint original changed'
fi

# A missing Office container uses a stable per-app cache folder, so a native
# folder grant can cover repeated batches. Cleanup owns only random file pairs.
fallback_root="$workspace/empty-home/Library/Caches/FinderPDFConverter/OfficeExports"
mkdir -p "$fallback_root/Excel"
printf sentinel > "$fallback_root/Excel/keep.xlsx"
for batch in 1 2; do
    printf PASS > "$docs/fallback-word-$batch.docx"
    printf PASS > "$docs/fallback-slides-$batch.pptx"
    printf PASS > "$docs/fallback-sheets-$batch.XLSX"
    HOME="$workspace/empty-home" FPDF_ADAPTER_PATH_LOG="$workspace/fallback-paths.txt" /bin/bash "$run" --no-dialog -- "$docs/fallback-word-$batch.docx" "$docs/fallback-slides-$batch.pptx" "$docs/fallback-sheets-$batch.XLSX" > "$workspace/fallback-$batch.txt"
    [[ -s "$docs/fallback-word-$batch.pdf" && -s "$docs/fallback-slides-$batch.pdf" && -s "$docs/fallback-sheets-$batch.pdf" ]] || fail 'Office cache fallback export missing'
    [[ $(cat "$docs/fallback-word-$batch.docx") == PASS && $(cat "$docs/fallback-slides-$batch.pptx") == PASS && $(cat "$docs/fallback-sheets-$batch.XLSX") == PASS ]] || fail 'Office cache fallback changed original'
done
[[ $(/usr/bin/wc -l < "$workspace/fallback-paths.txt") -eq 6 ]] || fail 'Office fallback adapter calls missing'
while IFS= read -r private_path; do
    case $private_path in
        "$fallback_root/Word/fpdf."*.docx|"$fallback_root/PowerPoint/fpdf."*.pptx|"$fallback_root/Excel/fpdf."*.xlsx) ;;
        *) fail 'Office fallback did not use stable private folder' ;;
    esac
    [[ ! -e $private_path && ! -e ${private_path%.*}.pdf && ! -e ${private_path%.*} ]] || fail 'Office cache fallback leaked owned file'
done < "$workspace/fallback-paths.txt"

[[ $(cat "$fallback_root/Excel/keep.xlsx") == sentinel && $(/bin/ls -A "$fallback_root/Excel") == keep.xlsx ]] || fail 'Excel fallback cleanup removed unrelated contents'

# Excel uses its available native container and removes only the private job.
excel_container="$workspace/container-home/Library/Containers/com.microsoft.Excel/Data/tmp"
mkdir -p "$excel_container"
printf sentinel > "$excel_container/unrelated.xlsx"
printf PASS > "$docs/container-sheets.xlsx"
HOME="$workspace/container-home" FPDF_ADAPTER_PATH_LOG="$workspace/container-path.txt" /bin/bash "$run" --no-dialog -- "$docs/container-sheets.xlsx" > "$workspace/container.txt"
[[ -s "$docs/container-sheets.pdf" && $(cat "$docs/container-sheets.xlsx") == PASS ]] || fail 'Excel container export changed source or failed'
private_path=$(cat "$workspace/container-path.txt")
case $private_path in "$excel_container"/fpdf.*/*.xlsx) ;; *) fail 'Excel native container not used';; esac
[[ ! -e ${private_path%/*} && $(cat "$excel_container/unrelated.xlsx") == sentinel ]] || fail 'Excel private-container cleanup escaped ownership'

# An Excel fallback symlink cannot redirect private input/output elsewhere.
mkdir -p "$workspace/redirected-home/Library/Caches/FinderPDFConverter/OfficeExports" "$workspace/outside-excel"
printf sentinel > "$workspace/outside-excel/keep"
ln -s "$workspace/outside-excel" "$workspace/redirected-home/Library/Caches/FinderPDFConverter/OfficeExports/Excel"
printf PASS > "$docs/symlink-cache.xlsx"
set +e
HOME="$workspace/redirected-home" /bin/bash "$run" --no-dialog -- "$docs/symlink-cache.xlsx" > "$workspace/cache-link.txt"
status=$?
set -e
[[ $status == 1 && ! -e "$docs/symlink-cache.pdf" && $(cat "$workspace/outside-excel/keep") == sentinel && $(/bin/ls -A "$workspace/outside-excel") == keep ]] || fail 'Excel symlink cache accepted or changed external files'

# Symlinks are never opened, and every occupied output path is preserved.
ln -s "$docs/good.docx" "$docs/input-link.docx"
printf PASS > "$docs/directory.docx"
mkdir "$docs/directory.pdf"
printf PASS > "$docs/broken-link.docx"
ln -s "$docs/absent-target" "$docs/broken-link.pdf"
set +e
/bin/bash "$run" --no-dialog -- "$docs/input-link.docx" "$docs/directory.docx" "$docs/broken-link.docx" > "$workspace/paths.txt"
status=$?
set -e
[[ $status == 1 ]] || fail 'symlink input accepted'
[[ -d "$docs/directory.pdf" && -L "$docs/broken-link.pdf" ]] || fail 'occupied output changed'
[[ ! -e "$docs/input-link.pdf" ]] || fail 'symlink input exported'
/usr/bin/grep -q '완료 0개 · 건너뜀 2개 · 실패 1개' "$workspace/paths.txt"

# A competing writer must win without being overwritten after initial checks.
printf RACE > "$docs/race.docx"
/bin/bash "$run" --no-dialog -- "$docs/race.docx" > "$workspace/race.txt"
[[ $(cat "$docs/race.pdf") == sentinel ]] || fail 'racing writer overwritten'
/usr/bin/grep -q '완료 0개 · 건너뜀 1개 · 실패 0개' "$workspace/race.txt"

# Generated path variations preserve the input bytes even if an app edits copies.
RANDOM=1731
for index in 1 2 3 4 5 6; do
    source="$docs/문서 $RANDOM [${index}] ' \$.docx"
    printf 'PASS input %s' "$index" > "$source"
    expected=$(/usr/bin/shasum -a 256 "$source")
    /bin/bash "$run" --no-dialog -- "$source" > /dev/null
    [[ -s ${source%.docx}.pdf ]] || fail 'generated filename export missing'
    [[ $(/usr/bin/shasum -a 256 "$source") == "$expected" ]] || fail 'generated filename original changed'
done

# A live conversion excludes every other batch so app UI commands cannot mix.
printf SLOW > "$docs/slow.docx"
/bin/bash "$run" --no-dialog -- "$docs/slow.docx" > "$workspace/slow.txt" &
first=$!
for ((attempt=0; attempt<50; attempt++)); do
    [[ ! -e $FPDF_READY ]] || break
    /bin/sleep 0.1
done
[[ -e $FPDF_READY ]] || fail 'slow adapter did not start'
set +e
/bin/bash "$run" --no-dialog -- "$docs/good.docx" > "$workspace/busy.txt"
status=$?
set -e
[[ $status == 2 ]] || fail 'concurrent converter accepted'
wait "$first"
[[ -s "$docs/slow.pdf" ]] || fail 'slow export missing'
[[ -z $(/usr/bin/find "$docs" -name '.finder-pdf.*' -print) ]] || fail 'staging file leaked'

# Use the real ImageIO encoder/decoder and PDFKit renderer for HEIF contracts.
# Generated colors pin EXIF orientation, DPI/page geometry, and a nonzero
# primary index; sequence and seeded truncation cases must publish nothing.
cp "$image_adapter" "$workspace/app/image.js"
mkdir "$workspace/heif"
/usr/bin/osascript -l JavaScript - "$workspace/heif" <<'JAVASCRIPT' >/dev/null
ObjC.import('AppKit');
ObjC.import('CoreImage');
ObjC.import('ImageIO');
/** Encode a native still/collection/sequence with controlled primary metadata. */
function writeImage(path, type, first, second, primarySecond) {
    const destination = $.CGImageDestinationCreateWithURL($.NSURL.fileURLWithPath(path), $(type), second ? 2 : 1, null);
    if (!destination) throw Error('HEIF encoder is unavailable');
    $.CGImageDestinationAddImage(destination, first, $({Orientation:6,DPIWidth:144,DPIHeight:144}));
    if (second) $.CGImageDestinationAddImage(destination, second, $({Orientation:1,PrimaryImage:primarySecond}));
    if (!$.CGImageDestinationFinalize(destination)) throw Error('HEIF fixture encoding failed');
}
/** Generate asymmetric colors, a primary-index-one collection, and bad inputs. */
function run(argv) {
    const context = $.CIContext.contextWithOptions($.NSDictionary.dictionary);
    const red = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlueAlpha(1,0,0,1)).imageByCroppingToRect($.CGRectMake(0,0,240,160));
    const blue = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlueAlpha(0,0,1,1)).imageByCroppingToRect($.CGRectMake(120,0,120,160));
    const green = $.CIImage.imageWithColor($.CIColor.colorWithRedGreenBlueAlpha(0,1,0,1)).imageByCroppingToRect($.CGRectMake(0,0,240,160));
    const image = blue.imageByCompositingOverImage(red);
    const raster = context.createCGImageFromRect(image, image.extent);
    const second = context.createCGImageFromRect(green, green.extent);
    writeImage(argv[0] + '/oriented.HEIC', 'public.heic', raster, null, false);
    writeImage(argv[0] + '/primary.heif', 'public.heic', raster, second, true);
    writeImage(argv[0] + '/sequence.heic', 'public.heics', raster, second, false);
    const collection = $.CGImageSourceCreateWithURL($.NSURL.fileURLWithPath(argv[0] + '/primary.heif'), null);
    const primaryMetadata = ObjC.deepUnwrap(ObjC.castRefToObject($.CGImageSourceCopyPropertiesAtIndex(collection, 1, null)));
    if (Number($.CGImageSourceGetCount(collection)) !== 2 || primaryMetadata.PrimaryImage !== true) throw Error('primary fixture is not representative');
    const data = $.NSData.dataWithContentsOfFile(argv[0] + '/oriented.HEIC');
    const size = Number(data.length);
    let seed = 1731;
    for (let index = 0; index < 6; index++) {
        seed = (seed * 48271) % 2147483647;
        const length = index === 0 ? size - 1 : 1 + seed % (size - 1);
        if (!data.subdataWithRange($.NSMakeRange(0, length)).writeToFileAtomically(argv[0] + '/truncated-' + index + '.heic', true)) throw Error('truncation fixture write failed');
    }
    if (!$('not a photograph').writeToFileAtomicallyEncodingError(argv[0] + '/invalid.heif', true, $.NSUTF8StringEncoding, null)) throw Error('invalid fixture write failed');
}
JAVASCRIPT
heif_before=$(/usr/bin/shasum -a 256 "$workspace/heif"/*)
set +e
HOME="$workspace/empty-home" /bin/bash "$run" --no-dialog -- "$workspace/heif"/* > "$workspace/heif.txt"
status=$?
set -e
[[ $status == 1 ]] || fail 'HEIF bad-input batch exit code'
[[ -s "$workspace/heif/oriented.pdf" && -s "$workspace/heif/primary.pdf" ]] || fail 'native HEIF export missing'
[[ $(/usr/bin/find "$workspace/heif" -name '*.pdf' | /usr/bin/wc -l | /usr/bin/tr -d ' ') == 2 ]] || fail 'unsupported or truncated HEIF published'
/usr/bin/grep -q '완료 2개 · 건너뜀 0개 · 실패 8개' "$workspace/heif.txt"
[[ $(/usr/bin/shasum -a 256 "$workspace/heif"/*.heic "$workspace/heif"/*.heif "$workspace/heif"/*.HEIC | /usr/bin/sort) == $(printf '%s\n' "$heif_before" | /usr/bin/sort) ]] || fail 'HEIF original changed'
/usr/bin/osascript -l JavaScript - "$workspace/heif" <<'JAVASCRIPT' >/dev/null
ObjC.import('AppKit');
ObjC.import('PDFKit');
/** Read a rendered PDF pixel in device RGB coordinates. */
function color(bitmap, fraction) {
    const pixel = bitmap.colorAtXY(Number(bitmap.pixelsWide) / 2, Number(bitmap.pixelsHigh) * fraction).colorUsingColorSpace($.NSColorSpace.deviceRGBColorSpace);
    return [Number(pixel.redComponent), Number(pixel.greenComponent), Number(pixel.blueComponent)];
}
/** Open and render a one-page PDF, asserting independently specified dimensions. */
function rendered(path, width, height) {
    const document = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(path));
    if (!document || Number(document.pageCount) !== 1) throw Error('HEIF export must have one page');
    const page = document.pageAtIndex(0);
    const rect = page.boundsForBox(0);
    if (Math.abs(rect.size.width - width) > 0.01 || Math.abs(rect.size.height - height) > 0.01) throw Error('HEIF orientation or DPI geometry changed');
    const image = page.thumbnailOfSizeForBox($.NSMakeSize(width, height), 0);
    return $.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
}
/** Verify orientation using colored halves and primary selection using green. */
function run(argv) {
    const oriented = rendered(argv[0] + '/oriented.pdf', 80, 120);
    const top = color(oriented, 0.25);
    const bottom = color(oriented, 0.75);
    if (!(top[0] > 0.8 && top[2] < 0.4 && bottom[2] > 0.8 && bottom[0] < 0.4)) throw Error('HEIF rotation pixels are wrong');
    const primary = color(rendered(argv[0] + '/primary.pdf', 240, 160), 0.25);
    if (!(primary[1] > 0.8 && primary[0] < 0.65 && primary[2] < 0.6)) throw Error('HEIF declared primary image was not selected');
}
JAVASCRIPT
printf '%s\n' 'PASS: mixed results, private-copy edits, generated paths, PDF parsing, existing/racing destination preservation, Office stable-cache fallback, serialization, staging cleanup'
printf '%s\n' 'PASS: native HEIC/HEIF, orientation pixels, DPI/page size, declared primary image, unchanged originals, sequence/truncated-input rejection'
