/*
 * Акаунт (account.html): вхід, реєстрація судді, хто ввійшов, вихід.
 * Без акаунтів на сервері (GET /api/config → accounts:false) — лише пояснення.
 */
(function () {
  "use strict";

  var Api = window.Api;
  function $(id) { return document.getElementById(id); }
  function show(id) { ["off", "guest", "user"].forEach(function (s) { $(s).hidden = s !== id; }); }
  function say(el, text, ok) { el.textContent = text || ""; el.className = "msg" + (text ? (ok ? " ok" : " err") : ""); }

  var ROLE = { admin: "адмін", referee: "суддя" };

  function showUser(u) {
    $("uName").textContent = u.name;
    $("uMail").textContent = u.email;
    $("uRole").textContent = ROLE[u.role] || u.role;
    $("uRole").className = "badge " + u.role;
    $("uAdmin").hidden = u.role !== "admin";
    show("user");
  }

  function tab(register) {
    $("tabLogin").setAttribute("aria-pressed", String(!register));
    $("tabRegister").setAttribute("aria-pressed", String(register));
    $("loginForm").hidden = register;
    $("regForm").hidden = !register;
  }
  $("tabLogin").addEventListener("click", function () { tab(false); });
  $("tabRegister").addEventListener("click", function () { tab(true); });

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("lBtn").disabled = true;
    say($("lMsg"), "");
    Api.request("POST", "./api/login", { email: $("lEmail").value, password: $("lPass").value }).then(function (r) {
      $("lBtn").disabled = false;
      if (!r.ok) { say($("lMsg"), Api.message(r.error)); return; }
      $("lPass").value = "";
      showUser(r.body.user);
    });
  });

  $("regForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("rBtn").disabled = true;
    say($("rMsg"), "");
    Api.request("POST", "./api/register", { name: $("rName").value, email: $("rEmail").value, password: $("rPass").value }).then(function (r) {
      $("rBtn").disabled = false;
      if (!r.ok) { say($("rMsg"), Api.message(r.error)); return; }
      $("rPass").value = "";
      say($("rMsg"), "Заявку надіслано. Коли адмін підтвердить акаунт, увійдіть на вкладці «Вхід».", true);
    });
  });

  $("uLogout").addEventListener("click", function () {
    Api.request("POST", "./api/logout", {}).then(function () { tab(false); show("guest"); });
  });

  Api.request("GET", "./api/config").then(function (r) {
    if (!r.ok || !r.body || !r.body.accounts) { show("off"); return; }
    Api.request("GET", "./api/me").then(function (me) {
      if (me.ok) showUser(me.body.user); else show("guest");
    });
  });
})();
