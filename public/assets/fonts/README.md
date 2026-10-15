# Шрифти

Обидва — SIL Open Font License 1.1, можна вбудовувати й поширювати разом із застосунком.

| Файл | Шрифт | Символи |
|---|---|---|
| `barlow-condensed-latin-*.woff2` | Barlow Condensed (Jeremy Tribby) | цифри, латиниця |
| `roboto-condensed-cyrillic-*.woff2` | Roboto Condensed (Google) | кирилиця, зокрема і, ї, є, ґ |

У Barlow Condensed немає кирилиці, тож у `theme.css` обидва зведені в одну
родину `Scoreboard` через `unicode-range`: браузер сам бере потрібний файл для
кожної літери. Взято з пакетів `@fontsource/barlow-condensed` і
`@fontsource/roboto-condensed` 5.3.0.
