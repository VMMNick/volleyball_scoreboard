-- Акаунти: адмін і судді. Судді реєструються самі, адмін підтверджує.
create table users (
  id            integer generated always as identity primary key,
  email         text not null unique,                  -- завжди в нижньому регістрі
  name          text not null,
  password_hash text not null,                         -- scrypt: "scrypt$N$r$p$salt$hash"
  role          text not null default 'referee' check (role in ('admin', 'referee')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  created_at    timestamptz not null default now()
);

-- Сесії: у браузері — випадковий токен у httpOnly-cookie, тут — лише його SHA-256.
create table sessions (
  token_hash text primary key,
  user_id    integer not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);
