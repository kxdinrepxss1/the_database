create extension if not exists pgcrypto;

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  player text not null,
  year integer,
  sport text,
  card_set text,
  card_number text,
  team text,
  parallel text,
  grade text,
  quantity integer not null default 1 check (quantity > 0),
  purchase_price numeric(12,2),
  purchase_date date,
  current_value numeric(12,2),
  storage_location text,
  storage_container text,
  storage_section text,
  storage_slot text,
  collection_status text default 'Personal collection',
  notes text,
  front_image_path text,
  back_image_path text,
  visibility text not null default 'private',
  listing_status text not null default 'not_listed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cards add column if not exists storage_container text;
alter table public.cards add column if not exists storage_section text;
alter table public.cards add column if not exists storage_slot text;

-- Split whatever collectors already typed into the three fields, treating both
-- "/" and "," as separators: "Binder 2, page 4" and "Box A / Row 3 / Slot 9"
-- both do the right thing. storage_location is kept rather than dropped, so a
-- wrong split can always be traced back to what was originally entered.
update public.cards set
  storage_container = nullif(btrim(split_part(replace(storage_location, ',', '/'), '/', 1)), ''),
  storage_section   = nullif(btrim(split_part(replace(storage_location, ',', '/'), '/', 2)), ''),
  storage_slot      = nullif(btrim((regexp_match(replace(storage_location, ',', '/'), '^[^/]*/[^/]*/(.*)$'))[1]), '')
where storage_location is not null
  and btrim(storage_location) <> ''
  and storage_container is null;

create index if not exists cards_user_created_idx on public.cards (user_id, created_at desc);
create index if not exists cards_user_container_idx on public.cards (user_id, storage_container);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at
before update on public.cards
for each row execute function public.touch_updated_at();

alter table public.cards enable row level security;

drop policy if exists "Collectors can read their cards" on public.cards;
create policy "Collectors can read their cards"
on public.cards for select
using (auth.uid() = user_id);

drop policy if exists "Collectors can add their cards" on public.cards;
create policy "Collectors can add their cards"
on public.cards for insert
with check (auth.uid() = user_id);

drop policy if exists "Collectors can update their cards" on public.cards;
create policy "Collectors can update their cards"
on public.cards for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Collectors can delete their cards" on public.cards;
create policy "Collectors can delete their cards"
on public.cards for delete
using (auth.uid() = user_id);

-- Collector profiles. A profile exists only when someone chooses to share, and
-- is_public is the master switch: nothing is visible publicly without it, no
-- matter what individual cards say.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text,
  is_public boolean not null default false,
  show_values boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_handle_format
    check (handle is null or handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "Collectors can read their own profile" on public.profiles;
create policy "Collectors can read their own profile"
on public.profiles for select
using (auth.uid() = user_id);

-- Only the shared ones, and only ever for reading.
drop policy if exists "Anyone can read shared profiles" on public.profiles;
create policy "Anyone can read shared profiles"
on public.profiles for select
using (is_public);

drop policy if exists "Collectors can create their profile" on public.profiles;
create policy "Collectors can create their profile"
on public.profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "Collectors can update their profile" on public.profiles;
create policy "Collectors can update their profile"
on public.profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Collectors can delete their profile" on public.profiles;
create policy "Collectors can delete their profile"
on public.profiles for delete
using (auth.uid() = user_id);

-- The public read surface. This view is the security boundary, not the cards
-- table: it runs as its owner, so the WHERE clause here is what decides who can
-- see what. Two rules are enforced by the column list rather than by policy,
-- because row-level security cannot hide a column:
--
--   * storage_container / section / slot are NEVER exposed. Together with a
--     value they would describe what is worth stealing and where it is kept.
--   * purchase_price, purchase_date and notes are private business.
--
-- current_value appears only when the collector has opted in separately.
drop view if exists public.public_cards;
create view public.public_cards
with (security_invoker = false) as
select
  c.id,
  p.handle,
  p.display_name,
  c.player, c.year, c.sport, c.card_set, c.card_number,
  c.team, c.parallel, c.grade, c.quantity,
  c.front_image_path, c.back_image_path,
  case when p.show_values then c.current_value else null end as current_value,
  c.created_at
from public.cards c
join public.profiles p on p.user_id = c.user_id
where c.visibility = 'public'
  and p.is_public;

-- Guarded so a missing role cannot abort the script and leave the schema
-- half-applied. Supabase always has both.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant select on public.public_cards to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.public_cards to authenticated';
  end if;
end $$;

create index if not exists cards_public_idx on public.cards (user_id) where visibility = 'public';
create index if not exists cards_front_path_idx on public.cards (front_image_path);
create index if not exists cards_back_path_idx on public.cards (back_image_path);

-- Scan usage log. Backs the per-user daily cap enforced by /api/scan-card so a
-- single account cannot run up the OpenAI bill.
create table if not exists public.scan_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists scan_events_user_created_idx on public.scan_events (user_id, created_at desc);

alter table public.scan_events enable row level security;

-- Collectors may read and append their own scan log. There is deliberately no
-- update or delete policy: without one, nobody can reset their own counter.
drop policy if exists "Collectors can read their scan history" on public.scan_events;
create policy "Collectors can read their scan history"
on public.scan_events for select
using (auth.uid() = user_id);

drop policy if exists "Collectors can record their scans" on public.scan_events;
create policy "Collectors can record their scans"
on public.scan_events for insert
with check (auth.uid() = user_id);

-- Collection value over time. Kept server-side so the growth chart follows a
-- collector between devices instead of restarting on each one.
create table if not exists public.collection_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists collection_snapshots_user_created_idx
  on public.collection_snapshots (user_id, created_at desc);

alter table public.collection_snapshots enable row level security;

drop policy if exists "Collectors can read their value history" on public.collection_snapshots;
create policy "Collectors can read their value history"
on public.collection_snapshots for select
using (auth.uid() = user_id);

drop policy if exists "Collectors can record their value history" on public.collection_snapshots;
create policy "Collectors can record their value history"
on public.collection_snapshots for insert
with check (auth.uid() = user_id);

-- Unlike scan_events, deleting is allowed here: this is the collector's own
-- history with no metering role, so pruning it is theirs to do.
drop policy if exists "Collectors can clear their value history" on public.collection_snapshots;
create policy "Collectors can clear their value history"
on public.collection_snapshots for delete
using (auth.uid() = user_id);

-- Client error log. Surfaces what is actually failing in real use instead of
-- waiting for someone to mention it. Deliberately holds no card data: only the
-- error, where it happened, the browser, and the build it came from.
create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context text,
  message text,
  detail text,
  user_agent text,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists error_events_created_idx on public.error_events (created_at desc);

alter table public.error_events enable row level security;

-- Collectors may record their own errors and read their own back. Reading
-- everyone's errors is done from the Supabase SQL editor, which bypasses RLS.
drop policy if exists "Collectors can record their errors" on public.error_events;
create policy "Collectors can record their errors"
on public.error_events for insert
with check (auth.uid() = user_id);

drop policy if exists "Collectors can read their errors" on public.error_events;
create policy "Collectors can read their errors"
on public.error_events for select
using (auth.uid() = user_id);

-- Housekeeping: these grow forever. Run occasionally, or schedule with pg_cron.
--   delete from public.error_events where created_at < now() - interval '90 days';
--   delete from public.scan_events  where created_at < now() - interval '90 days';

insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', false)
on conflict (id) do update set public = false;

-- A photo becomes readable by anyone exactly when the card it belongs to is
-- shared and its owner's profile is shared.
--
-- This has to go through a security-definer function. A subquery written
-- directly into the policy runs with the caller's own privileges, so an
-- anonymous visitor cannot see the cards row that would prove the photo is
-- shareable, and every public photo is denied. The function answers one
-- boolean about a path the caller already holds and reveals nothing else.
create or replace function public.is_shared_card_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.cards c
    join public.profiles p on p.user_id = c.user_id
    where p.is_public
      and c.visibility = 'public'
      and (c.front_image_path = object_name or c.back_image_path = object_name)
  );
$$;

revoke all on function public.is_shared_card_photo(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.is_shared_card_photo(text) to anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_shared_card_photo(text) to authenticated';
  end if;
end $$;

drop policy if exists "Anyone can read photos of shared cards" on storage.objects;
create policy "Anyone can read photos of shared cards"
on storage.objects for select
using (bucket_id = 'card-photos' and public.is_shared_card_photo(name));

drop policy if exists "Collectors can read their card photos" on storage.objects;
create policy "Collectors can read their card photos"
on storage.objects for select
using (
  bucket_id = 'card-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Collectors can upload their card photos" on storage.objects;
create policy "Collectors can upload their card photos"
on storage.objects for insert
with check (
  bucket_id = 'card-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Collectors can update their card photos" on storage.objects;
create policy "Collectors can update their card photos"
on storage.objects for update
using (
  bucket_id = 'card-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'card-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Collectors can delete their card photos" on storage.objects;
create policy "Collectors can delete their card photos"
on storage.objects for delete
using (
  bucket_id = 'card-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

