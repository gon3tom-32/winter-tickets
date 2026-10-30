-- Staff area: sign-in links, sessions, and comp undo.
--
-- Staff sign in with a one-time link emailed to them. Links and session
-- cookies are stored only as SHA-256 hashes, so a database leak can't be used
-- to sign in.

alter table staff_users alter column user_id set default gen_random_uuid();
-- Staff are turned off rather than deleted, so the audit log keeps who did what.
alter table staff_users add column active boolean not null default true;
-- Emails are compared in lower case.
create unique index staff_users_email_lower_key on staff_users (lower(email));

create table staff_login_tokens (
  token_hash text primary key,
  user_id uuid not null references staff_users (user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index staff_login_tokens_user_idx on staff_login_tokens (user_id, created_at);

create table staff_sessions (
  id_hash text primary key,
  user_id uuid not null references staff_users (user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);

-- Comps can be undone by an admin; the row stays, marked as undone.
alter table comps
  add column revoked_at timestamptz,
  add column revoked_by uuid references staff_users (user_id);

alter table staff_login_tokens enable row level security;
alter table staff_sessions enable row level security;

-- A seat can only have one live comp per night.
create unique index comps_one_live_per_seat on comps (performance_id, seat_id) where revoked_at is null;
