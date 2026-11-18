---
name: agentmon-view
description: Make, change, switch or delete a custom AgentMon Live web view when the user asks, such as "make a cost view", "hide the log in the web view", "orange accent in the web view", "switch the web view back to default". Use for any request to change how the AgentMon web page looks or what it shows.
---

# AgentMon Live web views

A view is a JSON file in `~/.claude/agentmon-live/views/<name>.json`. The name is `a-z`, `0-9` and `-`, at most 40 characters. The file is at most 64 KB. The web page reads the folder every few seconds; no restart is needed.

- **Switch:** write the view's name to `~/.claude/agentmon-live/views/active` (no newline needed). Write an empty file to go back to the default page. Open pages follow at once.
- **List:** list the folder. **Copy:** copy a file under a new name. **Delete:** remove the file, and empty `active` if it named it.
- Change a view by editing its file. Read it first, and keep what the user did not ask to change.

## Format

```json
{
  "title": "Cost focus",
  "theme": { "dark": { "--signal": "#f97316" }, "light": { "--signal": "#c2410c" } },
  "sections": [
    { "id": "cost", "label": "Cost", "blocks": [
      { "type": "Row", "children": [
        { "type": "Stat", "label": "Spend", "value": "/usage/usd", "format": "usd" },
        { "type": "Stat", "label": "Running", "value": "/active", "format": "count" } ] },
      { "panel": "Calls" } ] },
    { "id": "calls", "hidden": true },
    { "id": "log", "hidden": true }
  ]
}
```

### Sections

- Built-in ids: `overview`, `calls`, `verification`, `agents`, `files`, `log`. Listed without `blocks`, a built-in section shows as usual; `label` renames it; `hidden: true` hides it.
- Sections show in the order listed. Built-in sections that are not listed come after them.
- Any other id (`a-z0-9-`) is a custom section. It needs `label` and `blocks`.
- Giving a built-in section `blocks` replaces what it shows.
- Each panel once per view. When a section embeds a panel that a built-in section shows, hide that built-in section (`{ "id": "calls", "hidden": true }`): a panel drawn twice repeats its element ids, and links and the `/` search key go to the wrong copy. Built-in panels: `overview` has Instruments, Flow, Waterfall, TurnClock, Events, Running and Steps; `calls` has Calls and Insights; `verification` has Checks and Tasks; `agents` has Agents; `files` has Files; `log` has Log.

### Blocks

- `{ "panel": "<name>" }`: one of the page's panels: `Instruments`, `Flow`, `Waterfall`, `TurnClock`, `Events`, `Running`, `Steps`, `Calls`, `Insights`, `Checks`, `Tasks`, `Agents`, `Files`, `Log`.
- `{ "type": "Row", "children": [...] }` side by side; `Column` stacked; `Card` with an optional `title` draws a box around its children.
- `{ "type": "Text", "text": "..." }`.
- `{ "type": "Stat", "label": "...", "value": "<pointer>", "format": "usd" | "count" | "dur" | "pct" }`. `count` of a list is its length; `dur` takes milliseconds.
- `{ "type": "List", "label": "...", "items": "<pointer to a list>", "field": "<pointer inside each item>", "max": 10 }`.
- `{ "type": "Sparkline", "label": "...", "points": "<pointer to a list>", "field": "<pointer to a number in each item>" }`.

Nesting stops at 6 levels and 24 children per block. Anything else is left out.

### Pointers

JSON pointers into the session's snapshot (`WebSnapshot` in the plugin's `types/index.d.ts`). Useful ones:

| Pointer | What |
| --- | --- |
| `/usage/usd` | session cost so far |
| `/usage/ctxPct`, `/usage/ctxTokens` | context use |
| `/usage/rate` | quota list (`kind`, `pct`) |
| `/turnCount` | prompts answered |
| `/turns` | recent turns; `wallMs` per turn for a Sparkline |
| `/active` | tool calls running now (`tool`, `what`, `who`) |
| `/calls` | recent tool calls (`what`, `result`, `who`) |
| `/trace` | every tool call with its time (`tool`, `what`, `ms` once done) |
| `/agents` | subagents (`type`, `task`, `status`) |
| `/main/model` | the model |
| `/session/cwd`, `/session/branch` | where the session runs |

### Theme

`theme.light` and `theme.dark` map colour tokens to colours. Tokens: `--page`, `--surface`, `--surface-1`, `--surface-2`, `--surface-3`, `--header`, `--line`, `--line-soft`, `--line-input`, `--ink`, `--heading`, `--ink-2`, `--ink-3`, `--signal` (the accent), `--signal-bright`, `--signal-soft`, `--good`, `--warn`, `--bad`, `--good-soft`, `--warn-soft`, `--bad-soft`, `--info`, `--info-line`, `--ramp-1` to `--ramp-5`, `--ramp-other`. Values: `#hex`, `rgb()`, `hsl()` or `oklch()` only. Keep text readable: give both themes, with enough contrast against `--page` and `--surface`.

After writing, tell the user the view's name and that the page has switched to it. A file the page cannot read shows in its view menu with the error.
