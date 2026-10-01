/*
 * Спільні дрібниці інтерфейсу для пульта (app.js) і табло (display.js):
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

  return { fmtClock: fmtClock, esc: esc, pips: pips, keepAwake: keepAwake, registerSW: registerSW };
});
