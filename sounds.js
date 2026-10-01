/*
 * Звуки табло, синтезовані через Web Audio: без аудіофайлів, працюють офлайн.
 * Браузер дозволяє звук лише після дії людини на сторінці, тому спершу unlock().
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sounds = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Кожен сигнал — послідовність нот: [частота Гц, початок с, тривалість с, форма]. */
  var CUES = {
    whistle: [[2800, 0, 0.09, "square"], [3100, 0.1, 0.09, "square"], [2800, 0.2, 0.32, "square"]],
    set:     [[523, 0, 0.14, "triangle"], [659, 0.15, 0.14, "triangle"], [784, 0.3, 0.32, "triangle"]],
    match:   [[523, 0, 0.16, "triangle"], [659, 0.17, 0.16, "triangle"], [784, 0.34, 0.16, "triangle"],
              [1047, 0.52, 0.6, "triangle"]],
    timeoutEnd: [[880, 0, 0.18, "sine"], [880, 0.28, 0.4, "sine"]]
  };

  function create(win) {
    win = win || window;
    var Ctx = win.AudioContext || win.webkitAudioContext;
    var ctx = null;
    var enabled = true;

    function ensure() {
      if (!Ctx) return null;
      if (!ctx) { try { ctx = new Ctx(); } catch (e) { return null; } }
      return ctx;
    }

    /* Викликати з обробника кліку чи клавіші. */
    function unlock() {
      var c = ensure();
      if (c && c.state === "suspended" && c.resume) c.resume().catch(function () {});
      return isUnlocked();
    }

    function isUnlocked() { return !!ctx && ctx.state === "running"; }

    function play(name) {
      var cue = CUES[name];
      var c = ctx;
      if (!enabled || !cue || !c || c.state !== "running") return false;
      var t0 = c.currentTime + 0.02;
      cue.forEach(function (n) {
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = n[3];
        osc.frequency.value = n[0];
        // Мʼякий наступ і згасання — без клацань у колонках.
        gain.gain.setValueAtTime(0.0001, t0 + n[1]);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + n[1] + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + n[2]);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t0 + n[1]);
        osc.stop(t0 + n[1] + n[2] + 0.02);
      });
      return true;
    }

    return {
      supported: !!Ctx,
      unlock: unlock,
      isUnlocked: isUnlocked,
      play: play,
      setEnabled: function (on) { enabled = !!on; },
      isEnabled: function () { return enabled; }
    };
  }

  return { create: create, CUES: CUES };
});
