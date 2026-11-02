-- Familiengarage: als postgres ausführen, danach private.set_family_password(...) aufrufen.
-- Kein Passwort oder Passwort-Hash gehört in dieses Repository.
begin;

create extension if not exists btree_gist;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  car text not null check (car in ('BMW 320d', 'Nissan Townstar', 'Dethleffs Just 90')),
  person text not null check (person in ('Wilke', 'Wolfgang', 'Anja')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_all_day boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 280),
  created_at timestamptz not null default now(),
  constraint reservations_valid_period check (end_time > start_time),
  constraint reservations_no_car_overlap
    exclude using gist (
      car with =,
      tstzrange(start_time, end_time, '[)') with &&
    )
);

-- Diese beiden Anweisungen machen das Skript auch für eine bereits bestehende Tabelle sicher.
alter table public.reservations
  add column if not exists is_all_day boolean not null default false;

create index if not exists reservations_start_time_idx on public.reservations (start_time);
create index if not exists reservations_car_time_idx on public.reservations (car, start_time);

create table if not exists private.family_access (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  attempt_window_started timestamptz not null default now()
);
create table if not exists private.family_sessions (
  token_hash bytea primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
revoke all on private.family_access, private.family_sessions from public, anon, authenticated;
alter table private.family_access enable row level security;
alter table private.family_sessions enable row level security;

-- Nur der Datenbankadministrator kann das Passwort ändern.
create or replace function private.set_family_password(new_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if new_password is null or octet_length(new_password) < 4 or octet_length(new_password) > 72 then
    raise exception 'Das Passwort muss zwischen 4 und 72 Bytes lang sein.';
  end if;
  insert into private.family_access (singleton, password_hash)
  values (true, extensions.crypt(new_password, extensions.gen_salt('bf', 12)))
  on conflict (singleton) do update set
    password_hash = excluded.password_hash, failed_attempts = 0,
    locked_until = null, attempt_window_started = now();
  delete from private.family_sessions;
end;
$$;
revoke all on function private.set_family_password(text) from public, anon, authenticated;

-- Globales Limit: nicht durch eine neue Browser-ID oder parallele Aufrufe umgehbar.
create or replace function public.family_login(p_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  access_row private.family_access%rowtype;
  session_token text;
  session_expiry timestamptz;
  failure_count integer;
  current_time_value timestamptz;
begin
  select * into access_row from private.family_access where singleton for update;
  if not found then
    return jsonb_build_object('error', 'not_configured');
  end if;
  current_time_value := clock_timestamp();
  if access_row.locked_until > current_time_value then
    return jsonb_build_object('error', 'locked', 'retry_after_seconds',
      ceil(extract(epoch from access_row.locked_until - current_time_value))::integer);
  end if;
  if access_row.attempt_window_started < current_time_value - interval '15 minutes' then
    access_row.failed_attempts := 0;
    update private.family_access set failed_attempts = 0,
      attempt_window_started = current_time_value, locked_until = null where singleton;
  end if;
  if p_password is null or octet_length(p_password) > 72 or
    extensions.crypt(p_password, access_row.password_hash) is distinct from access_row.password_hash then
    failure_count := access_row.failed_attempts + 1;
    update private.family_access set failed_attempts = failure_count,
      locked_until = case when failure_count >= 5 then current_time_value + interval '15 minutes' else null end
    where singleton;
    return jsonb_build_object('error', case when failure_count >= 5 then 'locked' else 'invalid_password' end,
      'retry_after_seconds', case when failure_count >= 5 then 900 else 0 end);
  end if;
  session_token := encode(extensions.gen_random_bytes(32), 'hex');
  session_expiry := current_time_value + interval '12 hours';
  delete from private.family_sessions where expires_at <= current_time_value;
  insert into private.family_sessions (token_hash, expires_at)
  values (extensions.digest(session_token, 'sha256'), session_expiry);
  update private.family_access set failed_attempts = 0,
    locked_until = null, attempt_window_started = current_time_value where singleton;
  return jsonb_build_object('session_token', session_token, 'expires_at', session_expiry);
end;
$$;

create or replace function private.require_family_session(p_session_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_session_token is null or p_session_token !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from private.family_sessions
    where token_hash = extensions.digest(p_session_token, 'sha256') and expires_at > clock_timestamp()
  ) then
    raise exception 'Bitte erneut anmelden.' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_family_session(text) from public, anon, authenticated;

create or replace function public.family_list_reservations(p_session_token text)
returns setof public.reservations language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_family_session(p_session_token);
  return query select * from public.reservations order by start_time;
end;
$$;

create or replace function public.family_create_reservation(
  p_session_token text, p_car text, p_person text,
  p_start_time timestamptz, p_end_time timestamptz, p_is_all_day boolean, p_notes text
)
returns public.reservations language plpgsql security definer set search_path = '' as $$
declare saved public.reservations;
begin
  perform private.require_family_session(p_session_token);
  insert into public.reservations (car, person, start_time, end_time, is_all_day, notes)
  values (p_car, p_person, p_start_time, p_end_time, p_is_all_day, coalesce(p_notes, ''))
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.family_delete_reservation(p_session_token text, p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare affected integer;
begin
  perform private.require_family_session(p_session_token);
  delete from public.reservations where id = p_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function public.family_logout(p_session_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from private.family_sessions
  where token_hash = extensions.digest(p_session_token, 'sha256');
end;
$$;

revoke all on function public.family_login(text) from public, anon, authenticated;
revoke all on function public.family_list_reservations(text) from public, anon, authenticated;
revoke all on function public.family_create_reservation(text,text,text,timestamptz,timestamptz,boolean,text) from public, anon, authenticated;
revoke all on function public.family_delete_reservation(text,uuid) from public, anon, authenticated;
revoke all on function public.family_logout(text) from public, anon, authenticated;
grant execute on function public.family_login(text) to anon, authenticated;
grant execute on function public.family_list_reservations(text) to anon, authenticated;
grant execute on function public.family_create_reservation(text,text,text,timestamptz,timestamptz,boolean,text) to anon, authenticated;
grant execute on function public.family_delete_reservation(text,uuid) to anon, authenticated;
grant execute on function public.family_logout(text) to anon, authenticated;

-- Direkte Zugriffe bleiben selbst bei manipulierter Benutzeroberfläche verboten.
alter table public.reservations enable row level security;
revoke all on public.reservations from public, anon, authenticated;
do $$
declare old_policy record;
begin
  for old_policy in select policyname from pg_policies
    where schemaname = 'public' and tablename = 'reservations'
  loop
    execute format('drop policy %I on public.reservations', old_policy.policyname);
  end loop;
  -- Realtime-DELETE-Ereignisse können nicht wie SELECT über RLS geschützt werden.
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'reservations') then
    alter publication supabase_realtime drop table public.reservations;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
