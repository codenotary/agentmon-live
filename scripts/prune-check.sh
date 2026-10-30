#!/usr/bin/env bash
# The test kit has no real file system; this runs pruneArgvs' find commands for real, so keep them equal.
set -euo pipefail

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
debug="$root/agentmon-live/debug"
mkdir -p "$debug/2026-10-01" "$debug/2026-10-30" "$debug/2026-09-01"
echo old > "$debug/2026-10-01/abc.log"
echo new > "$debug/2026-10-30/def.log"
echo note > "$debug/2026-10-01/notes.txt"
touch -d '10 days ago' "$debug/2026-10-01/abc.log"

find "$debug" -mindepth 1 -type f -name '*.log' -mtime +7 -delete
find "$debug" -mindepth 1 -type d -empty -delete

fail() { echo "FAIL: $1" >&2; exit 1; }
[[ ! -e "$debug/2026-10-01/abc.log" ]] || fail "old log kept"
[[ -e "$debug/2026-10-30/def.log" ]] || fail "new log deleted"
[[ -e "$debug/2026-10-01/notes.txt" ]] || fail "text file deleted"
[[ ! -e "$debug/2026-09-01" ]] || fail "empty folder kept"
echo "PASS: prune deletes only the old log and the empty folder"
