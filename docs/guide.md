# AgentMon Live guide

Everything the pane shows, every option, and how learning and the self benchmark work. For install and the short tour, see the [README](../README.md).

## What it shows

Top to bottom, in the order you need it:

- **Header**: the models, the done gate, and the version. When a newer AgentMon Live release is out, `update` (`u`) sits next to the version and drafts the two update commands, and `changelog` (`l`) folds out that release's notes. The mod asks GitHub's releases API at session start: a newer release it found is kept a day, anything else an hour, and an install or update since the last look asks again at once; never while `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` is set.
- **Focus** (always on top, in every view): first what needs you (a tool call waiting for your approval, three failed calls in a row, a failed check, a subagent that failed or reported failing tests, a subagent waiting), then what is worth a look, ranked by importance: a call running far longer than that tool usually takes, a subagent quiet for minutes, the same call failing again and again, context near compaction or one tool result that flooded it, a file read over and over or edited over and over, docs read and code changed in one turn that was not a refactor (`i` drafts: where docs and code disagree, follow the code and list each inconsistency), approvals holding up the turn (with the calls asked most, to turn into allow rules), a low prompt-cache hit rate, focus jumping between many parts of the project, one tool category eating most of the turn, MCP tool schemas taking a large slice of the window, a plan window (5h, 7d) filling faster than it resets, a large session (150k+ tokens) idle past its one-hour prompt cache, two prompts in a row that correct the last change (`i` drafts a summary to start over with `/clear`), a turn in parts of the project a large session had not touched (start the next unrelated task with `/clear`), a custom subagent on Opus or Fable that only read or searched (`model: haiku` in its definition costs less), a base branch that moved, in red when it changed files the session edited (`i` drafts the rebase), and peak hours (weekdays 05:00–11:00 Pacific), when limits may be used up faster. Three show at once (`d` shows all); `i` drafts a question about the first one that has one, `x` puts them away. When nothing needs a look it is one line: where the last turn's time went.
- **Insights:** where the time went, this turn and over the session, as one bar: the model streaming, each tool category (parallel calls share the time), you (calls waiting on an approval) and idle; the slowest calls (approval waits left out), each with **investigate**, which drafts why it was slow and how to speed it up (`i` when Focus has nothing to ask); the main context per model request as a sparkline, its growth in the last turn, the prompt-cache hit rate and the biggest tool results (≈ characters / 4); tokens in, cached and out, and the subagents' share; how often the main loop moved between parts of the project this turn, and the files it re-read or re-edited most. With details on, the window's breakdown by category (from a local estimate, no extra request), MCP schema and CLAUDE.md tokens, and model or effort switches.
- **Running now:** each tool call in flight, with who runs it and for how long; when idle, the last call. Running and waiting subagents sit here as cards.
- **Done gate:** when Claude is about to stop after real work (3 or more tool calls, an edit, or a subagent), it checks what the session recorded: a test, lint, typecheck or build that failed this turn (not one that already failed at the prompt or before the turn's first code edit), one that ran before the last edit, an answer that says the tests pass or the build succeeds when no check ran after the last code edit, todo items still open, a subagent that reported failing tests. Anything found goes back to Claude, once per prompt, as a Stop hook block: "Before you report done, this looks unfinished: … Finish it, or say plainly why not." Only when the facts show nothing does Fable, a second model that never writes code, judge one thing: does the final answer address every part of the request? The box reads `✓ nothing left open at the last stop`, `↩ sent back to Claude:` with the gaps, or `⚠ stopped with this left open:` when Claude stopped again with gaps; `f` then drafts the same reason as a prompt. Each result names when it came and the request it is about (`↳ 2 min ago · "fix the parser"`) and leaves when your next turn starts. Below it, `earlier this session:` lists the session's earlier results, newest first: mark, when, the request and the first gap; three show, `d` shows all, and `/agentmon clear` empties the list. It does not block while subagents run, after another Stop hook already sent the turn back, or when off. **Check now** (`c`, or `/agentmon check`) runs the same check and only shows it; while a turn runs, it waits for the turn's answer. Its state reads checking, off, checks only, unavailable (Fable failed; Claude then stops as usual) or budget used, with Fable's call count and tokens.
- **Changes and verification:** files edited and read (successful calls only), and the last test, lint, typecheck and build command with its outcome: ok, failed, or unknown when a pipe, a `||` or a denial hides the exit status and the output does not tell. A check run before a later edit is marked stale.
- **Usage:** context, cost and rate limits with their reset times; `unavailable` where the session does not report a value.
- **History** (folds with `h`): main session, tool counts per category with errors and calls in the last minute, the git / shell / MCP detail tabs (`g` `s` `m`, a click, or `/agentmon git|shell|mcp`), finished subagent cards and the session log.
- **Details** (`d`) shows cut-off tasks, commands and error texts whole.

Subagent test results are *reported* from the agent's final answer (a failure wins over a pass). Running and waiting subagents are always kept; the last 12 finished ones stay. The status line counts git commands as `git [n]`.

Languages: English (default), German, French, Spanish, Chinese and Japanese.

## Use

| Command | Does |
| --- | --- |
| `/agentmon` | Opens the pane |
| `/agentmon advisor` | Turns the done gate on or off |
| `/agentmon check` | Runs the done gate's check now, without sending anything |
| `/agentmon git`, `shell`, `mcp` | Shows that detail tab |
| `/agentmon details` | Shows cut-off texts whole (`d` in the pane) |
| `/agentmon learn [dir]` | Learns from this project's past transcripts (or the `.jsonl` files in `dir`) |
| `/agentmon memory` | Checks the memory and instruction files now and lists what it found |
| `/agentmon bench` | Compares this project's sessions with and without the mod, and the last 7 days |
| `/agentmon clear` | Resets counters, finished cards, log and the done gate's results; running subagents stay. The word for clear in each language works too: `leeren`, `vider`, `limpiar`, `清空`, `クリア` |

The pane opens by itself at session start when the terminal is wide enough.

## Options

Set in `/config`, under the plugin, or ask Claude in chat ("hide the usage box", "switch AgentMon to German"). The bundled `agentmon-config` skill tells Claude where the options live; run `/reload-plugins` after it edits them.

| Option | Values | Default |
| --- | --- | --- |
| `language` | `en`, `de`, `fr`, `es`, `zh`, `ja` | `en` |
| `advisorModel` | any model id | `claude-fable-5-1` |
| `advisorMode` | `all` (done gate with Fable's coverage check), `gate` (done gate from recorded facts only, no model), `off`; `plan` is read as `gate` | `all` |
| `advisorBudget` | most Fable calls per session; `0` for no limit | `30` |
| `sizeLimit` | bytes a maintained source file may reach before Focus suggests splitting it; `0` turns the guide off | `20000` |
| `sizeExclude` | comma-separated globs the size guide skips, on top of the built-in ones | empty |
| `hiddenSections` | comma-separated dashboard sections to hide: `tasks`, `insights`, `skills`, `advisor`, `changes`, `usage` | empty |
| `learning` | `on` keeps what each session of a project shows (below); `off` keeps nothing | `on` |
| `gitPollMinutes` | minutes between checks of the base branch (below); `0` turns the check off | `5` |
| `gitFetch` | `true` runs `git fetch` for the base branch before each check; `false` compares against your last fetch | `false` |

### Base branch

Every `gitPollMinutes` minutes, and after each turn, the mod compares the branch with its base: the remote's default branch (`origin/HEAD`), else `origin/main`. When the base has commits this branch lacks, Focus says how many. When those commits changed files the session edited, the item turns red and names them: rebase before more edits. `i` drafts a request to show what the base changed in those files, rebase and rerun the checks. By default the mod does not fetch, so the check sees the base as of your last `git fetch`. With `gitFetch` on, it fetches the base branch first (never with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` set, never asking for credentials). Outside a git repository, or without an `origin` remote, nothing shows.

### Cost

Fable is asked at most once per stop, and only when the recorded facts show no gap: one small model call (low effort, at most 300 output tokens, about 12,000 characters of material). `advisorBudget` caps the calls per session, and the pane shows Fable's own tokens. Set `advisorMode` to `gate` for no model calls at all.

### File-size guide

Big files are hard to take in, for people and for agents alike. When an Edit or Write, by the main session or a subagent, leaves a maintained source file over `sizeLimit` bytes (20,000 by default, about 5,000 tokens; a size heuristic, not a token count), Focus says so. Its `investigate` draft asks to split the file along distinct responsibilities with clear interfaces between the parts, and not to split arbitrarily or add abstractions just to get under the number. A file that was already over the limit is flagged only when it grows; a new file over the limit is flagged at once. It only warns; nothing is blocked.

Only source files count (`.ts`, `.py`, `.go`, `.rs` and the like), and only inside the project. Built-in exclusions skip lockfiles (`package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum`, …), generated code (`*.min.*`, `*.map`, `*.generated.*`, `*.pb.go`, `generated/`), vendored code (`node_modules/`, `vendor/`, `third_party/`), build output (`dist/`, `build/`, `out/`, `target/`, `.next/`, `coverage/`) and fixtures (`fixtures/`, `__snapshots__/`, `testdata/`, `*.snap`). Add your own with `sizeExclude`.

For a file that should stay whole, add it to `.agentmon-size` at the project root, one glob per line with the reason after `#`. A line without a reason is ignored, so every exception says why:

```
src/schema.ts      # one table per type; kept together on purpose
src/legacy/*.ts    # ported code, split after the migration
```

### Learning across sessions

At the end of each turn the mod keeps a small record of the session, per project, in its own store: tool calls and errors per tool, results of 10k+ tokens, where the context compacted, and the MCP servers loaded. The last 30 sessions count. `/agentmon learn` fills that history from the project's past transcripts once. From it, Focus suggests; it never changes anything itself:

- **plan**: the context nears where past sessions compacted (90% of that point; with no history, 70% of the window). It names `/compact <focus>`, a lower effort when effort is high, and `/model sonnet` on a large model.
- **flaky**: a tool that failed in at least 25% of 10 or more calls over 3 or more sessions, with its last error. Its first call in a session also gives a toast.
- **unused**: an MCP server loaded in 5 or more sessions and never called, with the schema tokens it costs each time.
- **habit**: a tool that put 10k+ tokens into context 4 or more times over 3 or more sessions.
- **gate**: the kind of gap the done gate sent back in 3 or more sessions (failed or stale tests, an unbacked "tests pass", open todos, failing subagent tests, parts of the request Fable found unanswered), counted from the gate's own feedback, live or in past transcripts. `i` drafts a CLAUDE.md rule that would stop it; nothing changes until you send it.
- **memory**: the memory and instruction files the session loads, plus the project's auto-memory folder, checked at start, after each edit of one and at the end of each turn (so a change by Bash, an editor or a git checkout shows too). It finds a memory name used twice, MEMORY.md entries without a file and files without an entry, backticked paths that no longer exist (a `/api/...` route whose top folder is not on disk does not count), files over about 10k tokens, instruction files over 200 lines, instruction files with 5 or more lines of `IMPORTANT`, `MUST`, `NEVER` and the like (a rule that must hold belongs in a hook or deny rule), and lines copied between files.

### Self benchmark

`/agentmon bench` puts this project's sessions without the mod, with it, and with it in the last 7 days side by side: edit prompts checked after their last edit (the last test, lint, typecheck or build of each kind passed), edit prompts that edited one file 4 or more times, the tool error rate, compactions per session, the median time of a prompt that used tools, output tokens per turn, and for the done gate how often it sent Claude back, how often more tool calls followed, how often it found nothing open, and Fable's calls. The mod records each session as it runs and keeps the last 300 per project. `/agentmon learn` adds past sessions from their transcripts; one that ran with the mod counts as with it. A column with fewer than 5 sessions shows `–`. It is a before-and-after comparison, not a controlled test, so it cannot prove cause.

