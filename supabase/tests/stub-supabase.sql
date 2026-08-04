-- Minimal stand-ins for the Supabase-managed objects that setup.sql depends on,
-- so the real setup.sql can be executed and inspected locally.
create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);

-- Supabase ships this table with row-level security already on. Without it the
-- policies in setup.sql are inert and any test of them silently passes.
alter table storage.objects enable row level security;

-- auth.uid() reads the request-scoped claim, mirroring Supabase's behaviour.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/');
$$;

-- Roles PostgREST connects as. Supabase provides both; without them the grants
-- in setup.sql fail and leave the schema half-applied.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;
