\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Two collectors.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com')
on conflict do nothing;

grant usage on schema public, storage to authenticated;
grant select, insert, update, delete
  on public.cards, public.scan_events, public.error_events,
     public.collection_snapshots, storage.objects
  to authenticated;

-- Start from a known state so this file can be run repeatedly.
delete from public.scan_events  where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.collection_snapshots where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.error_events where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.cards        where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into public.cards (id, user_id, player, updated_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice Card', now() - interval '5 days'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Bob Card',   now() - interval '5 days');

-- === updated_at trigger ===
update public.cards set player = 'Alice Card v2'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select 'updated_at trigger fires: ' ||
  case when updated_at > now() - interval '1 minute' then 'PASS' else 'FAIL' end
from public.cards where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- === RLS: act as Alice ===
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select 'alice sees only her cards: ' ||
  case when count(*) = 1 and min(player) = 'Alice Card v2' then 'PASS' else 'FAIL (saw ' || count(*) || ')' end
from public.cards;

-- Alice cannot write a row owned by Bob.
do $$
begin
  insert into public.cards (user_id, player)
  values ('22222222-2222-2222-2222-222222222222', 'Forged');
  raise notice 'cross-user insert blocked: FAIL';
exception when insufficient_privilege then
  raise notice 'cross-user insert blocked: PASS';
end $$;

-- === scan_events cap ===
insert into public.scan_events (user_id) values ('11111111-1111-1111-1111-111111111111');
insert into public.scan_events (user_id) values ('11111111-1111-1111-1111-111111111111');
select 'alice scan count in last 24h = 2: ' ||
  case when count(*) = 2 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.scan_events
where user_id = '11111111-1111-1111-1111-111111111111'
  and created_at >= now() - interval '24 hours';

-- Alice must NOT be able to wipe her own usage counter.
do $$
declare removed int;
begin
  delete from public.scan_events where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics removed = row_count;
  if removed = 0 then
    raise notice 'self-reset of scan counter blocked: PASS';
  else
    raise notice 'self-reset of scan counter blocked: FAIL (deleted %)', removed;
  end if;
exception when insufficient_privilege then
  raise notice 'self-reset of scan counter blocked: PASS';
end $$;

-- Alice cannot read Bob's scan history.
select 'alice cannot read bob scans: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.scan_events where user_id = '22222222-2222-2222-2222-222222222222';

-- === error_events ===
insert into public.error_events (user_id, context, message, app_version)
values ('11111111-1111-1111-1111-111111111111', 'card-save', 'something broke', 'v11');

select 'alice can record her own errors: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.error_events where user_id = '11111111-1111-1111-1111-111111111111';

-- Alice must not be able to file an error report as Bob.
do $$
begin
  insert into public.error_events (user_id, context, message)
  values ('22222222-2222-2222-2222-222222222222', 'forged', 'not mine');
  raise notice 'error report as another user blocked: FAIL';
exception when insufficient_privilege then
  raise notice 'error report as another user blocked: PASS';
end $$;

-- === collection_snapshots ===
insert into public.collection_snapshots (user_id, total, created_at) values
  ('11111111-1111-1111-1111-111111111111', 100.00, now() - interval '2 days'),
  ('11111111-1111-1111-1111-111111111111', 250.50, now());

select 'alice can record her value history: ' ||
  case when count(*) = 2 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collection_snapshots where user_id = '11111111-1111-1111-1111-111111111111';

-- Alice must not be able to write history onto Bob's account.
do $$
begin
  insert into public.collection_snapshots (user_id, total)
  values ('22222222-2222-2222-2222-222222222222', 999);
  raise notice 'value history as another user blocked: FAIL';
exception when insufficient_privilege then
  raise notice 'value history as another user blocked: PASS';
end $$;

-- Unlike the scan counter, a collector may clear their own history.
delete from public.collection_snapshots
 where user_id = '11111111-1111-1111-1111-111111111111'
   and total = 100.00;
select 'alice can prune her own history: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collection_snapshots where user_id = '11111111-1111-1111-1111-111111111111';

reset role;

-- Bob's history, inserted with RLS bypassed, must stay invisible to Alice.
insert into public.collection_snapshots (user_id, total)
values ('22222222-2222-2222-2222-222222222222', 4242);

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'alice cannot read bob value history: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collection_snapshots where user_id = '22222222-2222-2222-2222-222222222222';

-- Nor delete it.
do $$
declare removed int;
begin
  delete from public.collection_snapshots
   where user_id = '22222222-2222-2222-2222-222222222222';
  get diagnostics removed = row_count;
  if removed = 0 then
    raise notice 'deleting another collector history blocked: PASS';
  else
    raise notice 'deleting another collector history blocked: FAIL (deleted %)', removed;
  end if;
exception when insufficient_privilege then
  raise notice 'deleting another collector history blocked: PASS';
end $$;

reset role;

-- Bob's own error, inserted with RLS bypassed, must stay invisible to Alice.
insert into public.error_events (user_id, context, message)
values ('22222222-2222-2222-2222-222222222222', 'private', 'bob only');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'alice cannot read bob errors: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.error_events where user_id = '22222222-2222-2222-2222-222222222222';

reset role;

-- === Closing an account ===
-- The function takes no arguments and reads auth.uid() itself, so the only
-- account any caller can reach through it is their own.
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'leaver@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'stayer@example.com')
on conflict do nothing;

insert into public.cards (id, user_id, player, card_set) values
  ('55555555-0000-4000-8000-000000000001', '55555555-5555-5555-5555-555555555555', 'Leaver Card', 'Topps'),
  ('66666666-0000-4000-8000-000000000001', '66666666-6666-6666-6666-666666666666', 'Stayer Card', 'Topps')
on conflict do nothing;
insert into public.collector_profiles (user_id, handle, is_public) values
  ('55555555-5555-5555-5555-555555555555', 'leaver', true) on conflict do nothing;
insert into public.collection_snapshots (user_id, total) values
  ('55555555-5555-5555-5555-555555555555', 10) on conflict do nothing;
insert into storage.objects (bucket_id, name) values
  ('card-photos', '55555555-5555-5555-5555-555555555555/a-front.jpg'),
  ('card-photos', '66666666-6666-6666-6666-666666666666/b-front.jpg')
on conflict do nothing;

grant execute on function public.delete_own_account() to authenticated;

set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select public.delete_own_account();
reset role;

select 'deleting an account removes the auth user: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from auth.users where id = '55555555-5555-5555-5555-555555555555';

select 'it cascades to the cards: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.cards where user_id = '55555555-5555-5555-5555-555555555555';

select 'it cascades to the profile, closing the public page: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_profiles where user_id = '55555555-5555-5555-5555-555555555555';

select 'it cascades to the value history: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collection_snapshots where user_id = '55555555-5555-5555-5555-555555555555';

select 'it removes their photos, which no cascade reaches: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from storage.objects where name like '55555555-5555-5555-5555-555555555555/%';

-- The whole point: one account, not the neighbours.
select 'another collector is untouched: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.cards where user_id = '66666666-6666-6666-6666-666666666666';

select 'and so are their photos: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from storage.objects where name like '66666666-6666-6666-6666-666666666666/%';

-- Signed out, it must refuse rather than delete something arbitrary.
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.delete_own_account();
  raise notice 'deleting without a session is refused: FAIL';
exception when others then
  raise notice 'deleting without a session is refused: PASS';
end $$;
