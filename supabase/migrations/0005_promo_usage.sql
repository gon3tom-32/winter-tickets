-- How many of a promo code's seats an order uses. Reserved when checkout
-- starts (promo_codes.seats_used goes up) and given back if the order is
-- cancelled or refunded (promo_released_at is set then).
alter table orders
  add column promo_seats integer not null default 0 check (promo_seats >= 0),
  add column promo_released_at timestamptz;
