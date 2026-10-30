---
name: agentmon-config
description: Change AgentMon Live's settings when the user asks, such as hidden pane sections, language, advisor mode or budget, file-size guide, base-branch check, or learning. Use for requests like "hide the usage box", "switch AgentMon to German", "turn off the done gate".
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
| `hiddenSections` | comma-separated: `tasks`, `insights`, `skills`, `advisor`, `changes`, `usage` | `""` |
| `advisorModel` | any model id | `claude-fable-5-1` |
| `advisorMode` | `all` (done gate plus Fable), `gate` (done gate, no model), `off` | `all` |
| `advisorBudget` | most Fable calls per session, `0` for no limit | `30` |
| `sizeLimit` | bytes before Focus suggests splitting a file, `0` for off | `20000` |
| `sizeExclude` | comma-separated globs the size guide skips | `""` |
| `learning` | `on` or `off` | `on` |
| `gitPollMinutes` | minutes between base-branch checks, `0` for off | `5` |
| `gitFetch` | `true` runs `git fetch` for the base before each check | `false` |

The Focus box, Running now and the history always show. They cannot be hidden.

The mod reads its options when it loads. After the edit, ask the user to run `/reload-plugins`, or to start a new session. The user can also change the same options in `/config`.
