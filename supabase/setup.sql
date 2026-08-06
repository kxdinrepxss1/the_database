-- ---------------------------------------------------------------------------
-- Preflight.
--
-- Every "create table if not exists" below is silent about the case that has
-- actually bitten twice: a table of that name already exists, with a different
-- shape, so creation is skipped and the script fails later against columns that
-- were never there. Check the names we intend to claim before doing any work,
-- and say plainly what is wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  rec record;
begin
  for rec in
    select * from (values
      ('cards','user_id'),
      ('collector_profiles','user_id'),
      ('collection_snapshots','user_id'),
      ('scan_events','user_id'),
      ('error_events','user_id')
    ) as t(relname, keycol)
  loop
    if to_regclass('public.' || rec.relname) is not null
       and not exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = rec.relname and column_name = rec.keycol
       )
    then
      problems := problems || format('public.%s already exists but has no %s column', rec.relname, rec.keycol);
    end if;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception E'Cannot apply setup.sql:\n  %\n\nSomething unrelated already owns that name. Rename or drop it, then run this again. Nothing has been changed.',
      array_to_string(problems, E'\n  ');
  end if;
end $$;

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

-- Deliberately not called "profiles": Supabase's own user-management quickstart
-- creates a public.profiles table keyed on id, and "create table if not exists"
-- would silently skip creation and then fail on the first policy referencing a
-- column that table does not have.
--
-- Collector profiles. A profile exists only when someone chooses to share, and
-- is_public is the master switch: nothing is visible publicly without it, no
-- matter what individual cards say.
create table if not exists public.collector_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  display_name text,
  is_public boolean not null default false,
  show_values boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collector_profiles_handle_format
    check (handle is null or handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$')
);

alter table public.collector_profiles add column if not exists handle text;
alter table public.collector_profiles add column if not exists display_name text;
alter table public.collector_profiles add column if not exists is_public boolean not null default false;
alter table public.collector_profiles add column if not exists show_values boolean not null default false;

drop trigger if exists collector_profiles_touch_updated_at on public.collector_profiles;
create trigger collector_profiles_touch_updated_at
before update on public.collector_profiles
for each row execute function public.touch_updated_at();

alter table public.collector_profiles enable row level security;

drop policy if exists "Collectors can read their own profile" on public.collector_profiles;
create policy "Collectors can read their own profile"
on public.collector_profiles for select
using (auth.uid() = user_id);

-- Only the shared ones, and only ever for reading.
drop policy if exists "Anyone can read shared profiles" on public.collector_profiles;
create policy "Anyone can read shared profiles"
on public.collector_profiles for select
using (is_public);

drop policy if exists "Collectors can create their profile" on public.collector_profiles;
create policy "Collectors can create their profile"
on public.collector_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "Collectors can update their profile" on public.collector_profiles;
create policy "Collectors can update their profile"
on public.collector_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Collectors can delete their profile" on public.collector_profiles;
create policy "Collectors can delete their profile"
on public.collector_profiles for delete
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
join public.collector_profiles p on p.user_id = c.user_id
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

-- Discovery search runs ilike '%term%' across a few columns, which no ordinary
-- index can serve. Trigram indexes can. Guarded because the extension may not
-- be available everywhere, and search is merely slower without them.
do $$
begin
  create extension if not exists pg_trgm;
  execute 'create index if not exists cards_player_trgm_idx on public.cards using gin (player gin_trgm_ops)';
  execute 'create index if not exists cards_set_trgm_idx on public.cards using gin (card_set gin_trgm_ops)';
  execute 'create index if not exists cards_team_trgm_idx on public.cards using gin (team gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm unavailable; discovery search will work but scan more rows.';
end $$;
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

-- ---------------------------------------------------------------------------
-- Leaving.
--
-- Every table above hangs off auth.users with "on delete cascade", so removing
-- that one row removes the collection, the profile, the value history, the scan
-- counter and the error reports together. Nothing else has to be kept in step,
-- which is the point of doing it this way.
--
-- Deleting a user is normally an admin-API call needing the service-role key,
-- and that key must never go near this app -- it bypasses every rule in this
-- file. A security-definer function avoids it entirely. This one takes no
-- arguments and reads auth.uid() itself, so a caller cannot name somebody else
-- to delete: the only account reachable through it is the caller's own.
-- ---------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'delete_own_account requires a signed-in user';
  end if;

  -- Storage rows do not hang off auth.users, so they are removed explicitly.
  -- The client deletes the files first; this catches whatever it could not.
  delete from storage.objects
   where bucket_id = 'card-photos'
     and (storage.foldername(name))[1] = me::text;

  delete from auth.users where id = me;
end;
$$;

-- Signed in only, and never inherited by anonymous callers.
revoke all on function public.delete_own_account() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.delete_own_account() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.delete_own_account() to authenticated';
  end if;
end $$;

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
    join public.collector_profiles p on p.user_id = c.user_id
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

-- ---------------------------------------------------------------------------
-- Removing policies this script did not write.
--
-- Row-level security policies are OR'd together, not AND'd. One extra policy
-- reading "using (true)" therefore cancels every rule above it: the table is
-- open to anyone signed in, and nothing here would say so. Generated starter
-- schemas hand out exactly that policy under names like "Enable read access
-- for all users", and dropping the ones this script defines by name never
-- touches it, so it survives every re-run.
--
-- These tables belong to this script, so a policy on them that is not in the
-- list below is not part of the design and is removed. Each removal is named,
-- because silently deleting somebody's policy would be its own kind of trap.
-- Only storage policies that mention the card-photos bucket are considered --
-- other buckets are none of our business.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  removed text[] := '{}';
begin
  for rec in
    select p.schemaname, p.tablename, p.policyname
    from pg_policies p
    where (
        (p.schemaname = 'public'
         and p.tablename in ('cards','collector_profiles','scan_events',
                             'collection_snapshots','error_events'))
        or (p.schemaname = 'storage' and p.tablename = 'objects'
            and coalesce(p.qual, '') || coalesce(p.with_check, '') like '%card-photos%')
      )
      and p.policyname not in (
        'Collectors can read their cards',
        'Collectors can add their cards',
        'Collectors can update their cards',
        'Collectors can delete their cards',
        'Collectors can read their own profile',
        'Anyone can read shared profiles',
        'Collectors can create their profile',
        'Collectors can update their profile',
        'Collectors can delete their profile',
        'Collectors can read their scan history',
        'Collectors can record their scans',
        'Collectors can read their value history',
        'Collectors can record their value history',
        'Collectors can clear their value history',
        'Collectors can record their errors',
        'Collectors can read their errors',
        'Anyone can read photos of shared cards',
        'Collectors can read their card photos',
        'Collectors can upload their card photos',
        'Collectors can update their card photos',
        'Collectors can delete their card photos'
      )
  loop
    execute format('drop policy %I on %I.%I', rec.policyname, rec.schemaname, rec.tablename);
    removed := removed || format('%s.%s: "%s"', rec.schemaname, rec.tablename, rec.policyname);
  end loop;

  if array_length(removed, 1) is not null then
    raise notice E'setup.sql removed % access rule(s) it did not define:\n  %\nThese sat alongside the rules above and could widen who sees a collection.',
      array_length(removed, 1), array_to_string(removed, E'\n  ');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verification.
--
-- Everything above uses "create ... if not exists", which is idempotent but
-- silent: if an object of the same name already exists with a different shape,
-- creation is skipped and the failure surfaces much later as a confusing error
-- about a missing column, or not at all. That has happened twice.
--
-- This block asserts that the schema actually landed, and that the privacy
-- rules hold, every time the script is run against a real project. A failure
-- here names exactly what is wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  problems text[] := '{}';
  rec record;
begin
  for rec in
    select * from (values
      ('cards','user_id'), ('cards','visibility'), ('cards','current_value'),
      ('cards','storage_container'), ('cards','storage_section'), ('cards','storage_slot'),
      ('collector_profiles','user_id'), ('collector_profiles','handle'),
      ('collector_profiles','display_name'), ('collector_profiles','is_public'),
      ('collector_profiles','show_values'),
      ('collection_snapshots','user_id'), ('collection_snapshots','total'),
      ('scan_events','user_id'),
      ('error_events','user_id'), ('error_events','app_version'),
      ('public_cards','handle'), ('public_cards','player'), ('public_cards','current_value'),
      ('public_cards','front_image_path')
    ) as t(relname, colname)
  loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = rec.relname and column_name = rec.colname
    ) then
      problems := problems || format('missing: public.%s.%s', rec.relname, rec.colname);
    end if;
  end loop;

  -- The privacy rules, checked against the real database rather than assumed.
  for rec in
    select unnest(array['storage_container','storage_section','storage_slot','storage_location',
                        'purchase_price','purchase_date','notes','user_id','collection_status']) as colname
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'public_cards' and column_name = rec.colname
    ) then
      problems := problems || format('public_cards must not expose %s', rec.colname);
    end if;
  end loop;

  if not exists (select 1 from pg_proc where proname = 'is_shared_card_photo') then
    problems := problems || 'missing: public.is_shared_card_photo()';
  end if;

  if not exists (select 1 from pg_proc where proname = 'delete_own_account') then
    problems := problems || 'missing: public.delete_own_account()';
  end if;

  -- It takes no arguments on purpose. One that accepted a user id would be a
  -- way for any signed-in caller to delete anybody.
  if exists (
    select 1 from pg_proc where proname = 'delete_own_account' and pronargs > 0
  ) then
    problems := problems || 'public.delete_own_account() must take no arguments';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Anyone can read photos of shared cards'
  ) then
    problems := problems || 'missing storage policy: Anyone can read photos of shared cards';
  end if;

  -- Policies only apply where row-level security is switched on. With it off
  -- the table is simply open, and every rule above becomes decoration.
  for rec in
    select unnest(array['cards','collector_profiles','scan_events',
                        'collection_snapshots','error_events']) as relname
  loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = rec.relname and c.relrowsecurity
    ) then
      problems := problems || format('row-level security is off on public.%s', rec.relname);
    end if;
  end loop;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    problems := problems || 'row-level security is off on storage.objects, so every card photo is readable';
  end if;

  if array_length(problems, 1) is not null then
    raise exception E'setup.sql did not fully apply:\n  %\n\nThis usually means something of the same name already exists with a different shape. Inspect it, rename or drop it, then run this again.',
      array_to_string(problems, E'\n  ');
  end if;

  raise notice 'setup.sql verified: schema in place and the public view exposes nothing private.';
end $$;
