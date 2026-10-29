---
name: agentmon-config
description: Change AgentMon Live's settings when the user asks, such as the pane's default view, hidden pane sections, language, advisor mode or budget, file-size guide, or learning. Use for requests like "hide the usage box", "open the pane in flow view", "switch AgentMon to German", "turn off the done gate".
---

# Changing AgentMon Live's settings

The settings are in `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`), under:

```json
"pluginConfigs": {
  "agentmon-live@agentmon-live": {
    "options": { "hiddenSections": "usage, skills" }
  }
}
```

Edit only this plugin's `options` object. Leave all other keys as they are. Create `pluginConfigs` or the plugin entry if it is missing. Leave out an option to keep its default.

| Option | Values | Default |
| --- | --- | --- |
| `language` | `en`, `de`, `fr`, `es`, `zh`, `ja` | `en` |
| `defaultView` | `radar` (the dashboard) or `flow` | `radar` |
| `hiddenSections` | comma-separated: `tasks`, `insights`, `skills`, `advisor`, `changes`, `usage` | `""` |
| `advisorModel` | any model id | `claude-fable-5-1` |
| `advisorMode` | `all` (done gate plus Fable), `gate` (done gate, no model), `off` | `all` |
| `advisorBudget` | most Fable calls per session, `0` for no limit | `30` |
| `sizeLimit` | bytes before Focus suggests splitting a file, `0` for off | `20000` |
| `sizeExclude` | comma-separated globs the size guide skips | `""` |
| `learning` | `on` or `off` | `on` |

The Focus box, Running now and the history always show. They cannot be hidden.

The mod reads its options when it loads. After the edit, ask the user to run `/reload-plugins`, or to start a new session. The user can also change the same options in `/config`.

For a change that lasts only for this session, no edit is needed. Ask the user to press `v` in the pane, or to run `/agentmon flow` or `/agentmon radar`.
