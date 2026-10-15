/*
 * Спільні дрібниці інтерфейсу для пульта (pult.js) і табло (display.js):
 * формат часу, екранування, кружечки сетів, Wake Lock, офлайн-кеш.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UI = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* 83 000 мс → "1:23" */
  function fmtClock(ms) {
    var total = Math.max(0, Math.round(ms / 1000));
    var m = Math.floor(total / 60), sec = total % 60;
    return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function esc(str) {
    return String(str).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* Кружечки виграних сетів: total штук, перші won — зафарбовані. */
  function pips(node, won, total) {
    node.innerHTML = "";
    for (var k = 0; k < total; k++) {
      var d = node.ownerDocument.createElement("span");
      d.className = "pip" + (k < won ? " won" : "");
      node.appendChild(d);
    }
  }

  /* Екран не гасне, поки сторінка відкрита; після повернення у вкладку — знову. */
  function keepAwake(doc, nav) {
    doc = doc || document;
    nav = nav || navigator;
    var lock = null;
    function request() {
      try {
        if ("wakeLock" in nav) {
          nav.wakeLock.request("screen").then(function (l) {
            lock = l;
            l.addEventListener("release", function () { lock = null; });
          }).catch(function () {});
        }
      } catch (e) {}
    }
    doc.addEventListener("visibilitychange", function () {
      if (doc.visibilityState === "visible" && !lock) request();
    });
    request();
  }

  /* Офлайн-кеш працює лише з http(s): file:// пропускаємо мовчки. */
  function registerSW(win) {
    win = win || window;
    if ("serviceWorker" in win.navigator && win.location.protocol.indexOf("http") === 0) {
      win.addEventListener("load", function () {
        win.navigator.serviceWorker.register("./sw.js").catch(function () {});
      });
    }
  }

  /*
   * Дві емблеми ліги: нова (синьо-жовта) і попередня (із замком). Пульт вмикає кожну
   * своєю галочкою (prefs.boardLogo / prefs.boardLogoOld), і всі табло одразу їх показують.
   * Обидві — нова ліворуч, попередня праворуч. Адреса може перекрити вибір пульта:
   * &logo=0 — без емблеми, &logo=new / old — лише одна, &logo=both — обидві.
   */
  var LOGO_SRC = { "new": "./assets/logos/uvl-new.webp", old: "./assets/logos/uvl-old.webp" };
  function logoPick(prefs, urlVal) {
    var u = urlVal == null ? "" : String(urlVal).toLowerCase();
    if (u === "0" || u === "off" || u === "none") return [];
    if (u === "new" || u === "1") return ["new"];
    if (u === "old" || u === "2") return ["old"];
    if (u === "both" || u === "12") return ["new", "old"];
    var l = [];
    if (!prefs || prefs.boardLogo !== false) l.push("new");
    if (prefs && prefs.boardLogoOld === true) l.push("old");
    return l;
  }
  /* slots — місця під емблему: [перше (ліворуч), друге (праворуч)]; зайве ховаємо класом off. */
  function paintLogos(doc, list, slots) {
    slots.forEach(function (el, i) {
      if (!el) return;
      var img = el.tagName === "IMG" ? el : el.querySelector("img");
      var k = list[i];
      el.classList.toggle("off", !k);
      if (k && img && img.getAttribute("src") !== LOGO_SRC[k]) img.setAttribute("src", LOGO_SRC[k]);
    });
    doc.body.classList.toggle("logo", list.length > 0);
    doc.body.classList.toggle("logo2", list.length > 1);
  }

  return { fmtClock: fmtClock, esc: esc, pips: pips, keepAwake: keepAwake, registerSW: registerSW,
           LOGO_SRC: LOGO_SRC, logoPick: logoPick, paintLogos: paintLogos };
});
