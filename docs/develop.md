# Developing AgentMon Live

```sh
git clone https://github.com/codenotary/agentmon-live.git
cd agentmon-live
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
| `hooks/register.tsx` | Hooks, per-session state and the commands |
| `hooks/done.ts` | The done gate's material, checks and per-turn state |
| `hooks/clock.ts` | The turn clock: where a turn's time went |
| `hooks/release.ts` | Build label, release check and base-branch watch |
| `hooks/web.ts`, `server/web.mjs`, `web/` (builds `server/app.html`, `app.js`, `vendor.js`, `app.css`) | The web view: publisher, local server, page |
| `hooks/render.tsx` | The pane |
| `hooks/insights.ts` | The Focus rules and their thresholds, time and context helpers |
| `hooks/learn.ts`, `hooks/learning.ts`, `hooks/bench.ts` | What is learned across sessions: the pure rules, the store and commands, and the self benchmark |
| `hooks/memcheck.ts` | The memory-file rules |
| `hooks/debuglog.ts` | The per-session debug log: line format, the buffer and the flush |
| `hooks/i18n.ts`, `hooks/lang/*.ts`, `hooks/learn-strings.ts` | All text, one file per language: English in `i18n.ts`, the others in `lang/<code>.ts`, the learning and benchmark text in `learn-strings.ts` |
| `types/index.d.ts` | State contract |
| `tests/*.test.ts(x)` | Tests, one file per part (`bench.test.ts` for the self benchmark) |

### Check the log cleanup

`scripts/prune-check.sh` runs the debug log's delete step on a temp folder and checks what is left. The test kit has no real file system, so this is not part of `claude plugin test`.

### Work on the web view

The server has no build step. The page does: its source is in `web/` (React, Tailwind, Radix), and `npm run build` turns it into the committed `server/app.html`, `app.js`, `app.css` and `vendor.js`, so users install nothing. The libraries sit in `vendor.js`, so a change to the page alone leaves that file as it is, unless it starts using another part of a library. Never edit these files by hand. A test fails if the page is older than its source.

```sh
cd web && npm ci && npm run build
```

To draw the page from the fixture, with no session:

```sh
node server/web.mjs serve 47390 --fixture tests/fixtures/snapshot.json
```

Then open `http://127.0.0.1:47390/`. With that server running, `npm run dev` in `web/` serves the page with hot reload. To watch live motion, `node scripts/web-demo.mjs` posts two changing sessions.

Server tests run with `node --test 'tests/web/*.test.mjs'`, because `claude plugin test` has no Node. For screenshots in light, dark, at phone width, with the palette and with a call's details open, which also report script errors, sideways scrolling, broken navigation (rail links, back button, deep links, the `/` key) and widgets without help:

```sh
npm i --no-save playwright && npx playwright install chromium
node scripts/web-shot.mjs <out dir>
```

`server/kiro.mjs` turns Kiro Crew's crew logs into snapshots, and `server/web.mjs` polls it every 2 seconds (`AGENTMON_KIRO_POLL_MS`) unless it serves a fixture. `foldCrewLog` is the only code that knows the crew log's entry types; it skips the ones it does not know, as that format asks. Tool text is not in the crew log, so `toolText` reads it from the chat's transcript in `~/.kiro/crew/sessions/`, an internal format. `KIROCREW_HOME` points both at another folder: the tests set it, so no test server lists your own chats. `AGENTMON_KIRO_IDLE_MS` is how long a chat outside a turn stays listed. A session the mod posts under the same id wins over the crew log's.

`server/spool.mjs` reads the snapshot folder in that same loop: one `<id>.json` per session, written by `hooks/web.ts` when `AGENTMON_SPOOL` is set. A session there is alive while the server sees its file change, since a VM's clock may differ, and `{"ended":true}` is the session's way to leave: the engine has no call to remove a file. Tested from `tests/web/spool.test.mjs`.

The repo is also a Kiro Crew app: `app.json` (manifest), `kiro/hooks.py` (runs in Kiro Crew's gateway at its start and on enable), `ui/panel.mjs` (the tab and page, an iframe on port 47311; React comes from Kiro Crew's page, so there is no build), `app-registry.json` (lets the repo be added as a registry). The hook writes `~/.claude/agentmon-live/kiro.json` (`AGENTMON_KIRO_FILE` in tests) with the gateway's pid and origins. `kiroHost` in `server/kiro.mjs` reads it: while that pid lives, the server does not stop for lack of sessions and names those origins in `frame-ancestors`. A file, not a flag on `serve`, because a newer session replaces the server and the replacement must know too. Kiro Crew's install copies the whole folder but `node_modules` and `.git`. Check the manifest with Kiro Crew's own code: `AppManifest.from_dict(json).validate()` from `kiro_crew.apps.manifest`, run with the app's bundled Python. `python3 kiro/hooks.py` checks that `node` is found with an empty `PATH`. To try it: `kirocrew app install .`, trust and enable the app, restart Kiro Crew.

`node scripts/readme-shots.mjs` redraws the README's pictures in `docs/web/` from a made-up session, with the same setup plus `ffmpeg`.

The page follows the AgentMon design system (https://claude.ai/artifact/3vpEcGbEDi73UHnbk9dCH3, synced from `frontend/design-system` in `agentmon-teams`), and where the two differ, what `frontend/central` in `agentmon-teams` actually draws: the white ground, the larger rail, the unboxed numbers. `npm run build` also replaces a running server on the default port, because a server otherwise keeps the page it started with until a new session starts. The tokens in `web/src/theme.css` are copied from its `tokens.json`; update them by hand when it changes. Three values differ on purpose, because the system's own README flags them as missing contrast: light success and warning, and dark tertiary text. Strings stay in six languages though the system says English only, because the mod follows the session's language. `toSnapshot` in `hooks/web.ts` is the only code that knows both the state's and the page's shapes.

### See the pane from a script

`claude plugin test` checks what the pane draws but never paints it. `scripts/pane-run.sh` runs a second Claude Code with this repo's mod (cheap model, a throwaway project with one failing and one passing check) in a hidden 220×60 tmux window, drives it from a scenario and saves the real screen:

```sh
scripts/pane-run.sh tests/scenarios/basics.txt      # add --keep to tmux attach afterwards
```

Captures land in `tests/pane-snaps/<scenario>/`: `<name>.txt` (whole screen), `<name>.pane.txt` (the pane alone), `<name>.ansi` (with colours). A scenario is one step per line:

| Step | Does |
| --- | --- |
| `allow <tool rules>` | Tools the session may use without asking, e.g. `Bash(npm test:*) Read` |
| `option <name> <value>` | A mod option for the run, passed in a file named by `AGENTMON_SETTINGS`; the done gate is off unless a scenario sets `option advisorMode all` |
| `prompt <text>`, `cmd /<command>` | Types the line and presses Enter |
| `keys <tmux keys>` | Sends keys, e.g. `Escape` |
| `wait idle [secs]` | Until the turn is over |
| `wait text <regex> [secs]`, `wait gone <regex> [secs]` | Until the screen shows, or no longer shows, a match |
| `sleep <secs>`, `snap <name>` | Pauses; saves the screen |
| `write <file> <text>` | Writes a project file before the session starts (`\n` for a newline) |

`{repo}` in a `prompt` or `cmd` stands for this checkout. The `learned` and `memory` scenarios check what learning shows; they leave a small record per throwaway project in the mod's store.

Each run costs a few calls on the cheap model. Needs `tmux` and `python3`.

To add a language, add `hooks/lang/<code>.ts` exporting a `Strings` block, and register it in `LANGUAGES` in `hooks/i18n.ts` (the `Strings` type lists every key) and its code to the `language` options in `.claude-plugin/plugin.json`.
