-- Checkout: link orders to the buyer and to Stripe, and record webhook events.

alter type order_status add value if not exists 'cancelled';

alter table orders
  -- Secret part of the order's private link (confirmation page and QR code).
  add column access_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- The buyer's browser (same as performance_seats.hold_token).
  add column hold_token uuid,
  add column stripe_payment_intent text,
  -- Set when something went wrong that staff should look at, such as a refund
  -- because a seat was gone by the time payment arrived.
  add column needs_attention boolean not null default false,
  add column attention_reason text,
  add column confirmation_sent_at timestamptz,
  add column cancelled_at timestamptz,
  -- When an automatic refund actually went through at Stripe.
  add column refund_issued_at timestamptz;

create unique index orders_access_key_key on orders (access_key);
create index orders_hold_token_idx on orders (hold_token) where status = 'pending';

-- Each Stripe webhook event is handled once, even if Stripe sends it again.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
