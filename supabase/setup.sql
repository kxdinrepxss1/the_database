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
  collection_status text default 'Personal collection',
  notes text,
  front_image_path text,
  back_image_path text,
  visibility text not null default 'private',
  listing_status text not null default 'not_listed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cards_user_created_idx on public.cards (user_id, created_at desc);

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

