/*
 * Налаштування розгортання — єдиний файл, який відрізняється між хостингами.
 *
 * syncServer — адреса сервера «Посилань на матч» (server/server.js на Render).
 *   Порожньо — той самий сайт: так на Render, де сайт і сервер — один сервіс.
 *   На GitHub Pages лежить лише статика, тому під час деплою workflow
 *   (.github/workflows/pages.yml) вписує сюди змінну репозиторію SYNC_SERVER,
 *   напр. https://volleyball-scoreboard.onrender.com.
 */
(function (root) {
  root.VOLLEY_CONFIG = {
    syncServer: ""
  };
})(typeof self !== "undefined" ? self : this);
