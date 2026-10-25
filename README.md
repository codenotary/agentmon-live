# agent-stack

A Claude Code mod that shows a live pane beside the chat:

- the main session's model and effort
- tool calls per category, with errors, context use and compactions
- git commands highlighted: their own row, the last three commands, and a line in the session log
- subagent cards with model, effort, files touched, tokens and test results
- a session log
- Fable, a quiet advisor model that reads along and speaks up (as a toast) when a plan looks incomplete, the session loops on errors, or a finished task seems to skip something

## Install

Load it from a folder:

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$HOME/claude-mods/agent-stack"
```

or start a session with `claude --plugin-dir ~/claude-mods/agent-stack`.

## Use

- `/agent-stack` opens the pane
- `/agent-stack advisor` turns Fable on or off
- `/agent-stack clear` (or `leeren`) resets the counters, cards and log

## Options (`/config`)

| Option | Values | Default |
| --- | --- | --- |
| `language` | `en`, `de` | `en` |
| `advisorModel` | any model id | `claude-fable-5-1` |
| `advisorMode` | `all` (plan, error streak, done checks), `plan` (plan check only), `off` | `all` |

The done check runs only after turns with at least 3 tool calls, to keep advisor cost down.

## Develop

Load the mod once (`claude --plugin-dir .`) before running `tsc`: the engine writes the types `tsconfig.json` extends into `.claude-plugin/types/`, which git ignores.

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc --noEmit -p .
```

To add a language, add a block to `LANGUAGES` in `hooks/i18n.ts` and its code to the `language` options in `.claude-plugin/plugin.json`.
