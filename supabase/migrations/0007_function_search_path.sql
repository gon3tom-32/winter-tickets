-- Pin the schema search path on functions (Supabase security check
-- "function_search_path_mutable"), so a function can't be tricked into
-- using a look-alike table from another schema.

create or replace function forbid_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows cannot be %d', tg_table_name, lower(tg_op);
end;
$$;

create or replace function release_expired_holds() returns integer
language sql
set search_path = ''
as $$
  with released as (
    update public.performance_seats
    set status = 'available', hold_token = null, hold_expires_at = null, updated_at = now()
    where status = 'held' and hold_expires_at <= now()
    returning 1
  )
  select count(*)::integer from released;
$$;
