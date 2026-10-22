/*
 * Мова інтерфейсу: українська (типово) або англійська.
 *
 * Сторінки й скрипти пишуть українською, а цей модуль перекладає вже готовий текст:
 * усе, що є на сторінці, і все, що зʼявляється потім (MutationObserver — до відмальовки,
 * тож без миготіння), а також title / placeholder / aria-label, заголовок вкладки й
 * діалоги confirm(). Так логіка пульта й табла лишається недоторканою.
 *
 *   • EN — точні рядки (пробіли всередині не важать);
 *   • RULES — складені фрази з числами й назвами команд («2-й сет · до 25»);
 *   • рядок із « · » перекладається частинами.
 * Назви команд не перекладаються (елементи з translate="no"), крім типових «Команда А/Б».
 *
 * Мова: ?lang=en|uk в адресі (запамʼятовується) → localStorage "volleyball:lang" → uk.
 * Кнопки з data-lang="…" перемикають мову й перезавантажують сторінку.
 * Без DOM (Node, тести) — лише I18n.t(), що повертає рядок як є, якщо мова не en.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(root);
  else root.I18n = factory(root);
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  var KEY = "volleyball:lang";
  var LANGS = ["uk", "en"];

  /* ---------- словник ---------- */

  var EN = {
    // пульт: поле
    "почати матч": "start match",
    "ротація": "rotation",
    "подає": "serving",
    "технічний тайм-аут": "technical timeout",
    "Технічний тайм-аут": "Technical timeout",
    "Завершити": "End",
    "Новий матч": "New match",
    "Протокол": "Scoresheet",
    "Скасувати очко": "Undo point",
    "один сет": "one set",
    "час міняти сторони": "time to switch sides",
    "сетбол": "set point",
    "матчбол": "match point",
    "Тайм-аут": "Timeout",
    "тайм-аут": "timeout",
    "зміна сторін": "switch sides",
    "Меню матчу": "Match menu",
    "Додати очко команді зверху": "Add a point to the top team",
    "Додати очко команді знизу": "Add a point to the bottom team",
    "Зняти очко": "Remove point",
    "Скасувати": "Undo",
    "Повторити": "Redo",

    // меню
    "Матч": "Match",
    "Протокол і статистика": "Scoresheet & stats",
    "Архів матчів": "Match archive",
    "Табло для глядачів": "Spectator scoreboard",
    "Міні-табло з керуванням": "Mini scoreboard with controls",
    "Міні-табло окремо": "Mini scoreboard only",
    "Посилання на матч": "Match link",
    "Заміни й картки": "Substitutions & cards",
    "Хто подає першим": "Who serves first",
    "Поміняти сторони": "Switch sides",
    "На весь екран": "Full screen",
    "Вийти з повного екрана": "Exit full screen",
    "Налаштування": "Settings",
    "Тап по половині — очко. З клавіатури: 1 і 2 — очко, Q і P — тайм-аут, Backspace — скасувати, Shift+Backspace — повторити.":
      "Tap a half to score. Keyboard: 1 and 2 — point, Q and P — timeout, Backspace — undo, Shift+Backspace — redo.",
    "Дозвольте спливні вікна для цього сайту": "Allow pop-ups for this site",
    "→ на другий екран": "→ to second screen",

    // заміни й картки
    "Виходить №": "Player out #",
    "Заходить №": "Player in #",
    "Заміна": "Substitution",
    "Картка — № гравця (порожньо — команді чи тренеру)": "Card — player # (empty — team or coach)",
    "Жовта": "Yellow",
    "Червона": "Red",
    "Вилучення": "Expulsion",
    "Дискваліфікація": "Disqualification",
    "жовта": "yellow",
    "червона": "red",
    "вилучення": "expulsion",
    "дискваліфікація": "disqualification",
    "Жовта картка": "Yellow card",
    "Червона картка": "Red card",
    "очко суперникові": "point to the opponent",
    "Червона картка — штраф: очко й подача суперникові. Помилку скасовує ⟲ на сітці.":
      "Red card is a penalty: point and serve go to the opponent. Undo a mistake with ⟲ on the net.",
    "вкажіть два різні номери": "enter two different numbers",
    "Замін і карток ще не було": "No substitutions or cards yet",
    "№": "#",
    "команді": "to the team",

    // посилання на матч
    "Два посилання на цей матч:": "Two links to this match:",
    "міні-табло": "mini scoreboard",
    "з назвами команд і очками — відкрити на будь-якому телефоні чи ТБ, і":
      "with team names and points — open on any phone or TV, and",
    "пульт для другого судді": "a control for the second referee",
    "— вести рахунок з іншого пристрою. Потрібен інтернет і сервер.":
      "— keep score from another device. Needs internet and a server.",
    "Сервер": "Server",
    "Створити посилання": "Create link",
    "Вкажіть адресу сервера, наприклад https://назва.onrender.com": "Enter the server address, e.g. https://name.onrender.com",
    "https://назва.onrender.com": "https://name.onrender.com",
    "Немає звʼязку із сервером": "No connection to the server",
    "Сервер не приймає це посилання": "The server does not accept this link",
    "Рахунок на цьому пристрої ведеться далі — без сервера не оновлюються лише міні-табло й пульт другого судді.":
      "Scoring continues on this device — without the server only the mini scoreboard and the second referee's control stop updating.",
    "Спробувати ще раз": "Try again",
    "Зупинити посилання": "Stop link",
    "Міні-табло": "Mini scoreboard",
    "Назви команд і очки наживо, лише перегляд. Сторінка сама маленька — у будь-якому додатку (зокрема в Prism Live на телефоні) табло одразу невелике. Розмір — нижче, міняється навіть в ефірі.":
      "Team names and points live, view only. The page itself is small — in any app (including Prism Live on a phone) the scoreboard stays compact. Size is below and can be changed even on air.",
    "Копіювати": "Copy",
    "Скопійовано": "Copied",
    "Код для вставки": "Embed code",
    "Розмір": "Size",
    "Табло": "Board",
    "Із сетами": "With sets",
    "Смуга": "Strip",
    "Таблиця сетів": "Set table",
    "Смуга з назвою турніру": "Strip with tournament name",
    "На весь віджет — чіткіше у стрімі": "Fill the widget — sharper on stream",
    "Нова емблема ліги (синьо-жовта)": "New league logo (blue and yellow)",
    "Попередня емблема ліги (із замком)": "Previous league logo (with castle)",
    "Вигляд записується в саму адресу, тож у стрімі може бути смуга, а в глядачів — табло з сетами. Скопіюйте адресу після вибору.":
      "The layout is stored in the address itself, so the stream can show a strip while spectators see the board with sets. Copy the address after choosing.",
    "Емблеми вмикаються галочками й одразу змінюються на всіх табло, навіть уже доданих у стрім: одна — ліворуч, обидві — нова ліворуч, попередня праворуч.":
      "Logos are toggled with the checkboxes and change at once on every scoreboard, even ones already added to a stream: one — on the left, both — new on the left, previous on the right.",
    "«На весь віджет» прибирає прозорі поля: табло малюється на всю ширину сторінки й не розмивається, коли додаток збільшує картинку. Розмір тоді міняють самим віджетом, а не кнопками − / +.":
      "“Fill the widget” removes the transparent margins: the board is drawn across the whole page and stays sharp when the app scales the picture. Resize the widget itself then, not the − / + buttons.",
    "Пульт для другого судді": "Control for the second referee",
    "Хто має це посилання, може змінювати рахунок. Надсилайте лише судді.":
      "Anyone with this link can change the score. Send it to the referee only.",
    "Новий ключ судді": "New referee key",
    "Старе посилання судді одразу перестане діяти. Міні-табло глядачів не зміниться.":
      "The old referee link stops working at once. The spectators' mini scoreboard stays the same.",
    "Закрити посилання": "Close link",
    "Відʼєднатися від матчу": "Leave the match",
    "Зменшити міні-табло": "Smaller mini scoreboard",
    "Збільшити міні-табло": "Larger mini scoreboard",
    "на звʼязку": "connected",
    "немає звʼязку": "offline",
    "немає звʼязку ?": "offline ?",
    "Що сталося і що робити": "What happened and what to do",
    "підключення до сервера…": "connecting to the server…",
    "немає звʼязку — перепідключаюсь": "offline — reconnecting",
    "сервер відмовив — посилання недійсне": "server refused — the link is invalid",
    "ви — другий суддя": "you are the second referee",
    "підключення…": "connecting…",
    "наживо": "live",
    "посилання недійсне": "link is invalid",
    "табло не знайдено — перевірте посилання": "scoreboard not found — check the link",
    "Ключ судді не підходить — посилання застаріле або матч уже закрили.":
      "The referee key does not match — the link is outdated or the match was closed.",
    "Сервер перевантажений — забагато відкритих матчів. Спробуйте пізніше.":
      "The server is overloaded — too many open matches. Try again later.",
    "Сервер відмовив у підключенні — це посилання більше не дійсне.":
      "The server refused the connection — this link is no longer valid.",
    "Зупиніть посилання й створіть нове.": "Stop the link and create a new one.",
    "Пристрій не в інтернеті — перевірте Wi-Fi або мобільні дані.": "The device is offline — check Wi-Fi or mobile data.",
    "Сайт відкрито як файл із комп'ютера — посилання працюють лише з адреси сервера.":
      "The site is opened as a file from the computer — links only work from the server address.",
    "Сервер працює, але WebSocket-зʼєднання не проходить — можливо, його блокує мережа (проксі, VPN, шкільний чи робочий Wi-Fi).":
      "The server is up, but the WebSocket connection does not get through — the network may be blocking it (proxy, VPN, school or work Wi-Fi).",
    "Безкоштовний Render засинає без відвідувачів і прокидається до хвилини. Якщо довше — сервіс не запущений: перевірте його в панелі Render.":
      "Free Render sleeps without visitors and takes up to a minute to wake up. If it takes longer, the service is not running: check it in the Render dashboard.",
    "Відʼєднатися? Цей пульт перестане отримувати зміни з матчу.": "Leave? This control will stop receiving match updates.",
    "Закрити посилання? Міні-табло й пульт другого судді перестануть оновлюватись.":
      "Close the link? The mini scoreboard and the second referee's control will stop updating.",
    "Створити нове посилання для судді? Старе одразу перестане діяти.": "Create a new referee link? The old one stops working at once.",

    // хто подає
    "Діє, поки в сеті ще немає жодного розіграшу. Далі подача переходить сама.":
      "Works until the first rally of the set. After that the serve passes automatically.",

    // архів
    "Зберігається лише на цьому пристрої — до 30 останніх матчів. Матч потрапляє сюди, коли закінчився або коли ви почали новий.":
      "Stored on this device only — up to 30 recent matches. A match lands here when it ends or when you start a new one.",
    "Очистити архів": "Clear archive",
    "Поки порожньо — тут зʼявляться завершені матчі.": "Empty for now — finished matches will appear here.",
    "Пошук: команда, турнір, дата чи рахунок": "Search: team, tournament, date or score",
    "Пошук в архіві": "Search the archive",
    "не дограний": "unfinished",
    "Видалити": "Delete",
    "CSV": "CSV",
    "Видалити цей матч з архіву?": "Delete this match from the archive?",
    "Очистити весь архів матчів на цьому пристрої?": "Clear the whole match archive on this device?",

    // протокол
    "Протокол · з архіву": "Scoresheet · from archive",
    "Завантажити CSV": "Download CSV",
    "Копіювати JSON": "Copy JSON",
    "сет": "set",
    "розіграшів": "rallies",
    "час": "time",
    "перервано": "interrupted",
    "триває": "in progress",
    "Ще жодного розіграшу": "No rallies yet",
    "Виграно очок": "Points won",
    "Найдовша серія": "Longest run",
    "Найбільший відрив": "Biggest lead",
    "Тайм-аутів узято": "Timeouts taken",

    // налаштування
    "Назва турніру чи матчу": "Tournament or match name",
    "необовʼязково — видно на табло": "optional — shown on the scoreboard",
    "Перша команда": "First team",
    "Друга команда": "Second team",
    "Правила": "Rules",
    "Зал": "Indoor",
    "Пляж": "Beach",
    "Шкільний": "School",
    "Свої правила.": "Custom rules.",
    "Формат": "Format",
    "1 сет": "1 set",
    "Очок у сеті": "Points per set",
    "Очок у вирішальному": "Points in the deciding set",
    "Стеля очок": "Point cap",
    "без стелі": "no cap",
    "Тайм-аутів на сет": "Timeouts per set",
    "Кольори команд": "Team colors",
    "Свої кольори — команди й таблиця міні-табла": "Custom colors — teams and the mini scoreboard",
    "Скинути свої кольори": "Reset custom colors",
    "Фон таблиці": "Board background",
    "Рамка таблиці": "Board frame",
    "Текст таблиці": "Board text",
    "Свій колір": "Custom color",
    "свій колір — будь-який": "custom color — any",
    "як було": "as before",
    "типово": "default",
    "Вібрація на очко": "Vibrate on point",
    "Показувати подачу на табло для глядачів": "Show the serve on the spectator scoreboard",
    "Звуки на табло: свисток тайм-ауту, кінець сету й матчу": "Scoreboard sounds: timeout whistle, end of set and match",
    "Зберегти": "Save",
    "Обнулити рахунок": "Reset score",
    "Стеля закриває нескінченний сет: при 27 рахунок 27:26 уже дає перемогу. Зміна формату починає матч наново.":
      "A cap ends an endless set: with 27, a 27:26 score already wins. Changing the format restarts the match.",
    "Почати новий матч? Поточний збережеться в архіві.": "Start a new match? The current one will be saved to the archive.",
    "Обнулити рахунок матчу? Поточний збережеться в архіві.": "Reset the match score? The current one will be saved to the archive.",
    "Мова": "Language",

    // палітри
    "синій / бурштин": "blue / amber",
    "червоний / бірюза": "red / teal",
    "фіолет / лайм": "violet / lime",
    "малина / трава": "raspberry / grass",
    "табло й ліга": "scoreboard & league",
    "сірі": "greys",
    "яскраві": "bright",
    "світлі 3": "light 3",
    "світлі 2": "light 2",
    "світлі 1": "light 1",
    "темні 1": "dark 1",
    "темні 2": "dark 2",
    "темні 3": "dark 3",

    // велике табло
    "Табло — волейбол": "Scoreboard — volleyball",
    "Табло для глядачів — волейбол": "Spectator scoreboard — volleyball",
    "сети": "sets",
    "Матч завершено": "Match over",
    "матч завершено": "match over",
    "звук вимкнено — клікніть будь-де": "sound off — click anywhere",
    "Подвійний клік або": "Double-click or",
    "— повний екран ·": "— full screen ·",
    "— макет": "— layout",
    "Смуга рахунку": "Score strip",

    // міні-табло
    "Міні-табло — волейбол": "Mini scoreboard — volleyball",
    "команда": "team",
    "очки": "points",
    "Чекаємо на пульт судді…": "Waiting for the referee's control…",
    "Рахунок зʼявиться, щойно суддя почне матч.": "The score appears as soon as the referee starts the match.",
    "Це табло показує рахунок лише з пульта, відкритого": "This scoreboard only shows the score from a control opened",
    "в цьому ж браузері": "in this same browser",
    "Для стріму, іншої програми чи пристрою візьміть посилання в пульті:": "For a stream, another app or device, take the link from the control:",
    "Меню → Посилання на матч → Міні-табло": "Menu → Match link → Mini scoreboard",
    "Керування ↗": "Controls ↗",
    "Рахунок": "Score",
    "Рахунок матчу": "Match score",

    // міні-пульт
    "Міні-пульт — волейбол": "Mini control — volleyball",
    "⟲ Скасувати": "⟲ Undo",
    "⟳ Повторити": "⟳ Redo",
    "Подача ⇄": "Serve ⇄",
    "Подача": "Serve",
    "Хто подає? ⇄": "Who serves? ⇄",
    "Сховати табло": "Hide scoreboard",
    "Показати табло": "Show scoreboard",
    "Табло окремо ↗": "Scoreboard only ↗",
    "Повний пульт ↗": "Full control ↗",
    "Міні-табло для стріму чи іншого пристрою:": "Mini scoreboard for a stream or another device:",
    "Сторінка сама маленька — у будь-якому додатку, зокрема в Prism Live на телефоні, табло одразу невелике.":
      "The page itself is small — in any app, including Prism Live on a phone, the scoreboard stays compact.",
    "1 / 2 — очко · Q / P — тайм-аут · Backspace — скасувати": "1 / 2 — point · Q / P — timeout · Backspace — undo",
    "Очко першій команді": "Point to the first team",
    "Зняти очко першій команді": "Remove a point from the first team",
    "Очко другій команді": "Point to the second team",
    "Зняти очко другій команді": "Remove a point from the second team",
    "Скасувати останню дію": "Undo the last action",
    "Хто подає першим у цьому сеті": "Who serves first in this set",

    // CSV і протокол із match.js
    "хвилин": "minutes",
    "заміна": "substitution",
    " (триває)": " (in progress)"
  };

  var DEFAULT_NAMES = [["Команда А", "Team A"], ["Команда Б", "Team B"]];
  var CARDS = { "жовта": "yellow", "червона": "red", "вилучення": "expulsion", "дискваліфікація": "disqualification" };

  function names(s) {
    for (var i = 0; i < DEFAULT_NAMES.length; i++) s = s.split(DEFAULT_NAMES[i][0]).join(DEFAULT_NAMES[i][1]);
    return s;
  }

  /*
   * Складені фрази. Групи з назвами команд лишаються як є (лише «Команда А/Б» → «Team A/B»).
   */
  var RULES = [
    [/^тайм-аут( .*)?$/, function (m) { return "timeout" + (m[1] || ""); }],
    [/^Тайм-аут · (.+)$/, "Timeout · $1"],
    [/^тайм-аут · (.+)$/, "timeout · $1"],
    [/^(\d+)-й сет · до (\d+)$/, "Set $1 · to $2"],
    [/^(\d+)-й сет$/, "Set $1"],
    [/^(\d+)-й сет (\d+:\d+)$/, "Set $1 $2"],
    [/^до (\d+)$/, "to $1"],
    [/^до (\d+) перемог$/, "first to $1 wins"],
    [/^матчбол · (.+)$/, "match point · $1"],
    [/^сетбол · (.+)$/, "set point · $1"],
    [/^(.+) виграла (\d+:\d+)$/, "$1 wins $2"],
    [/^(.+) виграла$/, "$1 wins"],
    [/^замін у сеті: (\d+) з (\d+)$/, "substitutions this set: $1 of $2"],
    [/^заміна (.+) → (.+)$/, "substitution $1 → $2"],
    [/^картка: (\S+)$/, function (m) { return "card: " + (CARDS[m[1]] || m[1]); }],
    [/^№(.+)$/, "#$1"],
    [/^код (\w+)$/, "code $1"],
    [/^(\d+) хв$/, "$1 min"],
    [/^Знайдено: (\d+) з (\d+)$/, "Found: $1 of $2"],
    [/^Нічого не знайдено за «(.+)»\.$/, "Nothing found for “$1”."],
    [/^сет (\d+)$/, "set $1"],
    [/^(\d+) \(триває\)$/, "$1 (in progress)"],
    [/^Подає: (.+?)( ⇄)?$/, function (m) { return "Serving: " + m[1] + (m[2] || ""); }],
    [/^(.+) — міні-пульт$/, "$1 — mini control"],
    [/^(.+): (#[0-9A-Fa-f]{6})$/, function (m) { return tr(m[1]) + ": " + m[2]; }],
    [/^(.+): свій колір$/, function (m) { return tr(m[1]) + ": custom color"; }],
    [/^(.+) · типово$/, function (m) { return tr(m[1]) + " · default"; }],
    [/^Посилання створене для сервера (.+), а сайт відкрито з (.+)\. Якщо сервер змінився — зупиніть посилання й створіть нове\.$/,
      "The link was created for server $1, but the site is opened from $2. If the server has changed, stop the link and create a new one."],
    [/^Сайт на (.+) працює, але сервера посилань там немає — розгорнуто лише статичні файли\. .*$/,
      "The site on $1 works, but there is no link server there — only static files are deployed. Render needs a Web Service (Node, start command “npm start”), not a Static Site. GitHub Pages is static too: the Render server address is set by the SYNC_SERVER variable."],
    [/^Сервер (.+) не відповідає — він вимкнений або адреса неправильна\.$/, "Server $1 is not responding — it is off or the address is wrong."],
    [/^(.+): сети до (\d+), вирішальний до (\d+), тайм-аутів (\d+); (.+)\.$/, function (m) {
      var swap = m[5]
        .replace(/^сторони міняють щоразу, коли сума очок кратна (\d+), у вирішальному — (\d+)$/, "sides switch whenever the point total is a multiple of $1, in the deciding set — $2")
        .replace(/^сторони міняють щоразу, коли сума очок кратна (\d+)$/, "sides switch whenever the point total is a multiple of $1")
        .replace(/^сторони міняють між сетами і на (\d+) очках у вирішальному$/, "sides switch between sets and at $1 points in the deciding set")
        .replace(/^сторони міняють між сетами$/, "sides switch between sets");
      return tr(m[1]) + ": sets to " + m[2] + ", deciding set to " + m[3] + ", timeouts " + m[4] + "; " + swap + ".";
    }]
  ];

  /* ---------- переклад рядка ---------- */

  var current = "uk";

  function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

  function one(n) {
    if (Object.prototype.hasOwnProperty.call(EN, n)) return EN[n];
    for (var i = 0; i < RULES.length; i++) {
      var m = RULES[i][0].exec(n);
      if (m) return typeof RULES[i][1] === "function" ? RULES[i][1](m) : n.replace(RULES[i][0], RULES[i][1]);
    }
    return null;
  }

  /* Перекласти рядок (без огляду на поточну мову). Непереведене лишається як є. */
  function tr(s) {
    var n = norm(s);
    if (!n || !/[А-Яа-яЇїІіЄєҐґ№]/.test(n)) return s;
    // «· заміна 7 → 12», «Тайм-аут ·» — роздільник по краях перекладу не заважає.
    var sep = /^(· )?(.*?)( ·)?$/.exec(n);
    if (sep && (sep[1] || sep[3]) && sep[2]) {
      var inner = tr(sep[2]);
      if (inner !== sep[2]) return /^\s*/.exec(s)[0] + (sep[1] || "") + inner + (sep[3] || "") + /\s*$/.exec(s)[0];
    }
    var out = one(n);
    if (out === null && n.indexOf(" · ") > 0) {
      var any = false;
      out = n.split(" · ").map(function (p) {
        var x = one(p);
        if (x === null) return p;
        any = true;
        return x;
      }).join(" · ");
      if (!any) out = null;
    }
    if (out === null) {
      var named = names(n);
      if (named === n) return s;
      out = named;
    }
    var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
    return lead + names(out) + trail;
  }

  /* Для скриптів: рядок поточною мовою. */
  function t(s) { return current === "en" ? tr(s) : s; }

  /* ---------- вибір мови ---------- */

  function detect(loc, storage) {
    var q = null;
    try { q = new URLSearchParams((loc && loc.search) || "").get("lang"); } catch (e) {}
    if (LANGS.indexOf(q) >= 0) {
      try { storage.setItem(KEY, q); } catch (e) {}
      return q;
    }
    try {
      var saved = storage.getItem(KEY);
      if (LANGS.indexOf(saved) >= 0) return saved;
    } catch (e) {}
    return "uk";
  }

  /* ---------- сторінка ---------- */

  var ATTRS = ["title", "placeholder", "aria-label"];

  function skip(el) {
    for (; el && el.nodeType === 1; el = el.parentNode) {
      var tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return "all";
      if (el.getAttribute("translate") === "no") return "names";
    }
    return "";
  }

  function textNode(node) {
    var how = skip(node.parentNode);
    if (how === "all") return;
    var v = node.nodeValue, next = how === "names" ? names(v) : tr(v);
    if (next !== v) node.nodeValue = next;
  }

  function attrs(el) {
    if (skip(el) === "all") return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v) { var next = tr(v); if (next !== v) el.setAttribute(ATTRS[i], next); }
    }
  }

  function walk(rootNode, doc) {
    if (rootNode.nodeType === 3) { textNode(rootNode); return; }
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9) return;
    if (rootNode.nodeType === 1) attrs(rootNode);
    var w = doc.createTreeWalker(rootNode, 1 | 4);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else attrs(n); }
  }

  function paintSwitch(doc) {
    Array.prototype.forEach.call(doc.querySelectorAll("[data-lang]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === current));
    });
  }

  /* Кнопки мови: зберегти й перезавантажити (тексти скриптів пишуться один раз при старті). */
  function bindSwitch(win) {
    win.document.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
      if (!b) return;
      var lang = b.getAttribute("data-lang");
      if (LANGS.indexOf(lang) < 0 || lang === current) return;
      try { win.localStorage.setItem(KEY, lang); } catch (err) {}
      try {
        var u = new URL(win.location.href);
        if (u.searchParams.has("lang")) { u.searchParams.set("lang", lang); win.location.replace(u.toString()); return; }
      } catch (err) {}
      win.location.reload();
    });
  }

  function start(win) {
    var doc = win.document;
    var storage = null;
    try { storage = win.localStorage; } catch (e) {}
    current = detect(win.location, storage || { getItem: function () { return null; }, setItem: function () {} });
    bindSwitch(win);
    paintSwitch(doc);
    if (current !== "en") return;
    doc.documentElement.setAttribute("lang", "en");
    walk(doc.documentElement, doc);
    var obs = new win.MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.type === "characterData") textNode(r.target);
        else if (r.type === "attributes") attrs(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j], doc);
      }
    });
    obs.observe(doc.documentElement, { subtree: true, childList: true, characterData: true,
                                       attributes: true, attributeFilter: ATTRS });
    var ask = win.confirm;
    if (typeof ask === "function") win.confirm = function (msg) { return ask.call(win, tr(String(msg))); };
  }

  var api = { KEY: KEY, LANGS: LANGS, EN: EN, tr: tr, t: t, detect: detect,
              lang: function () { return current; }, start: start };

  if (root && root.document && root.MutationObserver) {
    try { start(root); } catch (e) {}
  }
  return api;
});
