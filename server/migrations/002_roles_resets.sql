-- Суперадмін (один, із налаштувань сервера) над адмінами; журнал дій; скидання паролів.
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (role in ('superadmin', 'admin', 'referee'));

-- Посилання для скидання пароля: у базі — лише SHA-256 токена; одноразові, 24 години.
create table password_resets (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  created_by integer references users(id) on delete set null,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Хто що зробив: для суперадміна, коли «щось не так».
create table audit_log (
  id        integer generated always as identity primary key,
  actor_id  integer references users(id) on delete set null,
  actor     text,                                        -- email автора: лишається й після видалення акаунта
  action    text not null,
  target    text,
  details   text,
  at        timestamptz not null default now()
);
create index audit_log_at_idx on audit_log (at desc);

-- Службові значення сервера (напр., відбиток пароля суперадміна з налаштувань).
create table settings (
  key   text primary key,
  value text not null
);
