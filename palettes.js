/*
 * Кольори команд — спільні для пульта (app.js) і табло для глядачів (display.js),
 * щоб обидва вікна завжди фарбувались однаково.
 * ink — колір тексту, що читається на цьому фоні.
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

  function byId(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }

  /* Записує кольори палітри в CSS-змінні елемента (зазвичай <html>). */
  function apply(el, id) {
    var p = byId(id);
    el.style.setProperty("--team-a", p.a);
    el.style.setProperty("--team-b", p.b);
    el.style.setProperty("--ink-a", p.inkA);
    el.style.setProperty("--ink-b", p.inkB);
    return p;
  }

  return { list: PALETTES, byId: byId, apply: apply };
});
