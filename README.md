<p align="center">
  <img src=".claude-plugin/icon.png" alt="Agent Radar" width="128" height="128">
</p>

<h1 align="center">Agent Radar</h1>

<p align="center">A Claude Code plugin that keeps a live pane beside the chat, so you can see what the session and its subagents are doing while they work.</p>

## What it shows

Top to bottom, in the order you need it:

- **Needs attention:** a tool call waiting for your approval, three failed calls in a row, a failed check, a subagent that failed or reported failing tests, a subagent waiting. Shown only when there is something.
- **Running now:** each tool call in flight, with who runs it and for how long; when idle, the last call. Running and waiting subagents sit here as cards.
- **Fable advisor:** a second model that reads along and speaks up, as a toast, only when something looks off: a plan that misses something, three errors in a row, or a task reported done with parts left out. It never writes code. Each verdict shows as ok or nok.
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

### Cost

Each Fable check is one small model call (low effort, at most 300 output tokens). The done check runs only after turns with at least 3 tool calls. Set `advisorMode` to `plan` or `off` to cut calls further.

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
| `hooks/i18n.ts` | All text, one block per language |
| `types/index.d.ts` | State contract |
| `tests/agent-radar.test.tsx` | Tests |

To add a language, add a block to `LANGUAGES` in `hooks/i18n.ts` (the `Strings` type lists every key) and its code to the `language` options in `.claude-plugin/plugin.json`.

## Author

Developed by [vchaindz](https://github.com/vchaindz).

## License

[Apache License 2.0](LICENSE)
