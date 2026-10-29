#!/usr/bin/env bash
# The test kit never paints, so this captures the real screen of a second session; usage and steps: README.
set -euo pipefail

scenario=${1:?usage: pane-run.sh <scenario> [--keep]}
keep=${2:-}
repo=$(cd "$(dirname "$0")/.." && pwd)
name=$(basename "$scenario" .txt)
out="$repo/tests/pane-snaps/$name"
session="radar-$$"
project=$(mktemp -d)
width=220
height=60

cleanup() {
  if [[ $keep != --keep ]]; then
    tmux kill-session -t "$session" 2>/dev/null || true
    rm -rf "$project"
  fi
}
trap cleanup EXIT

screen() { tmux capture-pane -p -t "$session"; }
snap() {
  tmux capture-pane -p -t "$session" >"$out/$1.txt"
  tmux capture-pane -p -e -t "$session" >"$out/$1.ansi"
  # The pane alone: right of the divider that most lines share.
  python3 -I -c '
import collections, sys
lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
cols = collections.Counter(i for l in lines for i, c in enumerate(l) if c == "\u2502")
at = cols.most_common(1)[0][0] if cols else -1
print("\n".join(l[at + 1:].rstrip() for l in lines).rstrip())
' "$out/$1.txt" >"$out/$1.pane.txt"
  echo "snap: $out/$1.pane.txt"
}
fail() {
  echo "pane-run: $1" >&2
  snap error || true
  exit 1
}
alive() { tmux has-session -t "$session" 2>/dev/null; }

# A fresh folder asks for trust, and its first choice exits; pick "Yes, I trust this folder".
answer_dialogs() {
  if screen | grep -q 'Yes, I trust this folder'; then
    tmux send-keys -t "$session" Down
    sleep 0.5
    tmux send-keys -t "$session" Enter
    sleep 3
  fi
}

# A turn under way shows a spinner line like "✢ Churning…"; it ends as "✻ Brewed for 4s · done".
busy() { screen | grep -qE '^\S [A-Z][^…]{0,40}…'; }

wait_idle() {
  local limit=${1:-180} quiet=0 i
  # Give the turn a moment to start, so a snap never lands before the work.
  for ((i = 0; i < 15; i++)); do
    answer_dialogs
    busy && break
    sleep 1
  done
  for ((i = 0; i < limit; i++)); do
    alive || fail "session ended"
    answer_dialogs
    if busy; then quiet=0; else quiet=$((quiet + 1)); fi
    ((quiet >= 3)) && return 0
    sleep 1
  done
  fail "still busy after ${limit}s"
}

wait_gone() {
  local regex=$1 limit=${2:-180} i
  for ((i = 0; i < limit; i++)); do
    alive || fail "session ended"
    screen | grep -qE "$regex" || return 0
    sleep 1
  done
  fail "/$regex/ still on screen after ${limit}s"
}

wait_text() {
  local regex=$1 limit=${2:-120} i
  for ((i = 0; i < limit; i++)); do
    alive || fail "session ended"
    answer_dialogs
    screen | grep -qE "$regex" && return 0
    sleep 1
  done
  fail "no match for /$regex/ after ${limit}s"
}

type_line() {
  tmux send-keys -t "$session" -l "$1"
  sleep 0.3
  tmux send-keys -t "$session" Enter
}

# A small project with one failing check, one passing check and a git history.
cat >"$project/package.json" <<'EOF'
{ "name": "radar-scenario", "private": true, "scripts": { "test": "node -e \"console.log('1 failing'); process.exit(1)\"", "lint": "echo 'no problems'" } }
EOF
(cd "$project" && git init -q && git add -A && git -c user.name=radar -c user.email=radar@example.invalid -c commit.gpgsign=false commit -qm init)

# `write <file> <text>` lines seed the project before the session starts (memory files load at start); `\n` is a newline.
while IFS= read -r line; do
  f=${line#write }; f=${f%% *}
  printf '%b\n' "${line#write "$f" }" >"$project/$f"
done < <(grep -E '^write ' "$scenario" || true)

allowed=$(grep -E '^allow ' "$scenario" | cut -d' ' -f2- | tr '\n' ' ' || true)
# Mod options: Fable stays off unless the scenario asks (`option advisorMode all`), so runs need no Fable calls.
settings=$(python3 -I -c '
import json, sys
opts = {"advisorMode": "off"}
for line in open(sys.argv[1], encoding="utf-8"):
    if line.startswith("option "):
        _, key, value = line.split(maxsplit=2)
        opts[key] = value.strip()
conf = {"options": opts}
print(json.dumps({"pluginConfigs": {"agentmon-live": conf, "agentmon-live@inline": conf}}))
' "$scenario")
mkdir -p "$out"
rm -f "$out"/*.txt "$out"/*.ansi

# Only this repo's mod: the person's own mod folders stay out.
tmux new-session -d -s "$session" -x "$width" -y "$height" -c "$project" \
  env -u CLAUDE_CODE_PLUGIN_DIRS claude --plugin-dir "$repo" --settings "$settings" --model haiku --permission-mode acceptEdits ${allowed:+--allowedTools "$allowed"}
sleep 3
wait_idle 60

while IFS= read -r line || [[ -n $line ]]; do
  [[ -z ${line// /} || $line == \#* ]] && continue
  verb=${line%% *}
  rest=${line#* }
  case $verb in
    allow | option | write) ;;
    # `{repo}` stands for this checkout, so a step can name its fixtures.
    prompt | cmd) type_line "${rest//\{repo\}/$repo}" ;;
    keys) tmux send-keys -t "$session" $rest ;;
    sleep) sleep "$rest" ;;
    snap) snap "$rest" ;;
    wait)
      case ${rest%% *} in
        idle) wait_idle ${rest#idle} ;;
        # Only a number at the very end is the time limit; `learned from 3 sessions` keeps its 3.
        text) args=${rest#text }; if [[ $args =~ ^(.*)\ ([0-9]+)$ ]]; then wait_text "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"; else wait_text "$args" 120; fi ;;
        gone) args=${rest#gone }; if [[ $args =~ ^(.*)\ ([0-9]+)$ ]]; then wait_gone "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"; else wait_gone "$args" 180; fi ;;
        *) fail "unknown wait: $rest" ;;
      esac
      ;;
    *) fail "unknown step: $line" ;;
  esac
done <"$scenario"

if [[ $keep == --keep ]]; then echo "kept: tmux attach -t $session  (project: $project)"; fi
