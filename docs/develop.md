# Developing AgentMon Live

```sh
git clone https://github.com/codenotary/agentmon-live.git
cd agentmon-live
claude --plugin-dir .
```

Loading the mod once writes the types `tsconfig.json` extends into `.claude-plugin/types/` (git ignores that folder). Then:

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc --noEmit -p .
```

| Path | Holds |
| --- | --- |
| `hooks/register.tsx` | Hooks, per-session state and the commands |
| `hooks/done.ts` | The done gate's material, checks and per-turn state |
| `hooks/clock.ts` | The turn clock: where a turn's time went |
| `hooks/release.ts` | Build label, release check and base-branch watch |
| `hooks/render.tsx` | The pane |
| `hooks/insights.ts` | The Focus rules and their thresholds, time and context helpers |
| `hooks/learn.ts`, `hooks/learning.ts`, `hooks/bench.ts` | What is learned across sessions: the pure rules, the store and commands, and the self benchmark |
| `hooks/memcheck.ts` | The memory-file rules |
| `hooks/debuglog.ts` | The per-session debug log: line format, the buffer and the flush |
| `hooks/i18n.ts`, `hooks/lang/*.ts`, `hooks/learn-strings.ts` | All text, one file per language: English in `i18n.ts`, the others in `lang/<code>.ts`, the learning and benchmark text in `learn-strings.ts` |
| `types/index.d.ts` | State contract |
| `tests/*.test.ts(x)` | Tests, one file per part (`bench.test.ts` for the self benchmark) |

### Check the log cleanup

`scripts/prune-check.sh` runs the debug log's delete step on a temp folder and checks what is left. The test kit has no real file system, so this is not part of `claude plugin test`.

### See the pane from a script

`claude plugin test` checks what the pane draws but never paints it. `scripts/pane-run.sh` runs a second Claude Code with this repo's mod (cheap model, a throwaway project with one failing and one passing check) in a hidden 220×60 tmux window, drives it from a scenario and saves the real screen:

```sh
scripts/pane-run.sh tests/scenarios/basics.txt      # add --keep to tmux attach afterwards
```

Captures land in `tests/pane-snaps/<scenario>/`: `<name>.txt` (whole screen), `<name>.pane.txt` (the pane alone), `<name>.ansi` (with colours). A scenario is one step per line:

| Step | Does |
| --- | --- |
| `allow <tool rules>` | Tools the session may use without asking, e.g. `Bash(npm test:*) Read` |
| `option <name> <value>` | A mod option for the run; the done gate is off unless a scenario sets `option advisorMode all` |
| `prompt <text>`, `cmd /<command>` | Types the line and presses Enter |
| `keys <tmux keys>` | Sends keys, e.g. `Escape` |
| `wait idle [secs]` | Until the turn is over |
| `wait text <regex> [secs]`, `wait gone <regex> [secs]` | Until the screen shows, or no longer shows, a match |
| `sleep <secs>`, `snap <name>` | Pauses; saves the screen |
| `write <file> <text>` | Writes a project file before the session starts (`\n` for a newline) |

`{repo}` in a `prompt` or `cmd` stands for this checkout. The `learned` and `memory` scenarios check what learning shows; they leave a small record per throwaway project in the mod's store.

Each run costs a few calls on the cheap model. Needs `tmux` and `python3`.

To add a language, add `hooks/lang/<code>.ts` exporting a `Strings` block, and register it in `LANGUAGES` in `hooks/i18n.ts` (the `Strings` type lists every key) and its code to the `language` options in `.claude-plugin/plugin.json`.
