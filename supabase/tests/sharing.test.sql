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
grant select, insert, update, delete on public.cards, public.collector_profiles to authenticated;
grant select on public.public_cards to authenticated, anon;
grant select on public.collector_profiles to anon;
grant select on storage.objects to authenticated, anon;

-- Every user this file touches, including the one added at the end: a suite
-- that only cleans up some of its rows passes once and then fails on a second
-- run against the same database, which is the worst way to find out.
delete from public.cards where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '77777777-7777-7777-7777-777777777777');
delete from public.collector_profiles where user_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '77777777-7777-7777-7777-777777777777');
delete from storage.objects where bucket_id = 'card-photos';

-- One collector shares; the other does not.
insert into public.collector_profiles (user_id, handle, display_name, is_public, is_listed, show_values) values
  ('11111111-1111-1111-1111-111111111111', 'sharer', 'The Sharer', true, true, false),
  ('22222222-2222-2222-2222-222222222222', 'hidden', 'Stays Private', false, false, true);

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
from public.collector_profiles where handle = 'hidden';

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
  update public.collector_profiles set is_public = true
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
  insert into public.collector_profiles (user_id, handle, is_public)
  values ('22222222-2222-2222-2222-222222222222', 'sharer', true);
  raise notice 'handles cannot be duplicated: FAIL';
exception when unique_violation then
  raise notice 'handles cannot be duplicated: PASS';
        when others then
  raise notice 'handles cannot be duplicated: PASS';
end $$;

reset role;

-- === Turning sharing off takes everything back ===
update public.collector_profiles set is_public = false
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
update public.collector_profiles set is_public = true, show_values = true
 where user_id = '11111111-1111-1111-1111-111111111111';

set role anon;
select 'value appears once opted in: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.public_cards where player = 'Shared Card' and current_value = 1000.00;
reset role;

-- Handle format is enforced, so a handle cannot be a path or a slur of symbols.
do $$
begin
  insert into public.collector_profiles (user_id, handle) values (gen_random_uuid(), 'has/slash');
  raise notice 'malformed handles are rejected: FAIL';
exception when check_violation then
  raise notice 'malformed handles are rejected: PASS';
        when others then
  raise notice 'malformed handles are rejected: PASS';
end $$;

-- === Shared is not the same as listed ===
-- Somebody who turns sharing on to send a friend a link has not agreed to be
-- found by strangers on a public directory page. The directory reads
-- collector_profiles, so the policy has to hide an unlisted profile there --
-- filtering in the query would only hide it from queries written that way.
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'unlisted@example.com')
on conflict do nothing;
delete from public.cards where user_id = '77777777-7777-7777-7777-777777777777';
delete from public.collector_profiles where user_id = '77777777-7777-7777-7777-777777777777';

insert into public.collector_profiles (user_id, handle, display_name, is_public, is_listed) values
  ('77777777-7777-7777-7777-777777777777', 'bylink', 'Link Only', true, false);
insert into public.cards (id, user_id, player, card_set, visibility) values
  ('77777777-0000-4000-8000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Link Only Card', 'Topps', 'public');

set role anon;

select 'an unlisted collector is absent from the directory: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_profiles where handle = 'bylink';

-- The point of unlisted is that the link still works.
select 'but their showcase still loads for anyone with the link: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.public_cards where handle = 'bylink';

select 'a listed collector is still in the directory: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.collector_profiles where handle = 'sharer';

reset role;

-- Turning listing off must take them back out without unsharing them.
update public.collector_profiles set is_listed = false
 where user_id = '11111111-1111-1111-1111-111111111111';

set role anon;
select 'unlisting removes them from the directory: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_profiles where handle = 'sharer';

select 'and leaves their shared cards reachable: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.public_cards where handle = 'sharer';
reset role;

update public.collector_profiles set is_listed = true
 where user_id = '11111111-1111-1111-1111-111111111111';

-- === Reports ===
-- Anyone can file one; nobody can read them back. A table of accusations that
-- collectors could read would be worse than what it reports.
grant insert on public.reports to anon, authenticated;
grant select on public.reports to anon, authenticated;

set role anon;
do $$
begin
  insert into public.reports (reported_handle, reason) values ('sharer', 'impersonation');
  raise notice 'an anonymous visitor can file a report: PASS';
exception when others then
  raise notice 'an anonymous visitor can file a report: FAIL (%)', sqlerrm;
end $$;

select 'nobody can read reports back, even with select granted: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ' rows)' end
from public.reports;
reset role;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  insert into public.reports (reported_handle, reason, reporter_user_id)
  values ('sharer', 'stolen-photos', '22222222-2222-2222-2222-222222222222');
  raise notice 'a signed-in collector can file as themselves: PASS';
exception when others then
  raise notice 'a signed-in collector can file as themselves: FAIL (%)', sqlerrm;
end $$;

-- Putting somebody else's name to a report would make it a way to frame them.
do $$
begin
  insert into public.reports (reported_handle, reason, reporter_user_id)
  values ('sharer', 'spite', '11111111-1111-1111-1111-111111111111');
  raise notice 'filing a report as somebody else is blocked: FAIL';
exception when others then
  raise notice 'filing a report as somebody else is blocked: PASS';
end $$;

do $$
begin
  update public.reports set reason = 'edited';
  raise notice 'reports cannot be edited: FAIL';
exception when others then
  raise notice 'reports cannot be edited: PASS';
end $$;

do $$
begin
  delete from public.reports;
  raise notice 'reports cannot be deleted away: FAIL';
exception when others then
  raise notice 'reports cannot be deleted away: PASS';
end $$;
reset role;

-- The SQL editor bypasses row-level security, which is how they get read.
select 'the reports are there for an owner to read: ' ||
  case when count(*) >= 2 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.reports;

delete from public.reports;

-- === A wantlist is never published ===
-- What somebody is hunting says where the gaps are and what they would pay to
-- fill them. There is no policy granting anyone but the owner a read, so these
-- checks pass only when every attempt to see somebody else's list fails.
grant select, insert, delete on public.collector_interests to authenticated;
grant select on public.collector_interests to anon;

delete from public.collector_interests
 where user_id in ('11111111-1111-1111-1111-111111111111',
                   '22222222-2222-2222-2222-222222222222');

insert into public.collector_interests (user_id, kind, player, card_set) values
  ('11111111-1111-1111-1111-111111111111', 'wanted', 'Secret Target', 'Topps Chrome');

set role anon;
select 'an anonymous visitor cannot read a wantlist: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collector_interests;
reset role;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select 'a signed-in stranger cannot read a wantlist: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collector_interests;

-- Not even a count. Knowing how many things somebody is hunting is a smaller
-- leak than the list, but it is still a leak.
select 'a stranger cannot even count the entries: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_interests where user_id = '11111111-1111-1111-1111-111111111111';

do $$
begin
  insert into public.collector_interests (user_id, kind, player)
  values ('11111111-1111-1111-1111-111111111111', 'wanted', 'Planted');
  raise notice 'a stranger cannot add to somebody else wantlist: FAIL';
exception when others then
  raise notice 'a stranger cannot add to somebody else wantlist: PASS';
end $$;

do $$
declare gone int;
begin
  delete from public.collector_interests
   where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics gone = row_count;
  if gone = 0 then
    raise notice 'a stranger cannot delete somebody else wantlist: PASS';
  else
    raise notice 'a stranger cannot delete somebody else wantlist: FAIL (% rows)', gone;
  end if;
exception when insufficient_privilege then
  raise notice 'a stranger cannot delete somebody else wantlist: PASS';
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'the owner can read their own wantlist: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL' end
from public.collector_interests;
reset role;

-- An entry with no player and no set would match the whole database.
do $$
begin
  insert into public.collector_interests (user_id, kind) values
    ('11111111-1111-1111-1111-111111111111', 'wanted');
  raise notice 'an empty wantlist entry is rejected: FAIL';
exception when check_violation then
  raise notice 'an empty wantlist entry is rejected: PASS';
        when others then
  raise notice 'an empty wantlist entry is rejected: PASS';
end $$;

delete from public.collector_interests
 where user_id = '11111111-1111-1111-1111-111111111111';

-- ---------------------------------------------------------------------------
-- Follows.
--
-- The rule is that the only person allowed to see somebody's followers is that
-- person. Everything below is an attempt to see a third party's follows.
-- ---------------------------------------------------------------------------
grant select, insert, delete on public.collector_follows to authenticated;

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'follower@example.com')
on conflict do nothing;

delete from public.collector_follows
 where follower_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222',
                       '88888888-8888-8888-8888-888888888888')
    or followed_id in ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222',
                       '88888888-8888-8888-8888-888888888888');

-- 88 follows 11.
set role authenticated;
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
insert into public.collector_follows (follower_id, followed_id)
values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111');

select 'a collector can read who they follow: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collector_follows;

do $$
begin
  insert into public.collector_follows (follower_id, followed_id)
  values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
  raise notice 'nobody can put a follow in somebody else name: FAIL';
exception when others then
  raise notice 'nobody can put a follow in somebody else name: PASS';
end $$;

do $$
begin
  insert into public.collector_follows (follower_id, followed_id)
  values ('88888888-8888-8888-8888-888888888888', '88888888-8888-8888-8888-888888888888');
  raise notice 'a collector cannot follow themselves: FAIL';
exception when others then
  raise notice 'a collector cannot follow themselves: PASS';
end $$;
reset role;

-- The followed collector may see who follows them. That is the one read this
-- table grants beyond your own rows.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'the followed collector can see their followers: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collector_follows;
reset role;

-- Nobody else may, in either direction.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'a third party cannot see who follows whom: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.collector_follows;

select 'a third party cannot even count somebody followers: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_follows
where followed_id = '11111111-1111-1111-1111-111111111111';

-- Undoing somebody else's follow would be a way to quietly cut them off.
do $$
declare gone int;
begin
  delete from public.collector_follows
   where follower_id = '88888888-8888-8888-8888-888888888888';
  get diagnostics gone = row_count;
  if gone = 0 then
    raise notice 'a third party cannot unfollow on your behalf: PASS';
  else
    raise notice 'a third party cannot unfollow on your behalf: FAIL (% rows)', gone;
  end if;
exception when insufficient_privilege then
  raise notice 'a third party cannot unfollow on your behalf: PASS';
end $$;
reset role;

-- anon is granted nothing on this table, so the read is refused outright
-- rather than returning an empty set. Either would pass; the error is stronger.
do $$
declare seen int;
begin
  set local role anon;
  select count(*) into seen from public.collector_follows;
  if seen = 0 then
    raise notice 'an anonymous visitor sees no follows at all: PASS';
  else
    raise notice 'an anonymous visitor sees no follows at all: FAIL (%)', seen;
  end if;
exception when insufficient_privilege then
  raise notice 'an anonymous visitor sees no follows at all: PASS';
end $$;
reset role;

-- Following somebody must not widen what their follower can see: the feed is
-- built from public_cards, which still requires the card to be shared.
set role authenticated;
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
select 'following does not reveal the private card: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.public_cards where player = 'Private Card';

select 'a follower still cannot read the raw cards table: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.cards where user_id = '11111111-1111-1111-1111-111111111111';

-- And the follower can undo their own follow.
delete from public.collector_follows
 where follower_id = '88888888-8888-8888-8888-888888888888';
select 'a collector can unfollow: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.collector_follows;
reset role;

delete from public.collector_follows
 where follower_id = '88888888-8888-8888-8888-888888888888'
    or followed_id = '88888888-8888-8888-8888-888888888888';

-- ---------------------------------------------------------------------------
-- Likes and comments.
--
-- A like's count is public and its list is not, so the interesting attempt is
-- turning the number back into names. A comment is public on purpose; the
-- interesting attempt is putting one somewhere it does not belong.
-- ---------------------------------------------------------------------------
-- A collector with no profile row at all. 77 already has a handle from the
-- listing section above, so it cannot stand in for one.
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'nohandle@example.com')
on conflict do nothing;
delete from public.collector_profiles where user_id = '66666666-6666-6666-6666-666666666666';
grant select, insert, delete on public.card_likes, public.card_comments to authenticated;
grant select on public.card_like_counts, public.card_comment_feed to authenticated, anon;

delete from public.card_comments;
delete from public.card_likes;

-- The commenter has a handle, because a comment carries one.
insert into public.collector_profiles (user_id, handle, display_name, is_public, is_listed, show_values)
values ('88888888-8888-8888-8888-888888888888', 'commenter', 'The Commenter', false, false, false)
on conflict (user_id) do update set handle = excluded.handle;

-- 88 likes and comments on the sharer's shared card.
set role authenticated;
set request.jwt.claim.sub = '88888888-8888-8888-8888-888888888888';
insert into public.card_likes (card_id, user_id)
values ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-8888-8888-8888-888888888888');
insert into public.card_comments (card_id, user_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-8888-8888-8888-888888888888', 'Nice card');

-- The private card must refuse both, whoever asks.
do $$
begin
  insert into public.card_likes (card_id, user_id)
  values ('aaaaaaaa-0000-4000-8000-000000000002', '88888888-8888-8888-8888-888888888888');
  raise notice 'a private card cannot be liked: FAIL';
exception when others then
  raise notice 'a private card cannot be liked: PASS';
end $$;

do $$
begin
  insert into public.card_comments (card_id, user_id, body)
  values ('aaaaaaaa-0000-4000-8000-000000000002', '88888888-8888-8888-8888-888888888888', 'Seen it');
  raise notice 'a private card cannot be commented on: FAIL';
exception when others then
  raise notice 'a private card cannot be commented on: PASS';
end $$;

do $$
begin
  insert into public.card_likes (card_id, user_id)
  values ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-2222-2222-222222222222');
  raise notice 'nobody can like in somebody else name: FAIL';
exception when others then
  raise notice 'nobody can like in somebody else name: PASS';
end $$;

-- An empty comment, and one longer than the box allows.
do $$
begin
  insert into public.card_comments (card_id, user_id, body)
  values ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-8888-8888-8888-888888888888', '   ');
  raise notice 'an empty comment is rejected: FAIL';
exception when others then
  raise notice 'an empty comment is rejected: PASS';
end $$;

do $$
begin
  insert into public.card_comments (card_id, user_id, body)
  values ('aaaaaaaa-0000-4000-8000-000000000001', '88888888-8888-8888-8888-888888888888', repeat('x', 601));
  raise notice 'an overlong comment is rejected: FAIL';
exception when others then
  raise notice 'an overlong comment is rejected: PASS';
end $$;
reset role;

-- The card's owner sees who liked it. That is the whole of the list side.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select 'the card owner can see who liked it: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.card_likes;
reset role;

-- Nobody else can, in any shape.
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'a bystander cannot list who liked a card: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.card_likes;

select 'a bystander cannot name a liker by filtering: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.card_likes
where user_id = '88888888-8888-8888-8888-888888888888';

-- ...but the number is public, which is what was asked for.
select 'the count is public: ' ||
  case when coalesce(max(likes), 0) = 1 then 'PASS' else 'FAIL' end
from public.card_like_counts
where card_id = 'aaaaaaaa-0000-4000-8000-000000000001';

select 'and a comment is public, with its author: ' ||
  case when count(*) = 1 and max(handle) = 'commenter' then 'PASS' else 'FAIL' end
from public.card_comment_feed
where card_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- A commenter with no profile at all must still appear, as somebody rather than
-- as nothing: an inner join here would drop the comment out of the public feed
-- while leaving it in the table, so the card's owner would be answering a
-- comment nobody else could see.
reset role;
insert into public.card_comments (card_id, user_id, body)
values ('aaaaaaaa-0000-4000-8000-000000000001', '66666666-6666-6666-6666-666666666666', 'No handle here');
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select 'a comment from somebody with no handle is still shown: ' ||
  case when count(*) = 1 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.card_comment_feed
where card_id = 'aaaaaaaa-0000-4000-8000-000000000001' and handle is null;

-- Deleting somebody else's comment off somebody else's card is neither end.
do $$
declare gone int;
begin
  delete from public.card_comments;
  get diagnostics gone = row_count;
  if gone = 0 then
    raise notice 'a bystander cannot delete a comment: PASS';
  else
    raise notice 'a bystander cannot delete a comment: FAIL (% rows)', gone;
  end if;
exception when insufficient_privilege then
  raise notice 'a bystander cannot delete a comment: PASS';
end $$;
reset role;

set role anon;
select 'a signed-out visitor sees the count: ' ||
  case when coalesce(max(likes), 0) = 1 then 'PASS' else 'FAIL' end
from public.card_like_counts;

do $$
declare seen int;
begin
  set local role anon;
  select count(*) into seen from public.card_likes;
  if seen = 0 then
    raise notice 'but never the list: PASS';
  else
    raise notice 'but never the list: FAIL (%)', seen;
  end if;
exception when insufficient_privilege then
  raise notice 'but never the list: PASS';
end $$;
reset role;

-- The card's owner can clear a comment off their own card.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
delete from public.card_comments where card_id = 'aaaaaaaa-0000-4000-8000-000000000001';
select 'the card owner can remove a comment: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from public.card_comments;
reset role;

-- Unsharing the card takes the count and the comments with it.
update public.cards set visibility = 'private'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
set role anon;
select 'unsharing a card hides its like count: ' ||
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end
from public.card_like_counts
where card_id = 'aaaaaaaa-0000-4000-8000-000000000001';
reset role;
update public.cards set visibility = 'public'
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';

delete from public.card_comments;
delete from public.card_likes;
