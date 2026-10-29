-- Bluffstack: durable room state and atomic revision-based updates.

create table if not exists public.game_rooms (
  room_code text primary key
    check (room_code ~ '^[A-Z0-9]{4}$'),
  state jsonb not null
    check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 0
    check (revision >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),

  constraint game_rooms_state_code_matches
    check (state ->> 'roomCode' = room_code)
);

comment on table public.game_rooms is
  'Authoritative persisted game state for Bluffstack rooms.';

comment on column public.game_rooms.revision is
  'Database concurrency counter, independent of the public game version.';

-- The browser must never access the raw game state directly.
alter table public.game_rooms enable row level security;

revoke all on table public.game_rooms from anon, authenticated;
grant all on table public.game_rooms to service_role;

-- Create a room once. A duplicate room code returns no rows.
create or replace function public.create_game_room(
  p_room_code text,
  p_state jsonb
)
returns table (
  created_room_code text,
  current_revision bigint,
  current_state jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_room_code is null
     or p_room_code !~ '^[A-Z0-9]{4}$'
     or p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or p_state ->> 'roomCode' is distinct from p_room_code
  then
    raise exception 'Invalid room state.'
      using errcode = '22023';
  end if;

  return query
    insert into public.game_rooms as room (room_code, state)
    values (p_room_code, p_state)
    on conflict (room_code) do nothing
    returning room.room_code, room.revision, room.state;
end;
$function$;

-- Save only if the caller read the current revision.
-- A stale caller receives zero rows and must reload before retrying.
create or replace function public.save_game_room_state(
  p_room_code text,
  p_expected_revision bigint,
  p_state jsonb
)
returns table (
  saved_revision bigint,
  saved_state jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_room_code is null
     or p_room_code !~ '^[A-Z0-9]{4}$'
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_state is null
     or jsonb_typeof(p_state) is distinct from 'object'
     or p_state ->> 'roomCode' is distinct from p_room_code
  then
    raise exception 'Invalid room state or revision.'
      using errcode = '22023';
  end if;

  return query
    update public.game_rooms as room
    set state = p_state,
        revision = room.revision + 1,
        updated_at = pg_catalog.now()
    where room.room_code = p_room_code
      and room.revision = p_expected_revision
    returning room.revision, room.state;
end;
$function$;

-- Only trusted server-side code may execute these functions.
revoke all on function public.create_game_room(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_game_room_state(text, bigint, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_game_room(text, jsonb)
  to service_role;
grant execute on function public.save_game_room_state(text, bigint, jsonb)
  to service_role;
