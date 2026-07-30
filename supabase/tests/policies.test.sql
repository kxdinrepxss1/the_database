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
  on public.cards, public.scan_events, public.error_events, storage.objects
  to authenticated;

-- Start from a known state so this file can be run repeatedly.
delete from public.scan_events  where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
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
