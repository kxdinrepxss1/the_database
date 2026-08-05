-- A policy this script did not write must not be able to open a collection.
--
-- Row-level security policies are combined with OR, not AND. A single extra
-- policy saying "using (true)" therefore cancels every rule in setup.sql at
-- once, and because setup.sql drops its own policies by name, that extra one
-- survives every re-run untouched. Generated starter schemas hand out exactly
-- this policy, usually called "Enable read access for all users".
--
-- This test plants one, proves it leaks, then proves setup.sql removes it.
--
-- Run from the repository root, against a scratch database, never a real
-- project. It expects stub-supabase.sql and setup.sql to have run already.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'owner@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com')
on conflict do nothing;

delete from public.cards where user_id in ('33333333-3333-3333-3333-333333333333',
                                           '44444444-4444-4444-4444-444444444444');

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.cards to authenticated;

-- Private in every sense: not shared, and carrying the fields a public page
-- can never show.
insert into public.cards (id, user_id, player, card_set, current_value, purchase_price,
                          storage_container, notes, visibility) values
  ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333',
   'Kept Private', 'Topps', 1436.00, 575.50, 'Binder 2', 'in the safe', 'private');

-- === The hazard, demonstrated ===
create policy "Enable read access for all users" on public.cards for select using (true);

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select 'a stray permissive policy does leak the table (the bug being fixed): ' ||
  case when count(*) = 1 then 'CONFIRMED' else 'NOT REPRODUCED - this test proves nothing' end
from public.cards where player = 'Kept Private';

reset role;

-- === Re-running setup.sql must take it back ===
\i supabase/setup.sql

select 'setup.sql removed the stray policy: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from pg_policies
where schemaname = 'public' and tablename = 'cards'
  and policyname = 'Enable read access for all users';

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select 'a stranger can no longer read the card: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.cards where player = 'Kept Private';

reset role;
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

-- The cure must not be worse than the disease.
select 'the owner still reads their own card: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.cards where player = 'Kept Private';

reset role;

-- The policies setup.sql does define must all have survived the sweep.
select 'setup.sql kept its own policies: ' ||
  case when count(*) = 4 then 'PASS' else 'FAIL (' || count(*) || ' of 4)' end
from pg_policies where schemaname = 'public' and tablename = 'cards';

-- A policy on somebody else's bucket is none of our business.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
on conflict (id) do nothing;
drop policy if exists "Unrelated bucket policy" on storage.objects;
create policy "Unrelated bucket policy" on storage.objects for select
using (bucket_id = 'avatars');

\i supabase/setup.sql

select 'a policy for an unrelated bucket is left alone: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname = 'Unrelated bucket policy';

drop policy if exists "Unrelated bucket policy" on storage.objects;
