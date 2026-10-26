#!/bin/bash
# Tunefield beta doctor — one command that answers "did the install work, and what has
# the app been doing?". Read-only apart from optionally launching the app. No network
# beyond localhost. Designed so its output can be pasted straight into a Claude chat.
#
#   ./tunefield-doctor.sh                      # find the app, check everything
#   ./tunefield-doctor.sh /path/to/Tunefield.app
#   ./tunefield-doctor.sh --launch             # also start the app if it isn't running
#   ./tunefield-doctor.sh --help

set -u

say()  { printf '%s\n' "$*"; }
pass() { say "  [ok]   $*"; }
warn() { say "  [!!]   $*"; }
note() { say "  [--]   $*"; }

usage() {
  say "usage: ./tunefield-doctor.sh [--launch] [/path/to/Tunefield.app]"
  say "  --launch    start the app if it isn't already running (waits up to 90s for a cold first start)"
  say "  --help      show this message"
  say "read-only apart from --launch; paste the full output into a Claude chat"
}

APP=""
LAUNCH=0
for a in "$@"; do
  case "$a" in
    --launch) LAUNCH=1 ;;
    --help|-h) usage; exit 0 ;;
    # Reject anything that looks like a flag — including en/em-dash lookalikes that
    # word processors substitute for "--" — instead of treating it as the app path.
    -*|–*|—*|―*|‑*|−*)
      say "unknown option: $a"
      usage
      exit 2 ;;
    *)
      if [ -n "$APP" ]; then
        say "unexpected extra argument: $a (app path already set to: $APP — quote paths containing spaces)"
        usage
        exit 2
      fi
      APP="$a" ;;
  esac
done

say "== Tunefield doctor — $(date '+%Y-%m-%d %H:%M') =="

HAVE_PY3=1
command -v python3 >/dev/null 2>&1 || HAVE_PY3=0
if [ "$HAVE_PY3" = "0" ]; then
  warn "python3 NOT FOUND — JSON checks are degraded and sections below will say SKIPPED"
  warn "this run's verdict is WEAKER than normal; say so when pasting the output"
fi

TMPBODY=$(mktemp -t tunefield-doctor 2>/dev/null || mktemp)
trap 'rm -f "$TMPBODY"' EXIT

# ---- machine ----------------------------------------------------------------
ARCH=$(uname -m)
say "-- machine --"
say "  macOS $(sw_vers -productVersion 2>/dev/null || echo '?')  $ARCH"
if [ "$ARCH" = "arm64" ]; then
  pass "Apple Silicon"
elif [ "$ARCH" = "x86_64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then
  # This shell is running under Rosetta; the machine itself is arm64, which is fine.
  pass "Apple Silicon (shell is under Rosetta — the Mac is arm64, the app runs natively)"
else
  warn "NOT arm64 — this build will not run here"
fi

# ---- locate the app ---------------------------------------------------------
say "-- app --"
SCRIPT_DIR=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
[ -z "$SCRIPT_DIR" ] && SCRIPT_DIR=$(pwd)
PARENT_DIR=$(dirname "$SCRIPT_DIR")
if [ -z "$APP" ]; then
  # The DMG layout puts this script in Testing/, one level below Tunefield.app — so the
  # script's own directory and its parent MUST outrank any older install in /Applications,
  # or a doctor run from a new image audits the old install.
  for c in "$SCRIPT_DIR/Tunefield.app" "$PARENT_DIR/Tunefield.app" \
           "/Applications/Tunefield.app" "$HOME/Applications/Tunefield.app" \
           "$(pwd)/Tunefield.app"; do
    [ -d "$c" ] && APP="$c" && break
  done
fi
QUARANTINED=0
PORTABLE_DIR=""
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  [ -n "$APP" ] && warn "no app at: $APP"
  warn "Tunefield.app not found (looked next to this script, one level up, /Applications, ~/Applications, current dir)"
  warn "pass the path: ./tunefield-doctor.sh /path/to/Tunefield.app"
  APP=""
  # The portable-data rule must survive the app not being found: in the DMG layout the
  # PORTABLE marker sits next to the app, which is next to (or one level above) this script.
  for d in "$PARENT_DIR" "$SCRIPT_DIR"; do
    if [ -f "$d/PORTABLE" ]; then PORTABLE_DIR="$d"; break; fi
  done
  [ -n "$PORTABLE_DIR" ] && note "PORTABLE marker found at $PORTABLE_DIR — portable data rules still apply"
else
  pass "found: $APP"
  Q=$(xattr -p com.apple.quarantine "$APP" 2>/dev/null)
  if [ -n "$Q" ]; then
    # Presence of the attribute does NOT mean blocked — Gatekeeper approval flips a flag
    # inside it but keeps the attribute. Informational unless the app won't start.
    QUARANTINED=1
    note "com.apple.quarantine present — NORMAL for a downloaded app, even after approval"
    note "only matters if launch fails; known fix: xattr -dr com.apple.quarantine \"$APP\""
  else
    pass "not quarantined"
  fi
  APP_DIR=$(dirname "$APP")
  if [ -f "$APP_DIR/PORTABLE" ]; then
    PORTABLE_DIR="$APP_DIR"
    pass "PORTABLE marker present — data stays in $PORTABLE_DIR"
  else
    note "no PORTABLE marker — data goes to ~/Library/Application Support/Tunefield"
  fi
fi

# ---- is it running? ---------------------------------------------------------
# A real health response only: HTTP 200 whose body parses as JSON with a "tunefield"
# key. A 404 page that merely mentions "tunefield" must not pass.
probe() {  # $1 = base url; on success the body is left in $TMPBODY
  local code
  code=$(curl -s -m 2 -o "$TMPBODY" -w '%{http_code}' "$1/system/health" 2>/dev/null) || return 1
  [ "$code" = "200" ] || return 1
  if [ "$HAVE_PY3" = "1" ]; then
    python3 - "$TMPBODY" <<'PY' >/dev/null 2>&1
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(d, dict) and "tunefield" in d else 1)
PY
  else
    grep -q '"tunefield"' "$TMPBODY" 2>/dev/null
  fi
}

scan_ports() {
  local p
  for p in $(seq 5050 5080); do
    if probe "http://127.0.0.1:$p"; then URL="http://127.0.0.1:$p"; return 0; fi
  done
  return 1
}

say "-- server --"
[ "$HAVE_PY3" = "0" ] && note "python3 missing: server check degraded to a weaker substring match"
URL=""
scan_ports || true
if [ -z "$URL" ] && [ "$LAUNCH" = "1" ]; then
  if [ -z "$APP" ]; then
    warn "--launch requested but no Tunefield.app was located — cannot launch without a path"
    warn "re-run as: ./tunefield-doctor.sh --launch /path/to/Tunefield.app"
  else
    say "  launching $APP — a cold first start of the 248MB bundle is slow; waiting up to 90s..."
    open "$APP"
    for i in $(seq 1 90); do
      sleep 1
      scan_ports && break
    done
  fi
fi

H_DATA=""; H_ROOT=""; H_EXP=""; H_BAD=""
if [ -z "$URL" ]; then
  if [ "$LAUNCH" = "1" ]; then
    warn "no running Tunefield found on ports 5050-5080"
  else
    warn "no running Tunefield found on ports 5050-5080 (re-run with --launch to start it)"
  fi
  if [ "$QUARANTINED" = "1" ]; then
    warn "the app is quarantined AND no server is running — if it refuses to open:"
    warn "  xattr -dr com.apple.quarantine \"$APP\"   (or right-click the app > Open, once)"
  fi
else
  pass "running at $URL"
  say "  health:"
  if [ "$HAVE_PY3" = "1" ]; then
    python3 -m json.tool "$TMPBODY" 2>/dev/null | sed 's/^/    /'
    H_INFO=$(python3 - "$TMPBODY" <<'PY' 2>/dev/null
import json, sys
d = json.load(open(sys.argv[1]))
skip = ("ffmpeg", "ffprobe", "fpcalc")
print(d.get("data_dir", "") or "")
print(d.get("root", "") or "")
print(",".join(k for k in skip if d.get(k) is False))
print(",".join(k for k, v in d.items() if v is False and k not in skip))
PY
)
    H_DATA=$(printf '%s\n' "$H_INFO" | sed -n 1p)
    H_ROOT=$(printf '%s\n' "$H_INFO" | sed -n 2p)
    H_EXP=$(printf '%s\n' "$H_INFO" | sed -n 3p)
    H_BAD=$(printf '%s\n' "$H_INFO" | sed -n 4p)
    if [ -n "$H_BAD" ]; then
      warn "health reports false for: $H_BAD"
    else
      pass "health grades clean (no unexpected false flags)"
    fi
    # ffmpeg/ffprobe/fpcalc = false is correct for this app — no external binaries
    # needed. Never raise [!!] for it; testers were chasing this.
    [ -n "$H_EXP" ] && note "$H_EXP = false is EXPECTED — Tunefield needs no external binaries; not a fault"
  else
    sed 's/^/    /' "$TMPBODY"
    note "SKIPPED health grading (python3 missing)"
  fi
  # A PORTABLE-marker install must never be silently reported through some other
  # install's server: compare the running server's root against the marker directory.
  if [ -n "$PORTABLE_DIR" ]; then
    RCHK="${H_ROOT:-$H_DATA}"
    if [ -z "$RCHK" ]; then
      if [ "$HAVE_PY3" = "1" ]; then
        note "health reports no root/data_dir — cannot confirm this server is the portable install"
      else
        note "SKIPPED portable-install check (python3 missing)"
      fi
    else
      case "$RCHK" in
        "$PORTABLE_DIR"|"$PORTABLE_DIR"/*)
          pass "running server is this portable install ($PORTABLE_DIR)" ;;
        *)
          warn "MISMATCH: PORTABLE marker at $PORTABLE_DIR but the RUNNING server's root is: $RCHK"
          warn "everything below reports THAT OTHER install — quit it, launch the portable app, re-run" ;;
      esac
    fi
  fi
fi

# ---- data + activity --------------------------------------------------------
say "-- activity --"
DATA="$H_DATA"
if [ -z "$DATA" ]; then
  if [ -n "$PORTABLE_DIR" ]; then
    DATA="$PORTABLE_DIR/data"
    note "using portable data location: $DATA"
  elif [ -d "$HOME/Library/Application Support/Tunefield/data" ]; then
    DATA="$HOME/Library/Application Support/Tunefield/data"
  fi
fi
if [ -z "$DATA" ] || [ ! -d "$DATA" ]; then
  warn "no data directory yet (app never ran?)"
else
  pass "data: $DATA  ($(du -sh "$DATA" 2>/dev/null | cut -f1))"
  U="$DATA/logs/usage.jsonl"
  if [ -f "$U" ]; then
    if [ ! -r "$U" ]; then
      warn "usage log exists but is NOT READABLE ($U) — error/reject counts unknown, verdict NOT clean"
    else
      say "  usage ($(wc -l < "$U" | tr -d ' ') events):"
      if [ "$HAVE_PY3" = "1" ]; then
        python3 - "$U" <<'PY' | sed 's/^/    /'
import json, sys, collections
ev = collections.Counter(); last = {}; ms = []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: r = json.loads(line)
    except Exception: continue
    ev[r.get("e","?")] += 1; last[r.get("e","?")] = r.get("t","")
    if r.get("e") == "analyze" and "ms" in r: ms.append(r["ms"])
for e, n in ev.most_common():
    print(f"{e:<16} x{n:<6} last {last[e]}")
if ms: print(f"analysis time    median {sorted(ms)[len(ms)//2]/1000:.1f}s over {len(ms)} tracks")
PY
      else
        note "SKIPPED usage summary (python3 missing) — raw error/reject counts below"
      fi
      # grep -c prints a count even when it exits 1 (no match); exit >= 2 means the
      # read itself failed — that must never be laundered into "0 errors".
      E=$(grep -c '"e": *"error"' "$U" 2>/dev/null); ERC=$?
      R=$(grep -c '"e": *"analyze_reject"' "$U" 2>/dev/null); RRC=$?
      if [ "$ERC" -ge 2 ] || [ "$RRC" -ge 2 ]; then
        warn "could not read $U while counting errors — verdict unknown, NOT clean"
      else
        E=${E:-0}; R=${R:-0}
        if [ "$E" = "0" ]; then
          pass "no internal errors recorded"
        else
          warn "$E internal error(s) — last 5:"
          grep '"e": *"error"' "$U" | tail -5 | sed 's/^/    /'
        fi
        if [ "$R" != "0" ]; then
          # Rejects are a warning, not an app error: the app refused these files.
          warn "warning: $R track(s) rejected by analysis (files refused, not an app failure) — last 5 reasons:"
          if [ "$HAVE_PY3" = "1" ]; then
            python3 - "$U" <<'PY' | sed 's/^/    /'
import json, sys
rej = []
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: r = json.loads(line)
    except Exception: continue
    if r.get("e") == "analyze_reject": rej.append(r)
for r in rej[-5:]:
    why = r.get("reason") or r.get("msg") or r.get("detail") or json.dumps(r)
    where = r.get("file") or r.get("path") or ""
    print(f"{r.get('t','')}  {where}  {why}".strip())
PY
          else
            grep '"e": *"analyze_reject"' "$U" | tail -5 | sed 's/^/    /'
          fi
        fi
      fi
    fi
  else
    note "no usage log yet (needs build >= 2026-08-07 morning, or app never ran)"
  fi
  # The log handler rotates: errors from earlier in a long session live in app.log.1.
  FOUND_LOG=0
  for LOG in "$DATA/logs/app.log" "$DATA/logs/app.log.1"; do
    [ -f "$LOG" ] || continue
    FOUND_LOG=1
    B=$(basename "$LOG")
    if [ ! -r "$LOG" ]; then
      warn "$B exists but is NOT READABLE — cannot rule out errors in it, verdict NOT clean"
      continue
    fi
    EN=$(grep -c 'ERROR' "$LOG" 2>/dev/null); ERC2=$?
    TN=$(grep -c 'Traceback' "$LOG" 2>/dev/null); TRC2=$?
    AN=$(grep -cE 'HTTP/1\.[01]" [345][0-9][0-9]' "$LOG" 2>/dev/null); ARC2=$?
    if [ "$ERC2" -ge 2 ] || [ "$TRC2" -ge 2 ] || [ "$ARC2" -ge 2 ]; then
      warn "$B could not be read while counting errors — verdict unknown, NOT clean"
      continue
    fi
    EN=${EN:-0}; TN=${TN:-0}; AN=${AN:-0}
    if [ "$EN" = "0" ] && [ "$TN" = "0" ] && [ "$AN" = "0" ]; then
      pass "$B clean (no ERROR lines, no tracebacks, no non-2xx responses)"
    else
      if [ "$EN" != "0" ]; then
        warn "$B: $EN ERROR line(s) — last 3:"
        grep 'ERROR' "$LOG" | tail -3 | sed 's/^/    /'
      fi
      if [ "$TN" != "0" ]; then
        warn "$B: $TN traceback(s) — last one in full:"
        TBL=$(grep -n 'Traceback' "$LOG" | tail -1 | cut -d: -f1)
        [ -n "$TBL" ] && tail -n +"$TBL" "$LOG" | head -20 | sed 's/^/    /'
      fi
      if [ "$AN" != "0" ]; then
        warn "$B: $AN request(s) answered non-2xx — last 5:"
        grep -E 'HTTP/1\.[01]" [345][0-9][0-9]' "$LOG" | tail -5 | sed 's/^/    /'
      fi
    fi
  done
  [ "$FOUND_LOG" = "0" ] && note "no app.log yet"
fi
say "== done — paste all of the above to Claude for interpretation =="
