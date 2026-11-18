// src/format.ts
function dur(ms) {
  const s = Math.max(0, Math.round((ms ?? 0) / 1e3));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
}
var callTime = (ms) => ms === void 0 ? "" : Math.round(ms) < 1e3 ? `${Math.round(ms)} ms` : dur(ms);
var hhmm = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
var usdText = (usd) => `$${usd.toFixed(2)}`;
var kilo = (n) => n === void 0 ? "0" : n >= 999500 ? `${(n / 1e6).toFixed(1)}M` : n >= 99950 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
var levelOf = (pct) => pct === void 0 ? "" : pct >= 80 ? "bad" : pct >= 60 ? "warn" : "good";

// src/view.ts
var PANELS = ["Instruments", "Flow", "Waterfall", "TurnClock", "Events", "Running", "Steps", "Calls", "Insights", "Checks", "Tasks", "Agents", "Files", "Log"];
var TOKENS = ["--page", "--surface", "--surface-1", "--surface-2", "--surface-3", "--header", "--line", "--line-soft", "--line-input", "--ink", "--heading", "--ink-2", "--ink-3", "--signal", "--signal-bright", "--signal-soft", "--good", "--warn", "--bad", "--good-soft", "--warn-soft", "--bad-soft", "--info", "--info-line", "--ramp-1", "--ramp-2", "--ramp-3", "--ramp-4", "--ramp-5", "--ramp-other"];
var BUILT_IN = ["overview", "calls", "verification", "agents", "files", "log"];
var FORMATS = ["usd", "count", "dur", "pct", "time"];
var AGGS = ["sum", "avg", "min", "max", "count"];
var COLOUR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch)\([\d.,%/\s+a-z-]*\))$/i;
var MAX_DEPTH = 6;
var MAX_CHILDREN = 24;
var MAX_TEXT = 200;
var MAX_COLUMNS = 8;
var MAX_TESTS = 4;
var MAX_ROWS = 50;
var ID = /^[a-z0-9-]{1,40}$/;
function pick(from, pointer2) {
  if (pointer2 === "") return from;
  if (!pointer2.startsWith("/")) return void 0;
  let at = from;
  for (const raw of pointer2.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (at === null || typeof at !== "object" || !Object.hasOwn(at, key)) return void 0;
    at = at[key];
  }
  return at;
}
function formatValue(v, format2) {
  if (Array.isArray(v)) return format2 === "count" ? kilo(v.length) : "\u2014";
  if (typeof v === "number" && Number.isFinite(v)) {
    if (format2 === "usd") return usdText(v);
    if (format2 === "count") return kilo(v);
    if (format2 === "dur") return callTime(v);
    if (format2 === "pct") return `${Math.round(v)}%`;
    if (format2 === "time") return new Date(v).toDateString() === (/* @__PURE__ */ new Date()).toDateString() ? hhmm(v) : `${new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${hhmm(v)}`;
    return String(Math.abs(v) >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(2)));
  }
  return typeof v === "string" || typeof v === "boolean" ? String(v) : "\u2014";
}
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isNumber = (v) => typeof v === "number" && Number.isFinite(v);
var text = (v) => typeof v === "string" ? v.slice(0, MAX_TEXT) : "";
var pointer = (v) => typeof v === "string" && (v === "" || v.startsWith("/")) ? v.slice(0, MAX_TEXT) : void 0;
var scalar = (v) => typeof v === "string" ? v.slice(0, MAX_TEXT) : typeof v === "boolean" || isNumber(v) ? v : void 0;
var number = (v) => isNumber(v) ? v : void 0;
var format = (v) => FORMATS.includes(v) ? v : void 0;
var agg = (v) => AGGS.includes(v) ? v : void 0;
var compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== void 0));
function sourceRows(s, rows) {
  const v = pick(s, rows);
  return Array.isArray(v) ? v : isObject(v) ? Object.entries(v).map(([key, value]) => ({ key, value })) : [];
}
function passes(item, t) {
  const v = pick(item, t.field);
  return (t.is === void 0 || v === t.is) && (t.not === void 0 || v !== t.not) && (t.above === void 0 || isNumber(v) && v > t.above) && (t.below === void 0 || isNumber(v) && v < t.below);
}
var filtered = (s, rows, where) => sourceRows(s, rows).filter((item) => (where ?? []).every((t) => passes(item, t)));
function fold(items, field, how) {
  if (how === "count") return items.length;
  const n = items.map((i) => pick(i, field ?? "")).filter(isNumber);
  if (how === "sum") return n.reduce((a, b) => a + b, 0);
  if (n.length === 0) return void 0;
  return how === "avg" ? n.reduce((a, b) => a + b, 0) / n.length : how === "min" ? Math.min(...n) : Math.max(...n);
}
function queryRows(s, q, columns) {
  const items = filtered(s, q.rows, q.where);
  let rows = items.map((row) => ({ row }));
  if (q.group !== void 0) {
    const groups = /* @__PURE__ */ new Map();
    for (const item of items) {
      const value = pick(item, q.group);
      const key = isNumber(value) ? String(value) : formatValue(value, void 0);
      const list = groups.get(key);
      if (list) list.push(item);
      else groups.set(key, [item]);
    }
    rows = [...groups].map(([key, list]) => ({ row: { key, count: list.length }, items: list }));
  }
  const cell = (r, c) => c.agg ? fold(r.items ?? [r.row], c.field, c.agg) : pick(r.row, c.field ?? (r.items ? "/key" : ""));
  const by = columns.find((c) => c.label === q.sort) ?? (q.sort?.startsWith("/") ? { label: "", field: q.sort } : void 0);
  if (by) {
    const turn = q.desc ? -1 : 1;
    rows = rows.map((r) => ({ r, v: cell(r, by) })).sort((a, b) => a.v === void 0 || a.v === null ? 1 : b.v === void 0 || b.v === null ? -1 : isNumber(a.v) && isNumber(b.v) ? (a.v - b.v) * turn : String(a.v).localeCompare(String(b.v)) * turn).map((x) => x.r);
  }
  return rows.slice(0, q.max ?? 10).map((r) => columns.map((c) => cell(r, c)));
}
function statValue(s, b) {
  return b.agg ? fold(filtered(s, b.value, b.where), b.field, b.agg) : pick(s, b.value);
}
function barRows(s, b) {
  const isGrouped = b.group !== void 0;
  const columns = [{ label: "name", field: b.name ?? "/key" }, { label: "value", field: b.value ?? (isGrouped ? void 0 : "/value"), agg: b.agg ?? (isGrouped ? "count" : void 0) }];
  return queryRows(s, { ...b, sort: b.sort ?? "value", desc: b.sort === void 0 ? true : b.desc }, columns).flatMap(([name, value]) => isNumber(value) ? [[formatValue(name, void 0), value]] : []);
}
function toneOf(v, b, isPercent = b.format === "pct") {
  if (!isNumber(v)) return "";
  if (b.warnAt === void 0 && b.badAt === void 0) return isPercent ? levelOf(v) : "";
  return b.badAt !== void 0 && v >= b.badAt ? "bad" : b.warnAt !== void 0 && v >= b.warnAt ? "warn" : "good";
}
function shapeTests(raw) {
  if (!Array.isArray(raw)) return void 0;
  const tests = raw.slice(0, MAX_TESTS).flatMap((t) => {
    const field = isObject(t) ? pointer(t.field) : void 0;
    return isObject(t) && field !== void 0 ? [compact({ field, is: scalar(t.is), not: scalar(t.not), above: number(t.above), below: number(t.below) })] : [];
  });
  return tests.length ? tests : void 0;
}
function shapeQuery(raw) {
  const rows = pointer(raw.rows);
  if (rows === void 0) return void 0;
  const max = isNumber(raw.max) && raw.max >= 1 ? Math.min(Math.floor(raw.max), MAX_ROWS) : void 0;
  return compact({ rows, where: shapeTests(raw.where), group: pointer(raw.group), sort: text(raw.sort) || void 0, desc: raw.desc === true ? true : void 0, max });
}
var levels = (raw) => ({ warnAt: number(raw.warnAt), badAt: number(raw.badAt) });
function shapeBlock(raw, depth, at, notes) {
  const drop = (kind, detail) => {
    notes.push(compact({ at, kind, detail: detail === void 0 ? void 0 : String(detail).slice(0, 60) }));
  };
  if (!isObject(raw)) return drop("block");
  if (depth > MAX_DEPTH) return drop("limit", "depth");
  if ("panel" in raw) return PANELS.includes(raw.panel) ? { panel: raw.panel } : drop("panel", raw.panel);
  const children = () => shapeBlocks(raw.children, depth + 1, `${at}/children`, notes);
  const need = (name, v) => v === void 0 ? drop("pointer", name) : v;
  switch (raw.type) {
    case "Row":
    case "Column":
      return { type: raw.type, children: children() };
    case "Card":
      return { type: "Card", title: text(raw.title), children: children() };
    case "Text":
      return { type: "Text", text: text(raw.text) };
    case "Stat": {
      const value = need("value", pointer(raw.value));
      return value === void 0 ? void 0 : compact({ type: "Stat", label: text(raw.label), value, field: pointer(raw.field), agg: agg(raw.agg), where: shapeTests(raw.where), format: format(raw.format), foot: text(raw.foot) || void 0, ...levels(raw) });
    }
    case "List": {
      const items = need("items", pointer(raw.items));
      const max = isNumber(raw.max) && raw.max >= 1 ? Math.min(Math.floor(raw.max), MAX_ROWS) : 10;
      return items === void 0 ? void 0 : { type: "List", label: text(raw.label), items, field: pointer(raw.field), max };
    }
    case "Sparkline": {
      const points = need("points", pointer(raw.points));
      return points === void 0 ? void 0 : compact({ type: "Sparkline", label: text(raw.label), points, field: pointer(raw.field), format: format(raw.format) });
    }
    case "Table": {
      const query = need("rows", shapeQuery(raw));
      const listed = Array.isArray(raw.columns) ? raw.columns : [];
      if (listed.length > MAX_COLUMNS) drop("limit", "columns");
      const columns = listed.slice(0, MAX_COLUMNS).flatMap((c) => isObject(c) ? [compact({ label: text(c.label), field: pointer(c.field), agg: agg(c.agg), format: format(c.format) })] : []);
      if (query && columns.length === 0) return drop("pointer", "columns");
      return query ? { type: "Table", label: text(raw.label), columns, ...query } : void 0;
    }
    case "Bars": {
      const query = need("rows", shapeQuery(raw));
      return query ? compact({ type: "Bars", label: text(raw.label), name: pointer(raw.name), value: pointer(raw.value), agg: agg(raw.agg), format: format(raw.format), ...query }) : void 0;
    }
    case "Gauge":
    case "Meter": {
      const value = need("value", pointer(raw.value));
      const max = isNumber(raw.max) && raw.max > 0 ? raw.max : void 0;
      return value === void 0 ? void 0 : compact({ type: raw.type, label: text(raw.label), value, max, format: format(raw.format), ...levels(raw) });
    }
    default:
      return drop("block", raw.type);
  }
}
function shapeBlocks(raw, depth, at, notes) {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_CHILDREN) notes.push({ at, kind: "limit", detail: "children" });
  return raw.slice(0, MAX_CHILDREN).map((b, i) => shapeBlock(b, depth, `${at}/${i}`, notes)).filter((b) => b !== void 0);
}
function shapeTokens(raw, at, notes) {
  if (!isObject(raw)) return void 0;
  const isKept = ([k, v]) => TOKENS.includes(k) && typeof v === "string" && COLOUR.test(v.trim());
  for (const [k] of Object.entries(raw).filter((e) => !isKept(e))) notes.push({ at, kind: "colour", detail: k.slice(0, 60) });
  const kept = Object.entries(raw).filter(isKept);
  return kept.length ? Object.fromEntries(kept.map(([k, v]) => [k, v.trim()])) : void 0;
}
function shapeView(raw) {
  if (!isObject(raw)) return { sections: [] };
  const notes = [];
  const seen = /* @__PURE__ */ new Set();
  const sections = [];
  const listed = Array.isArray(raw.sections) ? raw.sections : [];
  if (listed.length > MAX_CHILDREN) notes.push({ at: "sections", kind: "limit", detail: "sections" });
  for (const [i, s] of listed.slice(0, MAX_CHILDREN).entries()) {
    if (!isObject(s) || typeof s.id !== "string" || !ID.test(s.id) || seen.has(s.id)) {
      notes.push(compact({ at: `sections/${i}`, kind: "section", detail: isObject(s) && typeof s.id === "string" ? s.id.slice(0, 60) : void 0 }));
      continue;
    }
    seen.add(s.id);
    const section = { id: s.id };
    if (typeof s.label === "string") section.label = text(s.label);
    if (s.hidden === true) section.hidden = true;
    if (Array.isArray(s.blocks)) section.blocks = shapeBlocks(s.blocks, 1, `${s.id}/blocks`, notes);
    if (!BUILT_IN.includes(s.id) && !section.hidden && !section.blocks?.length) notes.push({ at: `sections/${i}`, kind: "section", detail: s.id });
    sections.push(section);
  }
  const theme = isObject(raw.theme) ? { light: shapeTokens(raw.theme.light, "theme/light", notes), dark: shapeTokens(raw.theme.dark, "theme/dark", notes) } : void 0;
  return compact({ title: text(raw.title) || void 0, theme: theme?.light || theme?.dark ? theme : void 0, sections, notes: notes.length ? notes : void 0 });
}
function unresolved(view, s) {
  const notes = [];
  const walk = (b, section) => {
    const miss = (detail) => void notes.push({ at: `${section}/${"type" in b ? b.type : ""} ${"label" in b ? b.label : ""}`.trimEnd(), kind: "empty", detail: detail.slice(0, 60) });
    const fields = (rows2, list) => {
      for (const f of list) if (f && rows2.length > 0 && !rows2.some((r) => pick(r, f) !== void 0)) miss(f);
    };
    if ("panel" in b) return;
    if ("children" in b) return b.children.forEach((c) => walk(c, section));
    if (b.type === "Text") return;
    const from = b.type === "List" ? b.items : b.type === "Sparkline" ? b.points : b.type === "Table" || b.type === "Bars" ? b.rows : b.value;
    if (pick(s, from) === void 0) return miss(from);
    const rows = sourceRows(s, from);
    if (b.type === "List" || b.type === "Sparkline" || b.type === "Stat") return fields(rows, [b.field]);
    if (b.type === "Table") return fields(rows, [b.group, ...b.columns.filter((c) => c.agg || b.group === void 0).map((c) => c.field)]);
    if (b.type === "Bars") return fields(rows, [b.group, b.value, b.group === void 0 ? b.name : void 0]);
  };
  for (const section of view.sections) section.blocks?.forEach((b) => walk(b, section.id));
  return notes;
}
function notesOf(view, s, isShipped) {
  return view && s !== void 0 ? [...view.notes ?? [], ...isShipped ? [] : unresolved(view, s)] : [];
}
var pctOf = (v, top) => isNumber(v) ? Math.max(0, Math.min(100, Math.round(v / top * 100))) : void 0;
function orderSections(builtIn, view, custom) {
  if (!view) return [...builtIn];
  const named = new Set(view.sections.map((s) => s.id));
  const listed = view.sections.flatMap((s) => {
    if (s.hidden) return [];
    const base = builtIn.find((b) => b.id === s.id);
    if (!base && !s.blocks?.length) return [];
    const x = base ?? custom(s.id, s.label || s.id);
    return [{ ...x, ...s.label ? { label: s.label } : {}, ...s.blocks?.length ? { blocks: s.blocks } : {} }];
  });
  return [...listed, ...builtIn.filter((b) => !named.has(b.id))];
}
function viewOf(list, name) {
  const entry = name ? list.views.find((v) => v.name === name) : void 0;
  return entry?.view === void 0 ? void 0 : shapeView(entry.view);
}
var rule = (selector, tokens) => tokens ? `${selector}{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(";")}}` : "";
function themeCss(theme) {
  if (!theme) return "";
  const dark = rule(':root:not([data-theme="light"])', theme.dark);
  return [rule(":root", theme.light), dark ? `@media (prefers-color-scheme: dark){${dark}}` : "", rule(':root[data-theme="dark"]', theme.dark)].filter(Boolean).join("\n");
}
export {
  BUILT_IN,
  PANELS,
  TOKENS,
  barRows,
  fold,
  formatValue,
  notesOf,
  orderSections,
  pctOf,
  pick,
  queryRows,
  shapeView,
  statValue,
  themeCss,
  toneOf,
  unresolved,
  viewOf
};
