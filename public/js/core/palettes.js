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

  /* Кольори для швидкого вибору; будь-який інший — через «Свій колір». */
  var SWATCHES = [
    "#FFFFFF", "#F2EFE6", "#C9CED6", "#8FA6B8", "#4A4F57", "#000000",
    "#0A1F30", "#1B2F7A", "#1668C9", "#2F4BA6", "#0E7C86", "#17B0A6",
    "#0F3D2E", "#3FA82B", "#BEF224", "#F7D23A", "#F5A310", "#E8590C",
    "#E03127", "#9B1C1C", "#D61C6B", "#7B3FE4"
  ];
  var COLOR_KEYS = ["colorA", "colorB", "colorBg", "colorFrame", "colorText"];
  /* Таблиця без своїх кольорів — як у theme.css. */
  var BOARD_DEFAULT = { bg: "#0A1F30", text: "#F2EFE6", frame: "#EDE9DE" };

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
           SWATCHES: SWATCHES, COLOR_KEYS: COLOR_KEYS, isHex: isHex, ink: ink, contrast: contrast,
           pickColors: pickColors, boardColors: boardColors, applyBoard: applyBoard };
});
