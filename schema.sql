-- Familiengarage: in Supabase SQL Editor ausführen.
-- Die Ausschluss-Constraint ist die verbindliche Schutzschicht gegen Doppelbuchungen.

create extension if not exists btree_gist;

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  car text not null check (car in ('BMW 320d', 'Nissan Townstar', 'Dethleffs Just 90')),
  person text not null check (person in ('Wilke', 'Wolfgang', 'Anja')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  notes text not null default '' check (char_length(notes) <= 280),
  created_at timestamptz not null default now(),
  constraint reservations_valid_period check (end_time > start_time),
  constraint reservations_no_car_overlap
    exclude using gist (
      car with =,
      tstzrange(start_time, end_time, '[)') with &&
    )
);

create index if not exists reservations_start_time_idx on public.reservations (start_time);
create index if not exists reservations_car_time_idx on public.reservations (car, start_time);

alter table public.reservations enable row level security;

grant select, insert, delete on public.reservations to anon, authenticated;

drop policy if exists "Family can view reservations" on public.reservations;
create policy "Family can view reservations"
  on public.reservations for select to anon, authenticated using (true);

drop policy if exists "Family can add reservations" on public.reservations;
create policy "Family can add reservations"
  on public.reservations for insert to anon, authenticated with check (true);

drop policy if exists "Family can delete reservations" on public.reservations;
create policy "Family can delete reservations"
  on public.reservations for delete to anon, authenticated using (true);

alter table public.reservations replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;
