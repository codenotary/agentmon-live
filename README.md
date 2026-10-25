<p align="center">
  <img src=".claude-plugin/icon.png" alt="Agent Radar" width="128" height="128">
</p>

<h1 align="center">Agent Radar</h1>

<p align="center">A Claude Code plugin that keeps a live pane beside the chat, so you can see what the session and its subagents are doing while they work.</p>

## What it shows

- **Main session:** model and effort level.
- **Tools:** calls per category (git, read, search, web, shell, edit, agents, skills, browser, computer use), with error counts, context use and compactions.
- **Git:** git commands get their own highlighted row, the last three commands with who ran them, and a line in the session log. The status line counts them as `git [n]`.
- **Subagents:** one card per subagent with model, effort, task, files touched, tokens and test result (PASS/FAIL read from its final answer).
- **Session log:** subagent starts and finishes, test results, git commands and compactions.
- **Fable advisor:** a second model that reads along and speaks up, as a toast, only when something looks off: a plan that misses something, three errors in a row, or a task reported done with parts left out. It never writes code.

Languages: English (default), German, French, Spanish, Chinese and Japanese.

## Install

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
| `/agent-radar clear` | Resets counters, cards and log. The word for clear in each language works too: `leeren`, `vider`, `limpiar`, `清空`, `クリア` |

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
