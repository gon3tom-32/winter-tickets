-- Seat holds. A seat being bought is 'held' with an expiry and the buyer's
-- hold token. An expired hold already counts as available everywhere it's
-- read, so this cleanup only tidies the table. On Supabase, schedule it with
-- pg_cron (see README).

create index performance_seats_hold_token_idx on performance_seats (hold_token) where status = 'held';

create function release_expired_holds() returns integer
language sql as $$
  with released as (
    update performance_seats
    set status = 'available', hold_token = null, hold_expires_at = null, updated_at = now()
    where status = 'held' and hold_expires_at <= now()
    returning 1
  )
  select count(*)::integer from released;
$$;
