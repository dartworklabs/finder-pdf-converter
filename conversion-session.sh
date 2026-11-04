#!/bin/bash
# Own one monitor and run failed-only attempts through the converter.
set -u
umask 077
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
script_dir=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd) || exit 2
prepare=0
prepare_pdfs=''
refresh_manifest=''
while [[ ${1-} == --prepare || ${1-} == --refresh-manifest || ${1-} == --prepare-pdfs ]]; do
    case $1 in
        --prepare) prepare=1; shift ;;
        --prepare-pdfs) [[ $# -ge 2 && ( $2 == print || $2 == merge ) ]] || exit 2; prepare=1; prepare_pdfs=$2; shift 2 ;;
        --refresh-manifest) [[ $# -ge 2 ]] || exit 2; refresh_manifest=$2; shift 2 ;;
    esac
done
[[ ${1-} != -- ]] || shift
[[ $# -gt 0 && -x $script_dir/convert.sh && -r $script_dir/conversion-status.js && -r $script_dir/conversion-session.js && -d $script_dir/Finder\ PDF\ Review.app ]] || exit 2
[[ -z $refresh_manifest || $prepare == 1 ]] || exit 2
. "$script_dir/locale.sh"
fpdf_locale=$(fpdf_language "$script_dir/preferred-language.js")
session_dir=$(/usr/bin/mktemp -d /private/tmp/fpdf-session.XXXXXX) || exit 2
converter=''
monitor=''
interrupted=0

# A signal requests cancellation; it never terminates the document adapter.
request_stop() {
    interrupted=1
    /usr/bin/touch "$session_dir/cancel"
}

# Keep the session files available until the converter and monitor are done.
cleanup() {
    trap '' INT TERM HUP
    if [[ -n $converter ]] && /bin/kill -0 "$converter" 2>/dev/null; then
        /usr/bin/touch "$session_dir/cancel"
        wait "$converter" 2>/dev/null || true
    fi
    if [[ -n $monitor ]] && /bin/kill -0 "$monitor" 2>/dev/null; then
        /usr/bin/touch "$session_dir/shutdown"
        for ((cleanup_wait=0; cleanup_wait<100; cleanup_wait++)); do
            /bin/kill -0 "$monitor" 2>/dev/null || break
            /bin/sleep 0.1
        done
    fi
    if [[ -n $monitor ]] && /bin/kill -0 "$monitor" 2>/dev/null; then
        printf '%s\n' 'Monitor did not close; its private session was retained.' >&2
    else
        /bin/rm -r -- "$session_dir"
    fi
}
trap cleanup EXIT
trap request_stop INT TERM HUP
paths=("$@")
selected=("$@")
indices=''
for ((i=1; i<=$#; i++)); do indices+="${indices:+,}$i"; done
attempt=1
status="$session_dir/status.json"
command="$session_dir/command.json"
cancel="$session_dir/cancel"
/usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" init "$status" "$attempt" "$indices" "${selected[@]}" || exit 2
/usr/bin/osascript -l JavaScript "$script_dir/conversion-session.js" manifest "$session_dir/manifest.json" "$fpdf_locale" "$status" "$command" "$cancel" "$prepare" "$session_dir/ready" "$session_dir/shutdown" || exit 2
/usr/bin/open -W -n "$script_dir/Finder PDF Review.app" --args -AppleLanguages "($fpdf_locale)" --manifest "$session_dir/manifest.json" >/dev/null 2>&1 &
monitor=$!
# Do not start opening documents until the monitor confirms its window loaded.
for ((ready_wait=0; ready_wait<150; ready_wait++)); do
    [[ $interrupted == 0 ]] || exit 130
    [[ ! -e $session_dir/ready ]] || break
    /bin/kill -0 "$monitor" 2>/dev/null || exit 2
    /bin/sleep 0.1
done
[[ -e $session_dir/ready ]] || exit 2
# Translate only the helper's first-line classification, never a filename body.
refresh_message_for_log() {
    local locale=$1 log=$2 helper=$3 first_line=''
    IFS= read -r first_line < "$log" || true
    case $first_line in
        "$helper: execution error: Error: Error: FPDF_ACCESS_DENIED:"*)
            if [[ $locale == ko ]]; then
                printf '%s' 'macOS가 교체된 파일에 대한 접근을 차단했습니다. 이 창을 닫고 Finder에서 복구한 파일을 다시 선택한 뒤 작업을 다시 실행하세요.'
            else
                printf '%s' 'macOS blocked access to the replaced file. Close this window, select the repaired file in Finder, and run the action again.'
            fi ;;
        "$helper: execution error: Error: Error: FPDF_SOURCE_MISSING:"*)
            if [[ $locale == ko ]]; then printf '%s' '원본 파일을 복구한 뒤 다시 시도하세요.'
            else printf '%s' 'Restore the original file, then try again.'; fi ;;
        *)
            if [[ $locale == ko ]]; then printf '%s' '원본을 다시 가져오지 못했습니다.'
            else printf '%s' 'The original could not be refreshed.'; fi ;;
    esac
}

result=2
refresh_failed=0
while :; do
    if [[ $refresh_failed == 1 ]]; then
        /usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" init "$status" "$attempt" "$indices" "${selected[@]}" || exit 2
        refresh_log="$session_dir/refresh-error-$attempt.log"
        refresh_message=$(refresh_message_for_log "$fpdf_locale" "$refresh_log" "$script_dir/conversion-session.js")
        /usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" refresh-failed "$status" "$refresh_message" || exit 2
        result=1
        refresh_failed=0
    else
        extra=()
        [[ -z $prepare_pdfs ]] || extra=(--prepare-pdfs "$prepare_pdfs")
        /bin/bash "$script_dir/convert.sh" --no-dialog --progress-dir "$session_dir" --attempt "$attempt" --indices "$indices" ${extra[@]+"${extra[@]}"} -- "${selected[@]}" &
        converter=$!
        monitor_lost=0
        while /bin/kill -0 "$converter" 2>/dev/null; do
            if ! /bin/kill -0 "$monitor" 2>/dev/null; then
                phase=$(/usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" phase "$status" 2>/dev/null) || phase=running
                if [[ $phase == running ]]; then
                    monitor_lost=1
                    /usr/bin/touch "$cancel"
                fi
            fi
            /bin/sleep 0.2
        done
        wait "$converter"
        result=$?
        converter=''
        [[ $monitor_lost == 0 ]] || result=2
        case $result in
            0|1|130) ;;
            *) result=2 ;;
        esac
        phase=$(/usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" phase "$status" 2>/dev/null) || phase=invalid
        if [[ $result == 130 && $phase == running ]]; then
            /usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" finish "$status" cancelled >/dev/null 2>&1 || true
        elif [[ ( $result == 0 || $result == 1 ) && $phase != complete ]]; then
            result=2
        fi
    fi
    if [[ $result == 2 ]]; then
        /usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" finish "$status" error >/dev/null 2>&1 || true
    fi
    if [[ $interrupted == 1 ]]; then
        /usr/bin/touch "$session_dir/shutdown"
        exit 130
    fi
    while :; do
        if [[ -f $command && ! -L $command ]]; then
            action=$(/usr/bin/osascript -l JavaScript "$script_dir/conversion-session.js" command "$command" "$attempt" 2>/dev/null) || action=''
            /bin/rm -f -- "$command"
            case $action in
                close|cancel) [[ $action != cancel ]] || result=130; break 2 ;;
                retry)
                    [[ $result == 1 ]] || continue
                    failed_indices=$(/usr/bin/osascript -l JavaScript "$script_dir/conversion-status.js" failed "$status") || continue
                    [[ -n $failed_indices ]] || continue
                    selected=()
                    oldIFS=$IFS; IFS=,; read -r -a numbers <<< "$failed_indices"; IFS=$oldIFS
                    for number in "${numbers[@]}"; do selected+=("${paths[$((number-1))]}"); done
                    indices=$failed_indices
                    attempt=$((attempt+1))
                    if [[ -n $refresh_manifest ]] && ! /usr/bin/osascript -l JavaScript "$script_dir/conversion-session.js" refresh "$refresh_manifest" "${selected[@]}" >/dev/null 2>"$session_dir/refresh-error-$attempt.log"; then
                        # Show a new failed attempt without running stale snapshots.
                        refresh_failed=1
                    fi
                    break ;;
            esac
        fi
        if ! /bin/kill -0 "$monitor" 2>/dev/null; then
            result=2
            break 2
        fi
        if [[ $interrupted == 1 ]]; then
            /usr/bin/touch "$session_dir/shutdown"
            exit 130
        fi
        /bin/sleep 0.2
    done
done
# A signal may arrive while the final close animation is still running.  Keep
# the monitor handle until it has actually exited so cleanup can request a
# shutdown and preserve its files if it does not respond.
while /bin/kill -0 "$monitor" 2>/dev/null; do
    if [[ $interrupted == 1 ]]; then
        /usr/bin/touch "$session_dir/shutdown"
        exit 130
    fi
    /bin/sleep 0.1
done
wait "$monitor" 2>/dev/null || true
monitor=''
if [[ -e $cancel && ( $result == 0 || $result == 1 ) ]]; then result=130; fi
exit "$result"
