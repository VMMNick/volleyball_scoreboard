/*
 * Адмін-панель (admin.html): судді — підтвердити, заблокувати, розблокувати.
 * Лише для адміна; інакше — на сторінку входу.
 */
(function () {
  "use strict";

  var Api = window.Api;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var STATUS = { pending: "очікує", active: "активний", blocked: "заблокований" };

  function render(users) {
    var judges = users.filter(function (u) { return u.role !== "admin"; });
    var pending = judges.filter(function (u) { return u.status === "pending"; }).length;
    $("aPending").textContent = pending ? "· очікують: " + pending : "";
    if (!judges.length) { $("aUsers").innerHTML = '<p class="empty">Ще ніхто не зареєструвався.</p>'; return; }
    $("aUsers").innerHTML = judges.map(function (u) {
      var btns = u.status === "pending"
        ? '<button class="primary" data-id="' + u.id + '" data-s="active">Підтвердити</button><button class="ghost" data-id="' + u.id + '" data-s="blocked">Відхилити</button>'
        : u.status === "active"
          ? '<button class="ghost" data-id="' + u.id + '" data-s="blocked">Заблокувати</button>'
          : '<button class="ghost" data-id="' + u.id + '" data-s="active">Розблокувати</button>';
      return '<div class="user"><div><div class="u-name" translate="no">' + esc(u.name) + '</div><div class="u-mail" translate="no">' + esc(u.email) + "</div></div>" +
        '<div class="u-btns"><span class="badge ' + u.status + '">' + STATUS[u.status] + "</span>" + btns + "</div></div>";
    }).join("");
  }

  function load() {
    Api.request("GET", "./api/admin/users").then(function (r) {
      if (r.status === 401 || r.status === 403) { location.replace("./account.html"); return; }
      if (!r.ok) { $("aMsg").textContent = Api.message(r.error); return; }
      $("aMsg").textContent = "";
      $("aBody").hidden = false;
      render(r.body.users);
    });
  }

  $("aUsers").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-id]");
    if (!b) return;
    b.disabled = true;
    Api.request("POST", "./api/admin/users/" + b.dataset.id, { status: b.dataset.s }).then(function (r) {
      if (!r.ok) { $("aMsg").textContent = Api.message(r.error); b.disabled = false; return; }
      load();
    });
  });

  load();
})();
