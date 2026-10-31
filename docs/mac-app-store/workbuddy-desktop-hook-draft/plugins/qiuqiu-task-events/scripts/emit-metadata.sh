#!/bin/sh
# REVIEW DRAFT ONLY. WorkBuddy runs this source-side filter after explicit opt-in.
# Full hook stdin exists only in bounded local process memory. Never read a
# transcript, print the raw input, put it in argv, or save it to a temporary file.
# macOS system tools only; users do not install Node/Python or operate Terminal.
set -f
input=$(/usr/bin/head -c 262145 2>/dev/null) || exit 0
bytes=$(printf '%s' "$input" | /usr/bin/wc -c | /usr/bin/tr -d ' ')
case "$bytes" in ''|*[!0-9]*) exit 0;; esac
[ "$bytes" -le 262144 ] || exit 0
field() { printf '%s' "$input" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null; }
string_field() { [ "$(printf '%s' "$input" | /usr/bin/plutil -type "$1" - 2>/dev/null)" = 'string' ] || return 1; field "$1"; }
session=$(string_field session_id) || exit 0
generation=$(string_field generation_id) || generation=''
event=$(string_field hook_event_name) || exit 0
# Values are placed in JSON only after a restrictive ASCII identifier check.
valid_id() { case "$1" in ''|*[!A-Za-z0-9_-]*) return 1;; esac; [ "${#1}" -le 160 ]; }
valid_id "$session" || exit 0
if [ -n "$generation" ]; then valid_id "$generation" || exit 0; fi
case "$event" in
  SessionStart) phase='session-opened';;
  UserPromptSubmit) phase='submitted';;
  Stop) phase='stop-observed';;
  StopFailure) phase='failure-observed';;
  FinalStop) phase='final-stop-observed';;
  SessionEnd) phase='session-ended';;
  *) exit 0;;
esac
if [ -n "$generation" ]; then
  payload=$(printf '{"version":1,"sessionId":"%s","generationId":"%s","event":"%s","phase":"%s"}' "$session" "$generation" "$event" "$phase")
else
  payload=$(printf '{"version":1,"sessionId":"%s","event":"%s","phase":"%s"}' "$session" "$event" "$phase")
fi
# Versioned Desktop 5.9.3 FinalStop occurs after Stop continuation decisions.
# Truncation recovery and unknown/missing reasons must never imply completion.
if [ "$event" = 'FinalStop' ]; then
  recovery=$(field is_truncation_recovery) || recovery=''
  reason=''
  case "$recovery" in ''|false)
    candidate=$(string_field final_stop_reason) || candidate=''
    case "$candidate" in completed|cancelled|interrupted|failed) reason=$candidate;; esac
  ;; esac
  if [ -n "$reason" ]; then payload=$(printf '%s,"finalStopReason":"%s"}' "${payload%?}" "$reason"); fi
fi
unset input
if [ "${QIUQIU_HOOK_DRY_RUN:-}" = '1' ]; then printf '%s\n' "$payload"; exit 0; fi
# The reviewed App must generate this private local capability after native
# approval. It is deliberately absent from this draft: nothing is sent by default.
root=${CODEBUDDY_PLUGIN_ROOT:-}
[ -n "$root" ] && [ -d "$root" ] || exit 0
config="$root/receiver.json"
[ -f "$config" ] && [ ! -L "$config" ] || exit 0
config_field() { /usr/bin/plutil -extract "$1" raw -o - "$config" 2>/dev/null; }
[ "$(config_field enabled)" = 'true' ] || exit 0
[ "$(config_field version)" = '1' ] || exit 0
endpoint=$(config_field endpoint) || exit 0
token=$(config_field token) || exit 0
case "$endpoint" in http://127.0.0.1:*/workbuddy/events) ;; *) exit 0;; esac
port=${endpoint#http://127.0.0.1:}; port=${port%/workbuddy/events}
case "$port" in ''|*[!0-9]*|0*) exit 0;; esac
[ "${#port}" -le 5 ] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || exit 0
case "$token" in ''|*[!A-Za-z0-9_-]*) exit 0;; esac
[ "${#token}" -ge 32 ] && [ "${#token}" -le 128 ] || exit 0
# Authentication stays in stdin config, never command-line arguments or URLs.
# Fail open with no stdout/stderr: observation must not block the original task.
printf 'header = "Authorization: Bearer %s"\n' "$token" | /usr/bin/curl --disable --config - --noproxy '*' --proxy '' --silent --output /dev/null --connect-timeout 0.2 --max-time 0.8 --request POST --header 'Content-Type: application/json' --data-binary "$payload" "$endpoint" >/dev/null 2>&1
exit 0
