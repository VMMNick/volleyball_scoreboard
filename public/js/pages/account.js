/*
 * Акаунт (account.html): вхід, реєстрація судді, хто ввійшов, вихід.
 * Без акаунтів на сервері (GET /api/config → accounts:false) — лише пояснення.
 */
(function () {
  "use strict";

  var Api = window.Api;
  function $(id) { return document.getElementById(id); }
  function show(id) { ["off", "guest", "user", "reset"].forEach(function (s) { $(s).hidden = s !== id; }); }
  function say(el, text, ok) { el.textContent = text || ""; el.className = "msg" + (text ? (ok ? " ok" : " err") : ""); }

  var ROLE = { superadmin: "суперадмін", admin: "адмін", referee: "суддя" };

  function showUser(u) {
    $("uName").textContent = u.name;
    $("uMail").textContent = u.email;
    $("uRole").textContent = ROLE[u.role] || u.role;
    $("uRole").className = "badge " + u.role;
    $("uAdmin").hidden = u.role !== "superadmin";          // людьми керує лише суперадмін
    $("uAdminNote").hidden = u.role !== "admin";
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
      say($("rMsg"), "Заявку надіслано. Коли суперадмін підтвердить акаунт, увійдіть на вкладці «Вхід».", true);
    });
  });

  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("pBtn").disabled = true;
    say($("pMsg"), "");
    Api.request("POST", "./api/me/password", { old: $("pOld").value, password: $("pNew").value }).then(function (r) {
      $("pBtn").disabled = false;
      if (!r.ok) { say($("pMsg"), Api.message(r.error)); return; }
      $("pOld").value = ""; $("pNew").value = "";
      say($("pMsg"), "Пароль змінено.", true);
    });
  });

  /* Посилання для скидання: токен — у частині адреси після «#reset=» (на сервер вона не йде). */
  var resetToken = "";
  var hm = /^#reset=([\w-]{20,100})$/.exec(location.hash);
  if (hm) {
    resetToken = hm[1];
    try { history.replaceState(null, "", location.pathname); } catch (e) {}   // токен не лишаємо в адресному рядку
  }
  $("resetForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if ($("nPass").value !== $("nPass2").value) { say($("nMsg"), "Паролі не збігаються."); return; }
    $("nBtn").disabled = true;
    Api.request("POST", "./api/reset", { token: resetToken, password: $("nPass").value }).then(function (r) {
      $("nBtn").disabled = false;
      if (!r.ok) { say($("nMsg"), Api.message(r.error)); return; }
      resetToken = "";
      tab(false);
      show("guest");
      say($("lMsg"), "Пароль змінено. Увійдіть із новим паролем.", true);
    });
  });

  $("uLogout").addEventListener("click", function () {
    Api.request("POST", "./api/logout", {}).then(function () { tab(false); show("guest"); });
  });

  Api.request("GET", "./api/config").then(function (r) {
    if (!r.ok || !r.body || !r.body.accounts) { show("off"); return; }
    if (resetToken) { show("reset"); return; }
    Api.request("GET", "./api/me").then(function (me) {
      if (me.ok) showUser(me.body.user); else show("guest");
    });
  });
})();
