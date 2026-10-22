/*
 * Адмін-панель (admin.html) — лише для суперадміна: користувачі (підтвердити, заблокувати,
 * призначити чи зняти адміна, скинути пароль, видалити), прибирання, журнал дій.
 * Не суперадмін — «немає доступу»; не ввійшов — на сторінку входу.
 */
(function () {
  "use strict";

  var Api = window.Api;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var STATUS = { pending: "очікує", active: "активний", blocked: "заблокований" };
  var ROLE = { superadmin: "суперадмін", admin: "адмін", referee: "суддя" };
  var ACTION = {
    "status:active": "підтвердив або розблокував", "status:blocked": "заблокував", "status:pending": "повернув в очікування",
    "role:admin": "призначив адміном", "role:referee": "зняв з адмінів", "delete": "видалив",
    "reset-link": "видав посилання для скидання пароля", "reset-used": "змінив пароль за посиланням",
    "password-changed": "змінив свій пароль", "cleanup:blocked": "прибрав заблокованих", "cleanup:stale-pending": "прибрав старі заявки",
    "superadmin-from-settings": "суперадмін із налаштувань сервера"
  };
  var me = null;

  function btn(id, act, text, cls) {
    return '<button class="' + (cls || "ghost") + '" data-id="' + id + '" data-act="' + act + '">' + text + "</button>";
  }

  function render(users) {
    var pending = users.filter(function (u) { return u.status === "pending"; }).length;
    $("aPending").textContent = pending ? "· очікують: " + pending : "";
    $("aUsers").innerHTML = users.map(function (u) {
      var own = u.role === "superadmin";
      var b = "";
      if (!own) {
        if (u.status === "pending") b += btn(u.id, "active", "Підтвердити", "primary") + btn(u.id, "blocked", "Відхилити");
        else if (u.status === "active") b += btn(u.id, "blocked", "Заблокувати");
        else b += btn(u.id, "active", "Розблокувати");
        if (u.status === "active") b += u.role === "admin" ? btn(u.id, "referee", "Зняти адміна") : btn(u.id, "admin", "Зробити адміном");
        b += btn(u.id, "reset", "Скинути пароль") + btn(u.id, "delete", "Видалити", "ghost danger");
      }
      return '<div class="user"><div><div class="u-name" translate="no">' + esc(u.name) + '</div><div class="u-mail" translate="no">' + esc(u.email) + "</div></div>" +
        '<div class="u-btns"><span class="badge ' + u.role + '">' + ROLE[u.role] + '</span><span class="badge ' + u.status + '">' + STATUS[u.status] + "</span>" + b + "</div></div>";
    }).join("");
  }

  function fmt(iso) {
    var d = new Date(iso), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function renderAudit(entries) {
    if (!entries.length) { $("aAudit").innerHTML = '<p class="empty">Поки порожньо.</p>'; return; }
    $("aAudit").innerHTML = entries.map(function (e) {
      return '<div class="row"><time>' + fmt(e.at) + '</time><div>' + (e.actor ? '<span class="by" translate="no">' + esc(e.actor) + "</span>" : '<span class="by">сервер</span>') + ' <span class="act">' +
        esc(ACTION[e.action] || e.action) + "</span>" + (e.target ? ' <b translate="no">' + esc(e.target) + "</b>" : "") +
        (e.details ? ' <span class="det">' + esc(e.details) + "</span>" : "") + "</div></div>";
    }).join("");
  }

  function load() {
    Api.request("GET", "./api/admin/users").then(function (r) {
      if (r.status === 401) { location.replace("./account.html"); return; }
      if (r.status === 403) { $("aDenied").hidden = false; $("aBody").hidden = true; return; }
      if (!r.ok) { $("aMsg").textContent = Api.message(r.error); return; }
      $("aMsg").textContent = "";
      me = r.body.me;
      $("aBody").hidden = false;
      render(r.body.users);
    });
    Api.request("GET", "./api/admin/audit").then(function (r) { if (r.ok) renderAudit(r.body.entries); });
  }

  $("aUsers").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]");
    if (!b) return;
    var id = b.dataset.id, act = b.dataset.act;
    var name = b.closest(".user").querySelector(".u-name").textContent;
    var req;
    if (act === "delete") {
      if (!confirm("Видалити користувача «" + name + "» назавжди?")) return;
      req = Api.request("DELETE", "./api/admin/users/" + id, {});
    } else if (act === "admin" || act === "referee") {
      req = Api.request("POST", "./api/admin/users/" + id + "/role", { role: act });
    } else if (act === "reset") {
      req = Api.request("POST", "./api/admin/users/" + id + "/reset", {}).then(function (r) {
        if (r.ok) {
          var url = location.origin + r.body.url;
          $("aResetWho").textContent = name;
          $("aResetUrl").textContent = url;
          $("aResetUrl").href = url;
          $("aReset").hidden = false;
        }
        return r;
      });
    } else {
      req = Api.request("POST", "./api/admin/users/" + id, { status: act });
    }
    b.disabled = true;
    req.then(function (r) {
      if (!r.ok) { $("aMsg").textContent = Api.message(r.error); b.disabled = false; return; }
      load();
    });
  });

  $("aResetCopy").addEventListener("click", function () {
    var t = $("aResetUrl").textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { $("aResetCopy").textContent = "Скопійовано"; setTimeout(function () { $("aResetCopy").textContent = "Копіювати"; }, 1600); });
  });
  $("aResetHide").addEventListener("click", function () { $("aReset").hidden = true; });

  function cleanup(what, question) {
    if (!confirm(question)) return;
    Api.request("POST", "./api/admin/cleanup", { what: what }).then(function (r) {
      var m = $("aCleanMsg");
      if (!r.ok) { m.className = "msg err"; m.textContent = Api.message(r.error); return; }
      m.className = "msg ok";
      m.textContent = "Видалено: " + r.body.removed;
      load();
    });
  }
  $("aCleanBlocked").addEventListener("click", function () { cleanup("blocked", "Видалити всіх заблокованих суддів назавжди?"); });
  $("aCleanStale").addEventListener("click", function () { cleanup("stale-pending", "Видалити заявки, що чекають довше за 30 днів?"); });

  load();
})();
