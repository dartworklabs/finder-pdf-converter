#!/bin/bash
# Convert selected documents through private copies and publish validated PDFs
# beside the originals without replacement. Public surface: [--no-dialog] [--]
# FILE...; exit 0 = success/skip, 1 = per-file failure, 2 = setup/busy.
set -u
umask 077
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH

show_dialog=1
if [[ ${1-} == --no-dialog ]]; then show_dialog=0; shift; fi
if [[ ${1-} == -- ]]; then shift; fi
script_dir=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd) || exit 2
if [[ ! -r $script_dir/locale.sh ]]; then
    printf '%s\n' 'The PDF converter is incomplete. Reinstall the Quick Action.' >&2
    exit 2
fi
. "$script_dir/locale.sh"
fpdf_locale=$(fpdf_language "$script_dir/preferred-language.js")
work_dir=''
word_work_dir=''
powerpoint_work_dir=''
excel_work_dir=''
word_flat_workspace=0
powerpoint_flat_workspace=0
excel_flat_workspace=0
office_files=()
stage_file=''
lock_file=''
lock_held=0
summary=''
succeeded=0
skipped=0
failed=0

# Remove only this invocation's private files and owned lock, also on signals.
cleanup() {
    [[ -z $stage_file ]] || /bin/rm -- "$stage_file"
    [[ -z $work_dir ]] || /bin/rm -r -- "$work_dir"
    [[ -z $word_work_dir || $word_flat_workspace == 1 ]] || /bin/rm -r -- "$word_work_dir"
    [[ -z $powerpoint_work_dir || $powerpoint_flat_workspace == 1 ]] || /bin/rm -r -- "$powerpoint_work_dir"
    [[ -z $excel_work_dir || $excel_flat_workspace == 1 ]] || /bin/rm -r -- "$excel_work_dir"
    if [[ ${#office_files[@]} -gt 0 ]]; then /bin/rm -f -- "${office_files[@]}"; fi
    if [[ $lock_held == 1 ]]; then /bin/rm -- "$lock_file"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# Record a human-readable per-file result without interpreting names as code.
record() {
    summary+="$1"$'\n'
}

# Print one summary and display that same text once for Finder. A UI failure
# leaves the printed summary available to the calling Quick Action.
report() {
    local message=$1 dialog_script title button
    title=$(fpdf_text title)
    button=$(fpdf_text ok)
    printf '%s\n' "$message"
    if [[ $show_dialog == 1 ]]; then
        # Summary text can exceed macOS ARG_MAX after a large failed batch.
        # Stream UTF-8 data separately from the fixed, trusted dialog script.
        dialog_script="use framework \"Foundation\"
use scripting additions
on run argv
set inputData to current application's NSFileHandle's fileHandleWithStandardInput()'s readDataToEndOfFile()
set message to (current application's NSString's alloc()'s initWithData:inputData encoding:(current application's NSUTF8StringEncoding)) as text
display dialog message with title (item 1 of argv) buttons {(item 2 of argv)} default button (item 2 of argv)
end run"
        printf '%s' "$message" | /usr/bin/osascript -e "$dialog_script" "$title" "$button" >/dev/null 2>&1 || true
    fi
}

# Require a PDF signature and a successful PDFKit parse with at least one page.
# A signature alone does not establish that an app completed its export.
validate_pdf() {
    [[ -f $1 && -s $1 && ! -L $1 ]] || return 1
    [[ $(/usr/bin/head -c 5 -- "$1") == '%PDF-' ]] || return 1
    /usr/bin/osascript -l JavaScript - "$1" <<'JAVASCRIPT' >/dev/null 2>&1
ObjC.import('Foundation');
ObjC.import('PDFKit');
function run(argv) {
    const pdf = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
    if (!pdf || pdf.isNil() || pdf.isLocked || Number(pdf.pageCount) < 1) {
        throw Error('PDF could not be opened or has no pages');
    }
}
JAVASCRIPT
}

# Atomically move a staged PDF into an unoccupied name on the same filesystem.
# RENAME_EXCL fails if another writer has already created the destination.
publish_pdf() {
    /usr/bin/osascript -l JavaScript - "$1" "$2" <<'JAVASCRIPT' >/dev/null 2>&1
ObjC.import('Foundation');
ObjC.bindFunction('renamex_np', ['int', ['string', 'string', 'uint32_t']]);
function run(argv) {
    if ($.renamex_np(argv[0], argv[1], 4) !== 0) throw Error('publish failed');
}
JAVASCRIPT
}

if [[ $# == 0 ]]; then
    report "$(fpdf_text no_input)"
    exit 2
fi

# shlock creates the lock atomically and checks stale PIDs. The private per-user
# cache directory prevents another account from replacing the lock's parent.
cache_dir=$(/usr/bin/getconf DARWIN_USER_CACHE_DIR) || cache_dir=''
lock_dir="${cache_dir%/}/finder-pdf-converter"
if [[ -z $cache_dir ]] || ! /bin/mkdir -p -- "$lock_dir" || [[ -L $lock_dir || ! -O $lock_dir ]]; then
    report "$(fpdf_text lock_folder)"
    exit 2
fi
/bin/chmod 700 "$lock_dir" || exit 2
lock_file="$lock_dir/batch.lock"
if ! /usr/bin/shlock -p $$ -f "$lock_file"; then
    report "$(fpdf_text busy)"
    exit 2
fi
lock_held=1
work_dir=$(/usr/bin/mktemp -d /private/tmp/fpdf.XXXXXX) || {
    report "$(fpdf_text work_folder)"
    exit 2
}

# Retain a stable Office folder so its native access grant can cover later jobs.
# Only caller-owned random files are removed; unrelated contents stay untouched.
office_cache_folder() {
    local application=$1 folder export_root
    # User Library/Caches is selectable in Office's native folder-grant UI.
    export_root="$HOME/Library/Caches/FinderPDFConverter"
    for folder in "$export_root" "$export_root/OfficeExports" "$export_root/OfficeExports/$application"; do
        [[ ! -L $folder ]] || return 1
        /bin/mkdir -p -- "$folder" || return 1
        [[ -d $folder && -O $folder ]] || return 1
        /bin/chmod 700 "$folder" || return 1
    done
    folder=$(CDPATH='' cd -P -- "$folder" && printf '%s.' "$PWD") || return 1
    printf '%s' "${folder%.}"
}

# Reuse each app's private container or stable, separately granted cache folder.
# Only fixed app identifiers from the extension dispatch reach this helper.
prepare_office_workspace() {
    local application=$1 container=$2 temp_base
    case $application in
        Word) app_work_dir=$word_work_dir; flat_workspace=$word_flat_workspace ;;
        PowerPoint) app_work_dir=$powerpoint_work_dir; flat_workspace=$powerpoint_flat_workspace ;;
        Excel) app_work_dir=$excel_work_dir; flat_workspace=$excel_flat_workspace ;;
        *) return 1 ;;
    esac
    if [[ -z $app_work_dir ]]; then
        flat_workspace=0
        temp_base="$HOME/Library/Containers/$container/Data/tmp"
        if [[ -d $temp_base && -O $temp_base ]]; then
            app_work_dir=$(/usr/bin/mktemp -d "$temp_base/fpdf.XXXXXX" 2>/dev/null) || app_work_dir=''
        fi
        if [[ -z $app_work_dir ]]; then
            app_work_dir=$(office_cache_folder "$application") || app_work_dir=''
            flat_workspace=1
        fi
        [[ -n $app_work_dir ]] || return 1
        case $application in
            Word) word_work_dir=$app_work_dir; word_flat_workspace=$flat_workspace ;;
            PowerPoint) powerpoint_work_dir=$app_work_dir; powerpoint_flat_workspace=$flat_workspace ;;
            Excel) excel_work_dir=$app_work_dir; excel_flat_workspace=$flat_workspace ;;
        esac
    fi
}

index=0
for selected in "$@"; do
    index=$((index + 1))
    name=${selected##*/}
    if [[ -L $selected || ! -f $selected || ! -r $selected ]]; then
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text not_readable)")"
        continue
    fi
    ext=$(printf '%s' "${name##*.}" | /usr/bin/tr '[:upper:]' '[:lower:]')
    case $ext in
        hwp|hwpx) adapter=hancom.applescript ;;
        docx) adapter=word.applescript ;;
        pptx) adapter=powerpoint.applescript ;;
        xlsx) adapter=excel.applescript ;;
        csv) adapter=text.js ;;
        png|jpg|jpeg|heic|heif) adapter=image.js ;;
        dng) adapter=dng.js ;;
        txt|md|markdown) adapter=text.js ;;
        *) skipped=$((skipped + 1)); record "$(fpdf_text skipped "$name" "$(fpdf_text unsupported)")"; continue ;;
    esac
    # Parameter expansion and a sentinel preserve trailing newlines, which
    # command substitution would otherwise strip from dirname/pwd output.
    case $selected in
        */*) selected_directory=${selected%/*}; [[ -n $selected_directory ]] || selected_directory=/ ;;
        *) selected_directory=. ;;
    esac
    directory=$(CDPATH='' cd -P -- "$selected_directory" && printf '%s.' "$PWD") || {
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text source_folder)")"; continue
    }
    directory=${directory%.}
    input="$directory/$name"
    output="$directory/${name%.*}.pdf"
    if [[ -e $output || -L $output ]]; then
        skipped=$((skipped + 1)); record "$(fpdf_text skipped "$name" "$(fpdf_text exists)")"
        continue
    fi
    if [[ ! -r $script_dir/$adapter ]]; then
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text missing_adapter)")"
        continue
    fi
    app_work_dir=$work_dir
    flat_workspace=0
    case $ext in
        docx) office_application=Word; office_container=com.microsoft.Word ;;
        pptx) office_application=PowerPoint; office_container=com.microsoft.Powerpoint ;;
        xlsx) office_application=Excel; office_container=com.microsoft.Excel ;;
        *) office_application='' ;;
    esac
    if [[ -n $office_application ]] && ! prepare_office_workspace "$office_application" "$office_container"; then
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text office_folder "$office_application")")"
        continue
    fi
    if [[ $flat_workspace == 1 ]]; then
        # Reserve an unpredictable basename, keeping source/output beside one
        # another so a folder-level native Office grant survives later batches.
        office_prefix=$(/usr/bin/mktemp "$app_work_dir/fpdf.XXXXXXXX") || office_prefix=''
        if [[ -z $office_prefix ]]; then
            failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text office_file)")"
            continue
        fi
        copy="$office_prefix.$ext"
        temporary_pdf="$office_prefix.pdf"
        office_files+=("$office_prefix" "$copy" "$temporary_pdf")
    else
        copy="$app_work_dir/${app_work_dir##*/}-$index.$ext"
        temporary_pdf="$app_work_dir/result-$index.pdf"
    fi
    error_file="$work_dir/error-$index.txt"
    if ! /bin/cp -p -- "$input" "$copy"; then
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text copy)")"
        continue
    fi
    if [[ $ext == xlsx ]]; then
        # Excel's AppleScript read-only flag alone does not make writable files
        # read-only. Restrict only this owned private copy before opening it.
        if ! /bin/chmod 400 "$copy"; then
            failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text excel_readonly)")"
            continue
        fi
    else
        /bin/chmod u+rw "$copy"
    fi
    if [[ $adapter == text.js ]]; then
        # Combine only installed, trusted scripts in this private workspace;
        # user file contents and paths remain data passed as arguments.
        if [[ ! -r $script_dir/markdown.js || ! -r $script_dir/csv.js ]] || ! { /bin/cat "$script_dir/markdown.js"; printf '\n'; /bin/cat "$script_dir/csv.js"; printf '\n'; /bin/cat "$script_dir/text.js"; } > "$work_dir/text-adapter.js"; then
            failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text missing_adapter)")"
            continue
        fi
        /usr/bin/osascript -l JavaScript "$work_dir/text-adapter.js" "$copy" "$temporary_pdf" >"$work_dir/adapter-$index.txt" 2>"$error_file"
    elif [[ $adapter == image.js || $adapter == dng.js ]]; then
        /usr/bin/osascript -l JavaScript "$script_dir/$adapter" "$copy" "$temporary_pdf" >"$work_dir/adapter-$index.txt" 2>"$error_file"
    else
        /usr/bin/osascript "$script_dir/$adapter" "$copy" "$temporary_pdf" >"$work_dir/adapter-$index.txt" 2>"$error_file"
    fi
    adapter_status=$?
    if [[ $adapter_status != 0 ]]; then
        # Retain the existing diagnostic size bound without splitting a UTF-8
        # character, which would prevent the native dialog decoding the report.
        reason=$(/usr/bin/head -c 700 -- "$error_file" | /usr/bin/iconv -c -f UTF-8 -t UTF-8 2>/dev/null)
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_adapter_reason "$reason" "$ext")")"
        continue
    fi
    if ! validate_pdf "$temporary_pdf"; then
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text invalid_pdf)")"
        continue
    fi
    # Stage on the destination filesystem and publish with an exclusive atomic
    # rename, so a competing file, directory, or symlink is never replaced.
    stage_file=$(/usr/bin/mktemp "$directory/.finder-pdf.XXXXXX") || stage_file=''
    if [[ -z $stage_file ]] || ! /bin/cp -- "$temporary_pdf" "$stage_file" || ! /usr/bin/cmp -s -- "$temporary_pdf" "$stage_file"; then
        [[ -z $stage_file ]] || /bin/rm -- "$stage_file"
        stage_file=''
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text stage)")"
        continue
    fi
    if publish_pdf "$stage_file" "$output"; then
        stage_file=''
        succeeded=$((succeeded + 1)); record "$(fpdf_text completed "$name" "${name%.*}.pdf")"
    elif [[ -e $output || -L $output ]]; then
        skipped=$((skipped + 1)); record "$(fpdf_text skipped "$name" "$(fpdf_text race)")"
    else
        failed=$((failed + 1)); record "$(fpdf_text failed "$name" "$(fpdf_text publish)")"
    fi
    [[ -z $stage_file ]] || /bin/rm -- "$stage_file"
    stage_file=''
done
report "$(fpdf_text summary "$succeeded" "$skipped" "$failed")"$'\n\n'"${summary%$'\n'}"
[[ $failed == 0 ]]
