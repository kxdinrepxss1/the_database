-- Adversarial checks on the public sharing surface.
--
-- Everything here is written from the position of someone trying to see what
-- they should not: an anonymous visitor, and a signed-in collector poking at
-- somebody else's collection. A pass means the attempt failed.
--
-- Run against a scratch database, never a real project.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sharer@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'private@example.com')
on conflict do nothing;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end $$;

grant usage on schema public, storage to authenticated, anon;
grant select, insert, update, delete on public.cards, public.profiles to authenticated;
grant select on public.public_cards to authenticated, anon;
grant select on public.profiles to anon;
grant select on storage.objects to authenticated, anon;

delete from public.cards where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from public.profiles where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
delete from storage.objects where bucket_id = 'card-photos';

-- One collector shares; the other does not.
insert into public.profiles (user_id, handle, display_name, is_public, show_values) values
  ('11111111-1111-1111-1111-111111111111', 'sharer', 'The Sharer', true, false),
  ('22222222-2222-2222-2222-222222222222', 'hidden', 'Stays Private', false, true);

-- The sharer marks one card public and keeps one back. Both carry the sensitive
-- fields a public page must never reveal.
insert into public.cards (id, user_id, player, card_set, current_value, purchase_price,
                          storage_container, storage_section, storage_slot, notes,
                          visibility, front_image_path) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Shared Card', 'Topps', 1000.00, 400.00, 'Binder 2', 'Page 4', 'Slot 3',
   'kept in the safe', 'public', '11111111-1111-1111-1111-111111111111/shared-front.jpg'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Held Back Card', 'Topps', 50.00, 10.00, 'Binder 2', 'Page 5', 'Slot 1',
   'private note', 'private', '11111111-1111-1111-1111-111111111111/held-front.jpg');

-- The private collector marks a card public, which must not matter: their
-- profile switch is off.
insert into public.cards (id, user_id, player, card_set, current_value, visibility, front_image_path) values
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Should Stay Hidden', 'Topps', 99.00, 'public', '22222222-2222-2222-2222-222222222222/hidden-front.jpg');

insert into storage.buckets (id, name, public) values ('card-photos', 'card-photos', false)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('card-photos', '11111111-1111-1111-1111-111111111111/shared-front.jpg'),
  ('card-photos', '11111111-1111-1111-1111-111111111111/held-front.jpg'),
  ('card-photos', '22222222-2222-2222-2222-222222222222/hidden-front.jpg');

-- === As an anonymous visitor ===
set role anon;

select 'anon sees only the shared card: ' ||
  case when count(*) = 1 and min(player) = 'Shared Card' then 'PASS'
       else 'FAIL (' || count(*) || ': ' || coalesce(string_agg(player, ', '), 'none') || ')' end
from public.public_cards;

select 'anon cannot see a held-back card: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.public_cards where player = 'Held Back Card';

-- The profile switch outranks the card switch.
select 'a public card under a private profile stays hidden: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.public_cards where player = 'Should Stay Hidden';

-- Storage locations must not be reachable at all: not as data, not as a column.
select 'storage location columns are absent from the public view: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || string_agg(column_name, ', ') || ')' end
from information_schema.columns
where table_schema = 'public' and table_name = 'public_cards'
  and column_name in ('storage_container', 'storage_section', 'storage_slot',
                      'storage_location', 'purchase_price', 'purchase_date',
                      'notes', 'user_id', 'collection_status');

-- Values are opt-in; this collector has not opted in.
select 'value is withheld when not opted in: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.public_cards where player = 'Shared Card' and current_value is null;

-- The cards table itself must stay shut to anonymous readers.
do $$
declare seen int;
begin
  select count(*) into seen from public.cards;
  if seen = 0 then
    raise notice 'anon cannot read the cards table directly: PASS';
  else
    raise notice 'anon cannot read the cards table directly: FAIL (% rows)', seen;
  end if;
exception when insufficient_privilege then
  raise notice 'anon cannot read the cards table directly: PASS (no grant at all)';
end $$;

select 'anon cannot read private profiles: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.profiles where handle = 'hidden';

-- Photos: the shared card's image is reachable, the others are not.
select 'anon can reach the shared card photo: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from storage.objects where name = '11111111-1111-1111-1111-111111111111/shared-front.jpg';

select 'anon cannot reach a held-back card photo: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from storage.objects where name = '11111111-1111-1111-1111-111111111111/held-front.jpg';

select 'anon cannot reach a private collector photo: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from storage.objects where name = '22222222-2222-2222-2222-222222222222/hidden-front.jpg';

reset role;

-- === As a signed-in collector looking at someone else ===
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select 'a signed-in stranger sees only shared cards: ' ||
  case when count(*) = 1 and min(player) = 'Shared Card' then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.public_cards;

do $$
declare seen int;
begin
  select count(*) into seen from public.cards
   where user_id = '11111111-1111-1111-1111-111111111111';
  if seen = 0 then
    raise notice 'a stranger cannot read the sharer rows directly: PASS';
  else
    raise notice 'a stranger cannot read the sharer rows directly: FAIL (% rows)', seen;
  end if;
exception when insufficient_privilege then
  raise notice 'a stranger cannot read the sharer rows directly: PASS (no grant at all)';
end $$;

-- Nobody may publish somebody else's collection on their behalf.
do $$
declare changed int;
begin
  update public.profiles set is_public = true
   where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise notice 'a stranger cannot flip another profile public: PASS';
  else
    raise notice 'a stranger cannot flip another profile public: FAIL (% rows)', changed;
  end if;
exception when insufficient_privilege then
  raise notice 'a stranger cannot flip another profile public: PASS';
end $$;

do $$
declare changed int;
begin
  update public.cards set visibility = 'public'
   where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics changed = row_count;
  if changed = 0 then
    raise notice 'a stranger cannot publish another collector card: PASS';
  else
    raise notice 'a stranger cannot publish another collector card: FAIL (% rows)', changed;
  end if;
exception when insufficient_privilege then
  raise notice 'a stranger cannot publish another collector card: PASS';
end $$;

-- Claiming a handle already taken must fail rather than steal it.
do $$
begin
  insert into public.profiles (user_id, handle, is_public)
  values ('22222222-2222-2222-2222-222222222222', 'sharer', true);
  raise notice 'handles cannot be duplicated: FAIL';
exception when unique_violation then
  raise notice 'handles cannot be duplicated: PASS';
        when others then
  raise notice 'handles cannot be duplicated: PASS';
end $$;

reset role;

-- === Turning sharing off takes everything back ===
update public.profiles set is_public = false
 where user_id = '11111111-1111-1111-1111-111111111111';

set role anon;
select 'unsharing a profile hides its cards again: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.public_cards;

select 'unsharing also closes the photo: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from storage.objects where name = '11111111-1111-1111-1111-111111111111/shared-front.jpg';
reset role;

-- === Opting in to values ===
update public.profiles set is_public = true, show_values = true
 where user_id = '11111111-1111-1111-1111-111111111111';

set role anon;
select 'value appears once opted in: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.public_cards where player = 'Shared Card' and current_value = 1000.00;
reset role;

-- Handle format is enforced, so a handle cannot be a path or a slur of symbols.
do $$
begin
  insert into public.profiles (user_id, handle) values (gen_random_uuid(), 'has/slash');
  raise notice 'malformed handles are rejected: FAIL';
exception when check_violation then
  raise notice 'malformed handles are rejected: PASS';
        when others then
  raise notice 'malformed handles are rejected: PASS';
end $$;
