<p align="center">
  <img src=".claude-plugin/icon.png" alt="AgentMon Live" width="128" height="128">
</p>

<h1 align="center">AgentMon Live</h1>

<p align="center"><b>See what Claude Code is doing while it works. Catch "done" before it is done.</b></p>

<p align="center">A live pane beside the chat for Claude Code: the session, its tools and subagents at a glance, plus a gate that stops Claude from reporting work as finished when it is not.</p>

<p align="center"><a href="#install">Install</a> · <a href="#the-pane">The pane</a> · <a href="#why-you-want-it">Why you want it</a> · <a href="#the-web-view">The web view</a> · <a href="#make-it-yours">Make it yours</a> · <a href="#more">More</a></p>

## Install

Installing asks no questions, so it works on a small screen too. Everything starts on its defaults.

Requires Claude Code 2.1.308 or later. In a Claude Code session:

```
/plugin install agentmon-live --marketplace codenotary/agentmon-live
```

Answer `y` to add the marketplace and pick a scope. The pane opens by itself when the terminal is wide enough, or with `/agentmon`.

<details>
<summary>From a shell, the desktop app, or let Claude do it</summary>

```sh
claude plugin install agentmon-live --marketplace codenotary/agentmon-live
```

Desktop app: click + next to the prompt box, then Plugins, Add marketplace with `codenotary/agentmon-live`, then Add plugin.

Or paste this into a Claude Code session:

```
Install the Claude Code plugin agentmon-live from the marketplace codenotary/agentmon-live
(claude plugin install agentmon-live --marketplace codenotary/agentmon-live). Tell me to restart
Claude Code when done.
```

</details>

## The pane

```
AGENTMON LIVE · OPUS 5.5 PLANS (high)
╭──────────────────────────────────────────────────────────────╮
│ ● FOCUS · NEEDS ATTENTION                         x: dismiss │
│  FAILED  test npm test                       i: investigate  │
╰──────────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ ● CHANGES & VERIFICATION                                     │
│ 3 edited · 7 read                                            │
│ test         FAILED  npm test                                │
╰──────────────────────────────────────────────────────────────╯
╭──────────────────────────────────────────────────────────────╮
│ ● USAGE                                                      │
│ context   ▕████▋               ▏  19 % 190k / 1000k          │
│ seven_day ▕██████████████▌     ▏  77 % resets 15:00          │
╰──────────────────────────────────────────────────────────────╯
h: history   d: details
```

![AgentMon Live pane, section by section: header, Focus, running call, Insights, done gate, changes and verification, Usage, tool history, subagents and session log](docs/pane-explained.png)

[![AgentMon Live demo: the done gate catches a failing test before Claude stops](docs/demo.png)](https://asciinema.org/a/1270436)

## Why you want it

- **No more "all tests pass" when they don't.** Before Claude stops, the done gate checks what really happened: failed or stale tests, test runs that ran no tests, tests deleted or skipped after an edit (when the task edited tests itself, a review item beside the green run instead), edited packages no test reached, open todos, failing subagents. Anything unfinished goes back to Claude once. Fable, a second model that never writes code, checks that every part of your request got an answer.
- **One glance, not a scroll.** Running tool calls, subagents, edited files and the last test, lint and build results sit in one pane.
- **It tells you when to step in.** Focus raises what needs you: a waiting approval, a failure loop (the same call, or the same error behind different calls), context near compaction, a stuck subagent, a cold prompt cache, a base branch that changed the files you are editing. Press `i` and it drafts the follow-up question for you.
- **Spend less.** See where time and tokens go, which MCP servers you load but never use, and when `/clear` or `/compact` would save you money.
- **It learns your project.** It remembers flaky tools, recurring errors, compaction points, how long turns usually run, heavy habits and what the done gate keeps catching across sessions, and checks your CLAUDE.md and memory files for drift.
- **Room to read it all.** Press `o` for the same session in your browser, with an agent flow chart, a waterfall and every tool call. See [the web view](#the-web-view).
- **Proof, not vibes.** `/agentmon bench` compares your sessions with and without the mod.

Speaks English, German, French, Spanish, Chinese and Japanese, and follows your terminal's language (`LC_ALL`, `LC_MESSAGES`, `LANG`).

## The web view

Press `o`, or run `/agentmon open`. It needs `node` on your `PATH`, which Claude Code does not include; everything else works without it. It is local only, and the one thing it can change is showing or hiding the pane.

One page, with a rail that moves between its sections: [Overview](#overview) · [Tool calls](#tool-calls) · [Verification](#verification) · [Subagents](#subagents) · [Files](#files) · [Session log](#session-log). Each section folds, each widget has an `i` that explains it, and every running session is one click away in the top bar. The pictures show a made-up session.

### Overview

Context, quotas, cache hits, cost and turns measured against their limits or your usual sessions, coloured good or bad. Pins move on a change and shake slightly while the page is connected.

![Top band: dials for context, quotas and cache hits, rulers for cost, turns and time blocked on you, and a bar splitting tokens in and out](docs/web/band.png)

The agent flow shows who started whom, when each subagent handed back, and where a call failed. Dashed lanes are still running; dotted verticals are check runs, such as tests. Drag the strip on top to pick a time, and the waterfall below follows it.

![Agent flow: the main session starts six subagents, one reports failing tests, and two still run](docs/web/flow.png)

The waterfall shows every call in that time, nested under the agent that made it. Beside it are what needs you and what runs now, and below it where each turn's time went.

![Turn waterfall, Events, Running now and where each turn went](docs/web/overview.png)

### Tool calls

Every tool call, sortable, with filters by tool, by agent and for failures. Click a row for its details. Insights lists the slowest calls, the largest results and approvals asked more than once.

![Tool calls table with filters, and Insights](docs/web/calls.png)

### Verification

The last test, type check, lint and build, files changed since the last passing test, and test files whose checks were removed or changed. Tasks sit beside them.

![Verification lights, edited test files and Tasks](docs/web/verification.png)

### Subagents

One row per subagent, worst first. Health dots compare its duration, tokens and errors with the session's other subagents. Click a row for its prompt and calls.

![Subagent table with calls, tokens, cost, errors, files and health dots](docs/web/agents.png)

### Files

Edited files, grouped by whether they still need a test: not tested since the last passing run, then edited before it. Files only read follow, most read first.

![Files: not tested since last green, before the last passing test, and only read](docs/web/files.png)

### Session log

One searchable stream of your prompts, tool calls and subagents. Equal calls merge, and a failed call keeps its own red row. Filter with the buttons, or click a red bar to go to that failure.

![Session log with filter buttons, activity bars and rows](docs/web/log.png)

## Make it yours

Just ask Claude: *"hide the usage box"*, *"switch AgentMon to German"*, *"turn the done gate off"*. It takes effect at once, with no reload. Or edit `pluginConfigs` in `~/.claude/settings.json` yourself; that applies at your next prompt. The options are not in `/config`. See the [guide](docs/guide.md) for all of them.

| Key | Does |
| --- | --- |
| `i` | Draft a question about the top Focus item, or the slowest call |
| `u` | Draft the update commands, when a new release is out |
| `l` | Show the new release's changelog |
| `x` | Put Focus items away |
| `d` | Show long lists and texts whole |
| `h` | Fold the history |
| `a` | Fold out all running subagents, past four |
| `v` | Switch between the calm and classic layout |
| `o` | Open the web view in your browser |
| `p` | Hide the pane; a button above the prompt brings it back |
| `c` | Run the done-gate check now |

Commands: `/agentmon`, `advisor`, `check`, `open`, `learn`, `memory`, `bench`, `debug`, `clear`.

## More

- [Guide](docs/guide.md): every section of the pane, all commands and options, the done gate, the file-size guide, learning, the debug log and the self benchmark.
- [Develop](docs/develop.md): build, test, and see the real pane from a script.

Developed by [vchaindz](https://github.com/vchaindz). [Apache License 2.0](LICENSE).
