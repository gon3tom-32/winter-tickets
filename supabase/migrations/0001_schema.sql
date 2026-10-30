-- Winter performance ticketing: tables for seats, performances, orders,
-- promo codes, comps, staff, and the audit log.
--
-- Key idea: seats are defined once for the venue, but each performance has its
-- own status for every seat (performance_seats).
--
-- All tables have row level security turned on with no policies, so the public
-- API keys can read or write nothing. Only the app's server, using the database
-- connection string, can touch the data.

-- Price tiers. Money is always whole cents.
create table tiers (
  id text primary key,
  name text not null,
  price_cents integer not null check (price_cents >= 0),
  sort integer not null default 0
);

-- The venue's seats. Defined once; the map is drawn from this.
create table seats (
  id text primary key,
  section text not null,
  zone text not null,
  row text not null,
  number integer not null check (number > 0),
  tier_id text not null references tiers (id),
  accessible boolean not null default false,
  unique (section, row, number)
);

-- One row per night.
create table performances (
  id text primary key,
  label text not null,
  starts_at timestamptz,
  grades text[] not null default '{}',
  on_sale boolean not null default false,
  sort integer not null default 0
);

create type order_status as enum ('pending', 'paid', 'free', 'refunded');
create type seat_status as enum ('available', 'held', 'sold', 'comped');
create type promo_kind as enum ('percent', 'amount');
create type staff_role as enum ('staff', 'admin');

-- Staff who can sign in to the staff area. user_id is the Supabase Auth user id.
create table staff_users (
  user_id uuid primary key,
  email text not null unique,
  role staff_role not null default 'staff',
  created_at timestamptz not null default now()
);

create table promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  kind promo_kind not null,
  -- Percent (1-100) for 'percent', cents for 'amount'.
  value integer not null check (value > 0),
  seat_limit integer not null check (seat_limit > 0),
  seats_used integer not null default 0 check (seats_used >= 0),
  expires_at timestamptz,
  active boolean not null default true,
  -- Null means every performance.
  performance_ids text[],
  issued_to text,
  reason text,
  created_by uuid references staff_users (user_id),
  created_at timestamptz not null default now(),
  check (seats_used <= seat_limit),
  check (kind <> 'percent' or value <= 100)
);
-- Codes are matched without regard to upper or lower case.
create unique index promo_codes_code_key on promo_codes (lower(code));

create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_name text not null,
  buyer_email text not null,
  total_cents integer not null check (total_cents >= 0),
  status order_status not null default 'pending',
  promo_code_id uuid references promo_codes (id),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Each seat's status for each night. The primary key means a seat can only
-- have one status per performance, so two buyers can never hold the same seat.
create table performance_seats (
  performance_id text not null references performances (id) on delete cascade,
  seat_id text not null references seats (id),
  status seat_status not null default 'available',
  hold_expires_at timestamptz,
  -- Identifies the browser session holding the seat, so only it can buy it.
  hold_token uuid,
  order_id uuid references orders (id),
  updated_at timestamptz not null default now(),
  primary key (performance_id, seat_id),
  check (status <> 'held' or (hold_expires_at is not null and hold_token is not null)),
  check (status not in ('sold') or order_id is not null)
);
create index performance_seats_order_idx on performance_seats (order_id);

-- One row per seat in an order. price_cents is what was actually paid, so
-- later price changes never rewrite history.
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  performance_id text not null references performances (id),
  seat_id text not null references seats (id),
  price_cents integer not null check (price_cents >= 0),
  grade_supported text not null
);
create index order_items_order_idx on order_items (order_id);

-- Free seats issued by staff.
create table comps (
  id uuid primary key default gen_random_uuid(),
  performance_id text not null references performances (id),
  seat_id text not null references seats (id),
  recipient text not null,
  grade_supported text not null,
  reason text not null,
  issued_by uuid not null references staff_users (user_id),
  created_at timestamptz not null default now()
);

-- Every comp and promo code change is recorded here. Rows can never be
-- edited or deleted (enforced by the trigger below).
create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid references staff_users (user_id),
  action text not null,
  target text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be %d', tg_table_name, lower(tg_op);
end;
$$;

create trigger audit_log_is_append_only
  before update or delete on audit_log
  for each row execute function forbid_change();

-- Codes can be deactivated but never deleted.
create trigger promo_codes_never_deleted
  before delete on promo_codes
  for each row execute function forbid_change();

alter table tiers enable row level security;
alter table seats enable row level security;
alter table performances enable row level security;
alter table staff_users enable row level security;
alter table promo_codes enable row level security;
alter table orders enable row level security;
alter table performance_seats enable row level security;
alter table order_items enable row level security;
alter table comps enable row level security;
alter table audit_log enable row level security;
