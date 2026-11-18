# Custom web views, A2UI-style (plan)

## Context
A2UI (a2ui.org) lets an agent describe UI as declarative JSON: data, not code. A client renders that JSON only from a catalog of components it trusts. We borrow that idea for the web view and nothing more: no `@a2ui/*` dependency and no protocol compatibility. A user asks Claude in chat ("make a cost-focused view, hide the log, orange accent"). Claude writes a JSON view file. The page renders it from our own catalog. Views are saved, reloaded and switched on demand. Our schema keeps A2UI's model: a catalog, a component tree, and JSON-pointer data binding.

## View file
`~/.claude/agentmon-live/views/<name>.json`. The name matches `[a-z0-9-]{1,40}`. Max size 64 KB. `views/active` holds the name chosen from chat (empty or missing: the default page).

```json
{
  "title": "Cost focus",
  "theme": { "dark": { "--signal": "#f97316" }, "light": { "--signal": "#c2410c" } },
  "sections": [
    { "id": "overview" },
    { "id": "cost", "label": "Cost", "blocks": [
      { "type": "Row", "children": [
        { "type": "Stat", "label": "Spend", "value": "/usage/usd", "format": "usd" },
        { "type": "Stat", "label": "Context", "value": "/usage/ctxPct", "format": "pct" } ] },
      { "panel": "Calls" } ] },
    { "id": "calls", "hidden": true },
    { "id": "log", "hidden": true }
  ]
}
```

- Built-in section ids: `overview`, `calls`, `verification`, `agents`, `files`, `log`. A built-in section with no `blocks` renders as it does today. Sections are ordered as listed. Built-in sections that are not listed come after the listed ones, so a view never loses data. `hidden: true` hides a section.
- Any other id is a custom section. It needs `label` and `blocks`, gets a generic icon, and has no `g` key.
- `blocks` catalog:
  - `{ "panel": <name> }` embeds an existing panel: Instruments, Flow, Waterfall, TurnClock, Events, Running, Steps, Calls, Insights, Checks, Tasks, Agents, Files, Log.
  - Widgets: `Row`, `Column`, `Card` (`title`, `children`), `Text` (`text`), `Stat` (`label`, `value`, `format`), `List` (`label`, `items`, `field`, `max`), `Sparkline` (`label`, `points`).
  - Bindings are JSON pointers (RFC 6901) into `WebSnapshot` (`types/index.d.ts`). A pointer that finds nothing shows a dash.
  - Formats: `usd`, `count`, `dur`, `pct`, reusing `web/src/format.ts`.
  - Depth is capped at 6 and children at 24 per block; the rest is dropped.
- `theme` only accepts token names that exist in `web/src/theme.css`. Values must be colours (`#hex`, `rgb()`, `hsl()`, `oklch()`), checked by regex. The page builds a constructed stylesheet from the checked tokens, with the same selectors as `theme.css`, so the `auto` theme follows the system. No other CSS is accepted.
- All user text is rendered as React text only, under the existing rule that forbids HTML-injection APIs in `web/src`.

## Changes
1. **`server/views.mjs`** (new): `readViews(dir)` lists the folder and checks name, size and JSON parse. A broken file is reported as `{ name, error }`, not dropped. It returns `{ views, active, hash }`.
2. **`server/web.mjs`**: call `readViews` from the sweep `setInterval`; when the hash changes, `broadcast('views', …)`. Send the current views on `/events` connect. No write route: Claude writes the files with its own tools.
3. **`types/index.d.ts`**: `WebView`, `ViewSection`, `ViewBlock`, `ViewList`.
4. **`web/src/format.ts`**: `usdText` moves here from `Instruments.tsx`.
5. **`web/src/view.ts`** (new, pure): `pick`, `shapeView`, `orderSections`, `themeCss`, `formatValue`. Tested in `tests/web/page.test.mjs`.
6. **`web/src/ViewBlocks.tsx`** (new): renders the widget tree and panel embeds, reusing `Panel`, `Empty` and `Sparkline`.
7. **`web/src/store.ts`**: `views`, `viewName`, `setView` (localStorage key `agentmon-live-view`). On the SSE `views` event, when the server's `active` changes, the page follows it, so a switch from chat takes effect live.
8. **`web/src/App.tsx`, `Nav.tsx`**: sections go through `orderSections`; `Part` renders `ViewBlocks` for a section with `blocks`; the theme sheet is applied next to the `data-theme` effect.
9. **Picker**: a view menu in `TopBar.tsx` and a "Views" group in `Palette.tsx` ("Default" plus each view; a broken one shows its error). Strings in all six languages.
10. **`skills/agentmon-view/SKILL.md`** (new): file location, schema, catalog, tokens, main `WebSnapshot` paths, and how to list, switch, copy and delete views.
11. **Docs**: `README.md`, `docs/guide.md`, `docs/develop.md`.
12. **Build**: `cd web && npm ci && npm run build`, then commit `server/app.*`.

Views live with the server, so the Codex and Kiro Crew pages get them too; only the skill is Claude-only.

## Verification
- `tests/web/views.test.mjs`: valid, oversized, bad-name and broken-JSON files; the `views` SSE event on connect and on change.
- `tests/web/page.test.mjs`: `pick`, `shapeView` (unknown token, non-colour value, unknown panel, too deep), `orderSections`, `themeCss`, `formatValue`.
- The CLAUDE.md check set, and `node scripts/web-shot.mjs <out>` with a sample view.
- End to end: ask Claude "make a view that shows only cost and tool calls, orange accent". The file appears, the page switches, the picker goes back to Default, and a reload keeps the choice.

Skipped: saving from the page, per-project views, Codex/Kiro skill copies, and A2UI protocol compatibility.
