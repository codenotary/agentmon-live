# AgentMon Live

Claude Code mod (plugin): a live pane beside the chat, a done gate on Stop, learning across sessions, and a self benchmark. User docs: `README.md` (pitch, install, keys) and `docs/guide.md` (full reference); keep both in step with every user-visible change. Developer docs: `docs/develop.md`.

## Check before you report done

```sh
claude plugin validate .
claude plugin test .
npx -p typescript tsc --noEmit -p .
node --test 'tests/web/*.test.mjs'
```

After a change in `web/`, also run `node scripts/web-shot.mjs <out dir>` (setup in `docs/develop.md`). It is the only check that runs the page in a browser.

`tsc` has one known error in `tests/advisor.test.tsx` (`{ isAnswered: false; reason: "aborted" }` in the unanswered-Fable test); anything else is new.

## Layout

- `hooks/register.tsx`: every hook, the per-session state, commands (`/agentmon <arg>`).
- `hooks/clock.ts`: the turn clock (where a turn's time went). `hooks/release.ts`: build, release check, base-branch watch. `hooks/done.ts`: the per-turn state (`Turn`), the done gate's material and checks (`classic.Stop` calls it).
- `hooks/options.ts`: reads the options from `settings.json` at session start, each prompt and after Claude edits a `settings.json`. No `userConfig` in the manifest on purpose: it opens a dialog on install.
- `hooks/render.tsx`: the pane.
- `hooks/web.ts`: the web view's publisher (`toSnapshot`, the post loop, `openBrowser`). `server/web.mjs`: its Node server, run detached so it outlives a session. `server/app.html`, `app.js`, `vendor.js`, `app.css`: the page, built from `web/` and committed; never edit them by hand. `server/web.mjs` serves them from a fixed list.
- `web/`: the page's source (React, Tailwind, Radix). `web/src/waterfall.ts`, `web/src/events.ts` and `web/src/format.ts` are pure and tested from `tests/web/page.test.mjs`; `web/src/store.ts` holds the page's state; `web/src/panels/` the panels. After a change in `web/`, run `cd web && npm ci && npm run build`; a test fails on a stale page. Users install nothing.
- `hooks/insights.ts`: Focus rules and thresholds.
- `hooks/learn.ts` (pure rules, `parseTranscript`), `hooks/learning.ts` (store, `/agentmon learn|memory|bench`), `hooks/bench.ts` (self benchmark: per-prompt numbers, transcript parse, report).
- `hooks/gate.ts`, `hooks/advisor.ts`: done-gate facts and the Fable call.
- `hooks/testreview.ts`: spots test-file edits that take checks out, for a review item beside the green run; fixtures in `tests/fixtures/weakened-tests.ts`.
- `hooks/i18n.ts` (English), `hooks/lang/<code>.ts` (de, fr, es, zh, ja), `hooks/learn-strings.ts` (learning and bench text, all six).
- `skills/agentmon-config/SKILL.md`: tells Claude how to change the options from chat; keep its table in step with `applyOptions` in `hooks/options.ts`.
- `types/index.d.ts`: state contract. `SessionRecord`, `Bench`, `BenchRow`, `Learned` live here.
- `tests/*.test.ts(x)`: one file per part; transcript fixtures in `tests/fixtures/`. `tests/web/*.test.mjs`: the server, run with `node --test`.

## Rules the loader and the code rely on

- `$` (the `EngineInterface`) may only be passed to functions declared at the top level of the file, or imported. A closure (`const f = async ($) => …` inside `register`) fails to load: "$ is passed to … which is not a function declared at the top of this file". Pass closure state as arguments instead.
- In `web/src`, tool text only goes in as React text, never as raw HTML: a test forbids the HTML-injection APIs there. The page loads nothing from another origin.
- Hooks fail open: wrap with `.catch(($, e, next) => failOpen(...))`. The mod watches; it never holds up the session.
- Every user-visible string goes in all six languages.
- Store values from older versions must still load: add new fields as optional, or default them in a `shape…` function (`shapeLearned`, `shapeInsights`).
- A known limit gets a comment `// shortcut: <the limit>, <when to upgrade>`.
- In transcripts, Stop-hook feedback is a `user` entry with `isMeta: true` and text starting `Stop hook feedback:`. The done gate's text starts with `gateReason('')`'s first line. Resumed sessions repeat entries; dedupe by `uuid` and `message.id`.

## Release

A PR gets its new version when it merges, not per commit. At merge, bump `version` in both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (the marketplace reads the latter). Commits on a branch leave the version alone and name no version in their subject.
