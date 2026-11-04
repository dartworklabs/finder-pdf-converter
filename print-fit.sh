#!/bin/bash
# Prepare an entire selected batch in private snapshots, then open one native
# print panel. Public surface: [--no-dialog] [--proof NEW.pdf] [--] FILE...
# Exit 0 = print operation accepted/proof saved/cancelled, 1 = preparation or
# rendering failure, 2 = usage/setup failure. Proof mode never submits a job.
set -u
umask 077
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
script_dir=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd) || exit 2
if [[ ! -r $script_dir/locale.sh ]]; then
    printf '%s\n' 'The PDF converter is incomplete. Reinstall the Quick Actions.' >&2
    exit 2
fi
. "$script_dir/locale.sh"
fpdf_locale=$(fpdf_language "$script_dir/preferred-language.js")
show_dialog=1
proof=''
work_dir=''
stage_file=''

# Translate this action's boundary messages without interpreting file names.
fit_text() {
    local key=$1 format
    shift
    case "${fpdf_locale:-en}:$key" in
        ko:title) format='용지에 맞춰 인쇄' ;; en:title) format='Print to Fit' ;;
        ko:usage) format='인쇄할 파일을 선택해 주세요. 사용법: print-fit.sh [--no-dialog] [--proof 새파일.pdf] -- 파일...' ;;
        en:usage) format='Select files to print. Usage: print-fit.sh [--no-dialog] [--proof NEW.pdf] -- FILE...' ;;
        ko:missing) format='인쇄 도우미가 없습니다. 빠른 동작을 다시 설치해 주세요.' ;;
        en:missing) format='A print helper is missing. Reinstall the Quick Actions.' ;;
        ko:stopped) format='인쇄 작업을 만들지 않았습니다. 선택한 파일을 모두 준비하지 못했습니다.' ;;
        en:stopped) format='No print job was created. Not all selected files could be prepared.' ;;
        ko:renderer) format='인쇄 또는 검토용 PDF 생성을 완료하지 못했습니다.' ;;
        en:renderer) format='Printing or proof PDF creation could not be completed.' ;;
        ko:proof) format='검토용 PDF는 쓰기 가능한 폴더의 새 파일 이름으로 지정해 주세요. 기존 파일은 덮어쓰지 않습니다.' ;;
        en:proof) format='Choose a new proof PDF name in a writable folder. Existing files are never replaced.' ;;
        *) return 1 ;;
    esac
    printf "$format" "$@"
}

# Report the same UTF-8 message to stderr and Finder; proof/CLI can suppress UI.
fit_report() {
    local message=$1 title button dialog_script
    printf '%s\n' "$message" >&2
    [[ $show_dialog == 1 ]] || return 0
    title=$(fit_text title)
    button=$(fpdf_text ok)
    dialog_script="use framework \"Foundation\"
use scripting additions
on run argv
set inputData to current application's NSFileHandle's fileHandleWithStandardInput()'s readDataToEndOfFile()
set message to (current application's NSString's alloc()'s initWithData:inputData encoding:(current application's NSUTF8StringEncoding)) as text
display dialog message with title (item 1 of argv) buttons {(item 2 of argv)} default button (item 2 of argv)
end run"
    printf '%s' "$message" | /usr/bin/osascript -e "$dialog_script" "$title" "$button" >/dev/null 2>&1 || true
}

# Remove only the unique workspace this invocation created, also after signals.
fit_cleanup() {
    [[ -z $stage_file ]] || /bin/rm -f -- "$stage_file"
    [[ -z $work_dir ]] || /bin/rm -r -- "$work_dir"
}
trap fit_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-dialog) show_dialog=0; shift ;;
        --proof)
            show_dialog=0
            if [[ $# -lt 2 || -n $proof || -z $2 || $2 == --* ]]; then
                fit_report "$(fit_text usage)"; exit 2
            fi
            proof=$2; shift 2 ;;
        --) shift; break ;;
        -*) fit_report "$(fit_text usage)"; exit 2 ;;
        *) break ;;
    esac
done
if [[ $# == 0 ]]; then fit_report "$(fit_text usage)"; exit 2; fi
if [[ ! -r $script_dir/print-fit.js || ! -r $script_dir/convert.sh ]]; then
    fit_report "$(fit_text missing)"; exit 2
fi

# Reject the full batch before any conversion starts. Symlink selections and
# folders never become converter input; resolve parents without losing newlines.
sources=()
names=()
extensions=()
for selected in "$@"; do
    name=${selected##*/}
    if [[ -L $selected || ! -f $selected || ! -r $selected ]]; then
        fit_report "$(fit_text stopped)"$'\n'"$(fpdf_text failed "$name" "$(fpdf_text not_readable)")"; exit 1
    fi
    ext=$(printf '%s' "${name##*.}" | /usr/bin/tr '[:upper:]' '[:lower:]')
    case $ext in
        pdf|hwp|hwpx|docx|pptx|xlsx|csv|png|jpg|jpeg|heic|heif|dng|txt|md|markdown) ;;
        *) fit_report "$(fit_text stopped)"$'\n'"$(fpdf_text failed "$name" "$(fpdf_text unsupported)")"; exit 1 ;;
    esac
    case $selected in
        */*) parent=${selected%/*}; [[ -n $parent ]] || parent=/ ;;
        *) parent=. ;;
    esac
    directory=$(CDPATH='' cd -P -- "$parent" && printf '%s.' "$PWD") || {
        fit_report "$(fit_text stopped)"$'\n'"$(fpdf_text failed "$name" "$(fpdf_text source_folder)")"; exit 1
    }
    sources+=("${directory%.}/$name")
    names+=("$name")
    extensions+=("$ext")
done

# Proofs are new, explicit local artifacts. Normalize relative paths before the
# native boundary and reject occupied names (including dangling symlinks).
if [[ -n $proof ]]; then
    case $proof in
        */*) parent=${proof%/*}; [[ -n $parent ]] || parent=/ ;;
        *) parent=. ;;
    esac
    name=${proof##*/}
    directory=$(CDPATH='' cd -P -- "$parent" && printf '%s.' "$PWD") || directory=''
    if [[ -z $directory || -z $name || ! -w ${directory%.} || -e $proof || -L $proof ]]; then
        fit_report "$(fit_text proof)"; exit 2
    fi
    proof="${directory%.}/$name"
fi
work_dir=$(/usr/bin/mktemp -d /private/tmp/fpdf-print.XXXXXX) || {
    fit_report "$(fpdf_text work_folder)"; exit 2
}

# Every source, including PDFs, has an owned stable snapshot. Separate folders
# preserve names and order even when documents share a basename or extension.
pdfs=()
conversion_inputs=()
for ((index=0; index<${#sources[@]}; index++)); do
    source=${sources[$index]}
    name=${names[$index]}
    directory="$work_dir/$index"
    copy="$directory/$name"
    if [[ -L $source || ! -f $source || ! -r $source ]] ||
       ! /bin/mkdir -- "$directory" || ! /bin/cp -P -- "$source" "$copy" ||
       [[ -L $copy || ! -f $copy || ! -r $copy || ! -O $copy ]]; then
        fit_report "$(fit_text stopped)"$'\n'"$(fpdf_text failed "$name" "$(fpdf_text copy)")"; exit 1
    fi
    if [[ ${extensions[$index]} == pdf ]]; then
        pdfs+=("$copy")
    else
        conversion_inputs+=("$copy")
        pdfs+=("$directory/${name%.*}.pdf")
    fi
done

# The converter writes only beside snapshots. Never consult an adjacent PDF at
# the original location, even when it already exists or the export fails.
if [[ ${#conversion_inputs[@]} -gt 0 ]]; then
    if ! /bin/bash "$script_dir/convert.sh" --no-dialog -- "${conversion_inputs[@]}" >"$work_dir/conversion.log" 2>&1; then
        fit_report "$(fit_text stopped)"$'\n'"$(cat "$work_dir/conversion.log")"; exit 1
    fi
fi
for ((index=0; index<${#pdfs[@]}; index++)); do
    pdf=${pdfs[$index]}
    if [[ -L $pdf || ! -f $pdf || ! -s $pdf || ! -O $pdf ]]; then
        fit_report "$(fit_text stopped)"$'\n'"$(fpdf_text failed "${names[$index]}" "$(fpdf_text invalid_pdf)")"; exit 1
    fi
done

# The native renderer validates all PDFs before its single print panel. A proof
# uses exactly that renderer with submission disabled. Cancel is a quiet success.
renderer_args=(-l JavaScript "$script_dir/print-fit.js")
if [[ -n $proof ]]; then renderer_args+=(--proof "$work_dir/proof.pdf"); fi
if ! /usr/bin/osascript "${renderer_args[@]}" -- "${pdfs[@]}" >"$work_dir/renderer.log" 2>&1; then
    fit_report "$(fit_text renderer)"$'\n'"$(fpdf_text details "$(cat "$work_dir/renderer.log")")"; exit 1
fi

# Reserve a file on the destination filesystem, then publish exclusively. The
# requested name is never handed to NSPrintSaveJob, which could overwrite a
# competing writer between its existence check and save.
if [[ -n $proof ]]; then
    if [[ ! -f $work_dir/proof.pdf || -L $work_dir/proof.pdf || ! -s $work_dir/proof.pdf ]]; then
        fit_report "$(fit_text renderer)"; exit 1
    fi
    stage_file=$(/usr/bin/mktemp "${proof%/*}/.fpdf-proof.XXXXXX") || {
        fit_report "$(fit_text proof)"; exit 1
    }
    if ! /bin/cp -- "$work_dir/proof.pdf" "$stage_file"; then
        fit_report "$(fit_text proof)"; exit 1
    fi
    if ! /usr/bin/osascript -l JavaScript - "$stage_file" "$proof" <<'JXA' >/dev/null 2>&1
ObjC.import('Foundation');
ObjC.bindFunction('renamex_np', ['int', ['string', 'string', 'uint32_t']]);
/** Publish an already rendered proof without replacing any competing name. */
function run(argv) {
    if ($.renamex_np(argv[0], argv[1], 4) !== 0) throw Error('Exclusive proof publication failed');
}
JXA
    then
        fit_report "$(fit_text proof)"; exit 1
    fi
    stage_file=''
fi
