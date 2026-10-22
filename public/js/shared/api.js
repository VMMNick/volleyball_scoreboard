/*
 * Клієнт API акаунтів (server/api.js): JSON-запити з cookie сесії й зрозумілі повідомлення.
 * Працює в браузері (window.Api) і в Node (require) — повідомлення тестуються без браузера.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Api = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MESSAGES = {
    "bad-request": "Щось не так із запитом. Оновіть сторінку й спробуйте ще раз.",
    "bad-email": "Перевірте email.",
    "bad-name": "Вкажіть імʼя (до 80 символів).",
    "weak-password": "Пароль — щонайменше 8 символів.",
    "email-taken": "Акаунт із таким email уже є. Увійдіть або зверніться до суперадміна.",
    "bad-credentials": "Неправильний email або пароль.",
    "pending": "Акаунт ще не підтвердив суперадмін. Спробуйте пізніше.",
    "blocked": "Акаунт заблоковано. Зверніться до суперадміна.",
    "too-many": "Забагато спроб. Зачекайте кілька хвилин.",
    "unauthorized": "Увійдіть, щоб продовжити.",
    "forbidden": "Немає доступу.",
    "cross-site": "Запит відхилено з міркувань безпеки. Відкрийте сторінку з адреси табло.",
    "accounts-disabled": "На цьому сервері акаунти вимкнено.",
    "not-found": "Не знайдено.",
    "server-error": "Помилка сервера. Спробуйте ще раз.",
    "network": "Немає звʼязку із сервером.",
    "bad-old-password": "Поточний пароль неправильний.",
    "bad-reset": "Посилання недійсне: воно вже використане, прострочене або замінене новим. Попросіть суперадміна надіслати нове.",
    "bad-role": "Невідома роль.",
    "bad-status": "Невідомий статус."
  };

  function message(code) { return MESSAGES[code] || MESSAGES["server-error"]; }

  /* Запит до API. Promise<{ ok, status, body, error }> — без винятків, помилка — у полі error. */
  function request(method, path, body, fetchFn) {
    var f = fetchFn || (typeof fetch === "function" ? fetch : null);
    if (!f) return Promise.resolve({ ok: false, status: 0, body: null, error: "network" });
    var init = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return f(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        var ok = res.status >= 200 && res.status < 300;
        return { ok: ok, status: res.status, body: data, error: ok ? null : (data && data.error) || "server-error" };
      });
    }, function () { return { ok: false, status: 0, body: null, error: "network" }; });
  }

  return { request: request, message: message, MESSAGES: MESSAGES };
});
