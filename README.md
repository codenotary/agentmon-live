<p align="center">
  <img src=".claude-plugin/icon.png" alt="Agent Radar" width="128" height="128">
</p>

<h1 align="center">Agent Radar</h1>

<p align="center">A Claude Code plugin that keeps a live pane beside the chat, so you can see what the session and its subagents are doing while they work.</p>

## What it shows

Top to bottom, in the order you need it:

- **Focus** (always on top, in every view): first what needs you (a tool call waiting for your approval, three failed calls in a row, a failed check, a subagent that failed or reported failing tests, a subagent waiting), then what is worth a look, ranked by importance: a call running far longer than that tool usually takes, a subagent quiet for minutes, the same call failing again and again, context near compaction or one tool result that flooded it, a file read over and over or edited over and over, approvals holding up the turn (with the calls asked most, to turn into allow rules), a low prompt-cache hit rate, focus jumping between many parts of the project, one tool category eating most of the turn, MCP tool schemas taking a large slice of the window. Three show at once (`d` shows all); `i` drafts a question about the first one that has one, `x` puts them away. When nothing needs a look it is one line: where the last turn's time went.
- **Insights:** where the time went, this turn and over the session, as one bar: the model streaming, each tool category (parallel calls share the time), you (calls waiting on an approval) and idle; the slowest calls (approval waits left out); the main context per model request as a sparkline, its growth in the last turn, the prompt-cache hit rate and the biggest tool results (≈ characters / 4); tokens in, cached and out, and the subagents' share; how often the main loop moved between parts of the project this turn, and the files it re-read or re-edited most. With details on, the window's breakdown by category (from a local estimate, no extra request), MCP schema and CLAUDE.md tokens, and model or effort switches.
- **Running now:** each tool call in flight, with who runs it and for how long; when idle, the last call. Running and waiting subagents sit here as cards.
- **Fable advisor:** a second model that reads along and speaks up, as a toast, only when something looks off: a plan that misses something, three errors in a row, or a task reported done with parts left out (after real work: 3 or more tool calls, an edit, or a subagent). It sees your request whole, this turn's tool calls, the files changed (by subagents too), the subagents' outcomes and the observed checks. It never writes code. Each verdict shows as ok or nok; an objection names the evidence it rests on (`↳ Bash npm test`). Its state reads checking, off, plan only, unavailable (the model failed) or budget used, with its own call count and tokens. **Check now** (`c`, or `/agent-radar check`) asks it at once. The same question twice in a row, or the same kind of check within a minute, is not sent again; the same objection twice gives no second toast.
- **Changes and verification:** files edited and read (successful calls only), and the last test, lint, typecheck and build command with its outcome: ok, failed, or unknown when a pipe or a denial hides the exit status. A check run before a later edit is marked stale.
- **Usage:** context, cost and rate limits with their reset times; `unavailable` where the session does not report a value.
- **History** (folds with `h`): main session, tool counts per category with errors, the git / shell / MCP detail tabs (`g` `s` `m`, a click, or `/agent-radar git|shell|mcp`), finished subagent cards and the session log.
- **Details** (`d`) shows cut-off tasks, commands and error texts whole.

Subagent test results are *reported* from the agent's final answer (a failure wins over a pass). Running and waiting subagents are always kept; the last 12 finished ones stay. The status line counts git commands as `git [n]`.

Languages: English (default), German, French, Spanish, Chinese and Japanese.

## Install

Requires Claude Code 2.1.308 or later.

At the prompt of a Claude Code terminal session:

```
/plugin install agent-radar --marketplace vchaindz/agent-radar
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```sh
claude plugin install agent-radar --marketplace vchaindz/agent-radar
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `vchaindz/agent-radar`, then Add plugin.

### Or let Claude set it up

Paste this into a Claude Code session:

```
Install the Claude Code plugin agent-radar from the marketplace vchaindz/agent-radar
(claude plugin install agent-radar --marketplace vchaindz/agent-radar). Then ask me which
language I want (en, de, fr, es, zh, ja) and which advisor mode (all, plan, off), and set
those options for the plugin in my user settings. Tell me to restart Claude Code when done.
```

## Use

| Command | Does |
| --- | --- |
| `/agent-radar` | Opens the pane |
| `/agent-radar advisor` | Turns Fable on or off |
| `/agent-radar check` | Asks Fable now |
| `/agent-radar git`, `shell`, `mcp` | Shows that detail tab |
| `/agent-radar clear` | Resets counters, finished cards, log and Fable's notes; running subagents stay. The word for clear in each language works too: `leeren`, `vider`, `limpiar`, `清空`, `クリア` |

The pane opens by itself at session start when the terminal is wide enough.

## Options

Set in `/config`, under the plugin:

| Option | Values | Default |
| --- | --- | --- |
| `language` | `en`, `de`, `fr`, `es`, `zh`, `ja` | `en` |
| `advisorModel` | any model id | `claude-fable-5-1` |
| `advisorMode` | `all` (plan, error streak and done checks), `plan` (plan check only), `off` | `all` |
| `advisorBudget` | most Fable calls per session; `0` for no limit | `30` |

### Cost

Each Fable check is one small model call (low effort, at most 300 output tokens, about 12,000 characters of material). The done check runs only after real work; the cooldown, duplicate suppression and `advisorBudget` cap the rest. The pane shows Fable's own tokens. Set `advisorMode` to `plan` or `off` to cut calls further.

## Develop

```sh
git clone https://github.com/vchaindz/agent-radar.git
cd agent-radar
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
| `hooks/register.tsx` | Hooks, state and the pane |
| `hooks/insights.ts` | The Focus rules and their thresholds, time and context helpers |
| `hooks/i18n.ts` | All text, one block per language |
| `types/index.d.ts` | State contract |
| `tests/agent-radar.test.tsx` | Tests |

To add a language, add a block to `LANGUAGES` in `hooks/i18n.ts` (the `Strings` type lists every key) and its code to the `language` options in `.claude-plugin/plugin.json`.

## Author

Developed by [vchaindz](https://github.com/vchaindz).

## License

[Apache License 2.0](LICENSE)
