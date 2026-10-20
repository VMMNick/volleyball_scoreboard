/*
 * Кольори команд — спільні для пульта (pult.js) і табло для глядачів (display.js),
 * щоб обидва вікна завжди фарбувались однаково.
 * ink — колір тексту, що читається на цьому фоні.
 *
 * Поверх готових палітр — свої кольори (prefs.colorA, colorB, colorBg, colorFrame,
 * colorText, кожен "#RRGGBB" або порожньо). Команди фарбуються всюди, а фон, рамка
 * й текст — лише таблиця міні-табла (live, mini, смуга великого табла).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Palettes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PALETTES = [
    { id: "classic", label: "синій / бурштин",  a: "#1668C9", b: "#F5A310", inkA: "#FFFFFF", inkB: "#0A1F30" },
    { id: "court",   label: "червоний / бірюза", a: "#E03127", b: "#17B0A6", inkA: "#FFFFFF", inkB: "#04221F" },
    { id: "neon",    label: "фіолет / лайм",     a: "#7B3FE4", b: "#BEF224", inkA: "#FFFFFF", inkB: "#1A2405" },
    { id: "kit",     label: "малина / трава",    a: "#D61C6B", b: "#3FA82B", inkA: "#FFFFFF", inkB: "#FFFFFF" }
  ];

  /*
   * Палітра для вибору: сітка 10 стовпців, як у Google Docs. Перший рядок — кольори табла
   * й ліги, далі сірі, яскраві, три світліші й три темніші відтінки кожного тону.
   * Будь-який інший колір — через «Свій колір».
   */
  var SWATCH_ROWS = [
    { label: "табло й ліга", colors: ["#0A1F30", "#0E2A3F", "#1B2F7A", "#2F4BA6", "#1668C9", "#F7D23A", "#F5A310", "#E03127", "#17B0A6", "#F2EFE6"] },
    { label: "сірі",         colors: ["#000000", "#434343", "#666666", "#999999", "#B7B7B7", "#CCCCCC", "#D9D9D9", "#EFEFEF", "#F3F3F3", "#FFFFFF"] },
    { label: "яскраві",      colors: ["#980000", "#FF0000", "#FF9900", "#FFFF00", "#00FF00", "#00FFFF", "#4A86E8", "#0000FF", "#9900FF", "#FF00FF"] },
    { label: "світлі 3",     colors: ["#E6B8AF", "#F4CCCC", "#FCE5CD", "#FFF2CC", "#D9EAD3", "#D0E0E3", "#C9DAF8", "#CFE2F3", "#D9D2E9", "#EAD1DC"] },
    { label: "світлі 2",     colors: ["#DD7E6B", "#EA9999", "#F9CB9C", "#FFE599", "#B6D7A8", "#A2C4C9", "#A4C2F4", "#9FC5E8", "#B4A7D6", "#D5A6BD"] },
    { label: "світлі 1",     colors: ["#CC4125", "#E06666", "#F6B26B", "#FFD966", "#93C47D", "#76A5AF", "#6D9EEB", "#6FA8DC", "#8E7CC3", "#C27BA0"] },
    { label: "темні 1",      colors: ["#A61C00", "#CC0000", "#E69138", "#F1C232", "#6AA84F", "#45818E", "#3C78D8", "#3D85C6", "#674EA7", "#A64D79"] },
    { label: "темні 2",      colors: ["#85200C", "#990000", "#B45F06", "#BF9000", "#38761D", "#134F5C", "#1155CC", "#0B5394", "#351C75", "#741B47"] },
    { label: "темні 3",      colors: ["#5B0F00", "#660000", "#783F04", "#7F6000", "#274E13", "#0C343D", "#1C4587", "#073763", "#20124D", "#4C1130"] }
  ];
  var SWATCHES = SWATCH_ROWS.reduce(function (all, r) { return all.concat(r.colors); }, []);
  var COLOR_KEYS = ["colorA", "colorB", "colorBg", "colorFrame", "colorText"];
  /* Таблиця без своїх кольорів — як у theme.css. */
  var BOARD_DEFAULT = { bg: "#0A1F30", cell: "#0E2A3F", text: "#F2EFE6", muted: "#8FA6B8", frame: "#EDE9DE" };

  function isHex(c) { return typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c); }

  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function hex(c) { return "#" + c.map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("").toUpperCase(); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
  function lum(h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* Текст, який читається на цьому фоні: білий або темний — що контрастніше. */
  function ink(bg) { return contrast(bg, "#FFFFFF") >= contrast(bg, "#0A1F30") ? "#FFFFFF" : "#0A1F30"; }

  /* Лише правильні свої кольори з налаштувань: { colorA: "#…", … }. */
  function pickColors(p) {
    var out = {};
    COLOR_KEYS.forEach(function (k) { if (p && isHex(p[k])) out[k] = p[k].toUpperCase(); });
    return out;
  }

  /*
   * Кольори таблиці: фон, рамка, текст. Колонка сетів і підписи виводяться з них.
   * Без своїх кольорів змінні знімаються — таблиця точно як у theme.css.
   */
  function boardColors(c) {
    c = pickColors(c);
    if (!c.colorBg && !c.colorFrame && !c.colorText) return null;
    var bg = c.colorBg || BOARD_DEFAULT.bg;
    var text = c.colorText || (c.colorBg ? (ink(bg) === "#FFFFFF" ? BOARD_DEFAULT.text : "#0A1F30") : BOARD_DEFAULT.text);
    return { bg: bg, cell: mix(bg, text, 0.08), text: text, muted: mix(bg, text, 0.62), frame: c.colorFrame || BOARD_DEFAULT.frame };
  }

  var BOARD_VARS = { "--court-deep": "bg", "--court": "cell", "--chalk": "text", "--slate": "muted", "--tape": "frame" };
  function applyBoard(el, c) {
    if (!el) return null;
    var t = boardColors(c);
    Object.keys(BOARD_VARS).forEach(function (v) {
      if (t) el.style.setProperty(v, t[BOARD_VARS[v]]); else el.style.removeProperty(v);
    });
    if (t) el.setAttribute("data-colors", "custom"); else el.removeAttribute("data-colors");
    // Світлий фон: білий мʼяч подачі отримує темний контур (див. scorebug.css).
    if (t && lum(t.bg) > 0.5) el.setAttribute("data-light", ""); else el.removeAttribute("data-light");
    return t;
  }

  function byId(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  /*
   * Записує кольори команд у CSS-змінні елемента (зазвичай <html>): палітра id,
   * а якщо в custom задано colorA / colorB — свій колір, текст на ньому підбирається сам.
   */
  function apply(el, id, custom) {
    var p = byId(id), c = pickColors(custom);
    var a = c.colorA || p.a, b = c.colorB || p.b;
    var out = { id: p.id, a: a, b: b, inkA: c.colorA ? ink(a) : p.inkA, inkB: c.colorB ? ink(b) : p.inkB };
    el.style.setProperty("--team-a", out.a);
    el.style.setProperty("--team-b", out.b);
    el.style.setProperty("--ink-a", out.inkA);
    el.style.setProperty("--ink-b", out.inkB);
    return out;
  }

  return { list: PALETTES, byId: byId, apply: apply,
           BOARD_DEFAULT: BOARD_DEFAULT, SWATCHES: SWATCHES, SWATCH_ROWS: SWATCH_ROWS, COLOR_KEYS: COLOR_KEYS, isHex: isHex, ink: ink, contrast: contrast,
           pickColors: pickColors, boardColors: boardColors, applyBoard: applyBoard };
});
