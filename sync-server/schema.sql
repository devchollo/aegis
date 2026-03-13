create table if not exists users (
  id text primary key,
  username text not null unique,
  password_salt_hex text not null,
  password_hash_hex text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash_hex text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists vaults (
  user_id text primary key references users(id) on delete cascade,
  encrypted_state_json jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists sessions_token_hash_idx on sessions(token_hash_hex);
