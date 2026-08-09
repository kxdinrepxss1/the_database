# The Database

The Database is a mobile-friendly sports-card collection app. It supports:

- collector accounts through Supabase
- private cloud-synced collections
- front and back card photos
- manual card entry, editing, and removal, with prices set inline on the grid
- structured storage locations, so a card can actually be found again
- AI-assisted card recognition from a photo, reviewed before anything is saved
- search and filtering, plus discovery search across shared collections
- public showcase pages, opt-in and off by default
- collection value, cost, profit, and growth tracking
- one-click export of the whole collection, photos included
- spreadsheet import, matching columns by name rather than position
- install-to-home-screen support

## Project structure

- `worker/index.js` — the complete website and application logic
- `supabase/setup.sql` — database, storage, and privacy policies
- `supabase/tests/` — checks for the row-level-security policies
- `test/` — rendering, scan limits, export archives, and error reporting
- `test/build-icons.mjs` — draws the app icons and writes them into the Worker
- `.github/workflows/test.yml` — runs those checks on every pull request
- `wrangler.toml` — configuration for independent Cloudflare Workers hosting
- `.dev.vars.example` — local environment-variable template

## Supabase setup

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/setup.sql`.
4. In **Authentication → URL Configuration**, set the Site URL and redirect
   URLs to the address where you deploy the app.

`setup.sql` checks itself. It refuses to start if a table it needs is already
owned by something with a different shape, naming what is wrong before changing
anything, and it asserts at the end that every expected table, column, view,
function and storage policy is in place — including that the public view exposes
no storage location, purchase price or note. A successful run prints:

```
NOTICE: setup.sql verified: schema in place and the public view exposes nothing private.
```

If you do not see that line, the script did not fully apply. Both of those
checks exist because "create table if not exists" is silent about the case that
has actually caused problems: a name already taken by something else, skipped
without complaint, failing much later somewhere confusing.

It also removes access rules it did not write, naming each one:

```
NOTICE: setup.sql removed 1 access rule(s) it did not define:
  public.cards: "Enable read access for all users"
```

Row-level security policies are combined with OR, not AND. One extra policy
saying `using (true)` therefore cancels every rule in this script at once — the
whole table becomes readable by anyone signed in — and because the script drops
its own policies by name, that extra one survives every re-run untouched.
Generated starter schemas hand out exactly that policy, under exactly that name.
If you see the notice above, something was reading more than it should have
been until you ran this. Policies on other storage buckets are left alone.

The SQL enables row-level security so signed-in users can only access their own
cards and photo folder. It is safe to re-run at any time, and you should re-run
it after pulling changes — the card scanner refuses to run until the
`scan_events` table it meters against exists, error reporting is silently
skipped until `error_events` does, and the growth chart stays device-local
until `collection_snapshots` does.

## Where cards live

A card records a **container** (Binder 2, Monster Box A), a **section** (Page 4,
Row 3) and a **slot**. The collection page filters by container and shows how
many cards each one holds, search covers all three parts, and the form suggests
containers and sections already in use so entries stay consistent.

Locations entered before these fields existed are split automatically, treating
both `/` and `,` as separators — cloud collections by `setup.sql`, device
collections on load. The original text is kept rather than dropped, so a wrong
split can always be traced back to what was typed.

## Sharing a collection

Nothing is public by default, and four independent switches have to line up:

1. **The profile switch.** A collector picks a handle and turns sharing on.
   Without it nothing is visible, whatever individual cards say.
2. **The card switch.** Each card is marked shared or not. Bulk actions on the
   account page set all of them at once.
3. **Listing.** Sharing gives you a link. Listing puts you on the public Search
   page where strangers can find you. Somebody who shared a collection to send
   a friend a link has not agreed to the second thing, so it is its own switch
   and it defaults to off — including for profiles that were already public.
4. **Values.** A separate opt-in. Prices stay hidden unless it is on.

Listing is enforced by the row-level-security policy rather than by the query,
so an unlisted profile cannot be found by asking differently. Its showcase page
still works: that reads `public_cards`, which runs as the view's owner and
checks the sharing switch instead.

**Storage locations, purchase prices, purchase dates and notes are never
shared, at all, by anyone.** A location plus a value describes what is worth
stealing and where it is kept, so those columns are simply absent from the
public view rather than filtered by policy.

Collector profiles live in `collector_profiles`, not `profiles`. Supabase's own
user-management quickstart creates a `public.profiles` table keyed on `id`, and
sharing that name means `create table if not exists` quietly skips creation and
then fails on the first policy referencing a column that table does not have.

The boundary is `public_cards`, a view that runs as its owner and selects only
the safe columns from cards belonging to shared profiles. Photos of shared
cards become readable through a matching storage policy; every other photo
stays closed. Turning the profile switch off closes both again immediately.

Two pages read that view and nothing else. **/search** is a directory of
collectors who have opted in — it lists them with their shared-card counts
before anything is typed, matches on handle and display name, and offers card
matches underneath as a second way in. **/c/&lt;handle&gt;** is one collector's
showcase. Both work signed out. An unknown handle and a collector who has
shared nothing look identical from outside, deliberately — neither confirms the
other exists.

Search terms are reduced to letters, digits, spaces and hyphens before they
reach the query. PostgREST filters are their own small language, and a
whitelist is the only shape that reliably keeps a search term from becoming
part of it.

`supabase/tests/sharing.test.sql` attacks this from the outside — as an
anonymous visitor and as a signed-in stranger — and every check passes only
when the attempt fails.

The app also asks for its own rows by user id rather than trusting the database
to filter them. Row-level security is still what keeps collections apart, but a
policy mistake then shows up as missing cards instead of as somebody else's
cards appearing in your collection, priced and counted as though they were
yours.

## How saving works

When signed in, every change is written to a local outbox before it is sent.
Saving a card, editing one, changing a price and removing a card all land there
first, so a save survives a refresh, a dead connection or a failed request.

The queue drains in order. A failure stops it rather than reordering, since a
later edit may depend on an earlier one, and it retries with a widening delay,
when the connection returns, and when the tab is focused again. A newer change
to a card replaces whatever was still pending for it, so repeated edits collapse
to one write and a delete cancels an unsent save.

The header carries the state: nothing while everything is synced, otherwise a
count. The account page spells out what is waiting and why, since phones have no
tooltips.

Collection value over time is recorded to `collection_snapshots`, so the growth
chart follows a collector between devices. Signing in on a device that already
has a chart carries that history up rather than discarding it. Snapshots are
deliberately best-effort and are not queued through the outbox: one is a single
point on a trend line, whereas a card is the collector's actual data. Writes are
debounced, so a burst of price edits leaves one point rather than one per
keystroke.

## Reports

The directory lists every collector who opts in, and handles are checked for
shape but not for meaning, so nothing stops one being a slur. Every showcase
page carries a **Report this collection** link. It works signed out on purpose:
a visitor who is not a collector is exactly who will notice a problem first, and
making them sign up to say so means they will not say so.

Reports are insert-only. Nobody can read them back through the API, whatever
role they hold, because a table of accusations that collectors could read would
be worse than the thing it reports. Read them from the SQL editor, which
bypasses row-level security:

```sql
select created_at, reported_handle, reason, detail
from public.reports order by created_at desc limit 50;
```

To act on one, close the collection down:

```sql
update public.collector_profiles set is_public = false, is_listed = false
where handle = 'whoever';
```

A signed-in reporter may only file as themselves and an anonymous one files as
nobody, so a report cannot be put in somebody else's name. The app thanks the
reporter rather than promising an outcome, because none can be guaranteed.

## Seeing what is failing

Signed-in clients record their own failures to `error_events`. Reports contain
the error, where it happened, the browser, and the build — never card data.
Read them from the Supabase SQL editor, which bypasses row-level security:

```sql
select created_at, app_version, context, message, count(*) over () as total
from public.error_events
where created_at > now() - interval '7 days'
order by created_at desc
limit 50;
```

Reporting is bounded on purpose: identical errors are recorded once per page
load and capped at ten per session, so a failure loop cannot flood the table.
Bump `VERSION` in `worker/index.js` when the client script changes — it names
the service-worker cache and stamps each report, which is what lets you tell
whether a report came from the build you just shipped.

## Configuration

| Name | Where it goes | Required | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_URL` | `wrangler.toml` `[vars]` | yes | Supabase project address |
| `SUPABASE_PUBLISHABLE_KEY` | `wrangler.toml` `[vars]` | yes | Browser-side Supabase key |
| `OPENAI_API_KEY` | Wrangler **secret** | no | Enables the card scanner |
| `OPENAI_VISION_MODEL` | `wrangler.toml` `[vars]` | no | Defaults to `gpt-4.1-mini` |
| `SCAN_DAILY_LIMIT` | `wrangler.toml` `[vars]` | no | Scans per account per day, default 25 |

The Supabase URL and publishable key live in `wrangler.toml` on purpose: the
publishable key is designed for browser clients, and row-level security is what
actually protects each collection. `OPENAI_API_KEY` is a real secret and must
never go in `wrangler.toml`.

Without `OPENAI_API_KEY` the app still works, and the Scan page reshapes itself
into a plain photo-capture flow: photograph the front and back, or choose
photos already on the device, then fill in the details by hand. Nothing in the
interface promises recognition the deployment cannot perform. Add the key later
and the page turns back into the AI scanner on its own — no code change needed.

## Run locally

Copy `.dev.vars.example` to `.dev.vars`, then fill in your values.

```bash
npx wrangler dev
```

Open the local address Wrangler prints.

## Exporting a collection

**Account → Export my collection** downloads a dated `.zip` containing:

- `collection.json` — complete records, the format to restore or migrate from
- `collection.csv` — the same cards as a spreadsheet
- `photos/` — every front and back image, named by card id
- `README.txt` — a plain description of the above

The ZIP is built in the browser with no external library, so nothing is
uploaded anywhere to produce it. Take one before any release that changes how
cards are stored.

## Importing a spreadsheet

**Account → Import a spreadsheet** reads a `.csv` and shows what it found
before writing anything. A lot of collectors already keep their collection in a
spreadsheet, and without this that is a reason not to use the app rather than a
way into it — nobody retypes three hundred cards.

Columns are matched **by name, never by position**. A file whose columns have to
be in a fixed order is a file almost nobody already has. Headers are lowercased
and stripped of punctuation, and `#` becomes the word `number`, so `Card #`,
`card_number` and `No.` all mean the same column. Each field accepts several
names: `Paid`, `Cost` and `Purchase Price` all land on the purchase price.

Exact names are matched first, then headers that merely begin or end with a
known word, so `My Notes` and `Card Notes` both reach the notes field. That
second pass ignores words shorter than four characters — matching on `no` would
route a notes column into the card number — and never matches on `name` alone,
since `Card Name` and `Team Name` want different fields.

Only a player column is required. A file without one is refused outright rather
than importing a pile of blanks; every other field falls back to the same
default the manual form uses. Rows with no player name are skipped, which is
usually the blank line at the end of the file. Columns nobody recognises are
ignored and listed by name in the preview, so nothing disappears silently.

A single location column is split on `/` and `,` into container, section and
slot, the same way `setup.sql` splits older records. Cards that look like ones
already held are flagged in the preview but not blocked — the collector knows
their own collection better than the duplicate check does.

The app's own `collection.csv` imports cleanly, so an export is a backup you can
actually restore. Imported cards are private and unshared regardless of what the
file says, and they go through the same outbox as everything else, so a large
import survives a dropped connection.

## Tests

```bash
npm test
```

This renders every route, syntax-checks the client script the worker inlines,
exercises the scan endpoint's daily limit against a mocked Supabase and OpenAI,
parses a generated export archive back the way `unzip` does, and checks that
error reporting stays bounded. No network access or API keys needed.

There is also a browser suite, kept separate because it needs Chromium:

```bash
npm install
npm run test:browser
```

It serves the worker over HTTP and drives the signed-out path in a real
browser — adding a card, pricing it, hitting the duplicate warning, and
upgrading a collection saved under the older price format — failing on any
uncaught error. The other suites only parse the client script, so they cannot
catch a reference to a variable that no longer exists; this one can.

Both run on every pull request and every push to `main` via
`.github/workflows/test.yml`.

## Measuring performance

```bash
npm run perf            # 100 cards, 40ms simulated latency
node test/perf.mjs 500 80
```

Serves the worker with a mock backend that delays every call, then reports how
long the collection takes to appear and how many backend requests it took.

Photo URLs are signed rather than public, so each one costs a round-trip. Cards
are rendered as soon as the rows arrive and photos are attached afterwards,
signed in a single bulk request and cached for their lifetime. Before that,
signing ran one request per photo in sequence and nothing rendered until it
finished — a 100-card collection took about ten seconds to show a single card.

Bandwidth is the other half. A signed URL carries a token, so reissuing one
changes the address and the browser downloads a photo it already has. At a
two-hour expiry a 100-card collection re-fetched its ~24MB of images every time
somebody came back, which is about a gigabyte a month for one person. URLs now
last a week, uploads carry a cache header, and the grid draws thumbnails rather
than pulling full 900px photos into 300px tiles. Cards saved before thumbnails
existed fall back to the full image and get one next time they are edited.

## Policy tests

The privacy rules are SQL, so checking them needs a real PostgreSQL. Point
`DATABASE_URL` at a scratch database — never your real project, since these
suites create users, plant deliberately broken policies, and delete rows:

```bash
DATABASE_URL=postgres://... supabase/tests/run.sh
```

They confirm that collectors cannot read each other's cards, cannot write rows
owned by someone else, and cannot clear their own scan counter; that an
anonymous visitor and a signed-in stranger both see only what was shared; and
that a stray permissive policy planted on the cards table leaks the collection
until `setup.sql` is re-run, and does not afterwards.

This job runs on every pull request. It used to be documented as optional,
which meant it never ran anywhere, which is how a real project ended up serving
one collector's whole collection — purchase prices included — to another.

## Deploy independently

This source is already compatible with Cloudflare Workers:

```bash
npx wrangler login
npx wrangler secret put OPENAI_API_KEY   # only if you want the scanner
npx wrangler deploy
```

Wrangler will create a public `workers.dev` address. A custom domain can be
connected later from the Cloudflare dashboard.

## Security notes

- Do not put a Supabase service-role key in this app.
- The Supabase publishable key is intended for browser clients; row-level
  security is what protects each collection.
- `OPENAI_API_KEY` is only ever used by the Worker, never sent to the browser.
- Card scans are capped per account per day so one signed-in user cannot run up
  your OpenAI bill. Raise or lower it with `SCAN_DAILY_LIMIT`.
- `.dev.vars` is excluded from Git by `.gitignore`.
