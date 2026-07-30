# The Database

The Database is a mobile-friendly sports-card collection app. It supports:

- collector accounts through Supabase
- private cloud-synced collections
- front and back card photos
- manual card entry, editing, pricing, and removal
- AI-assisted card recognition from a photo, reviewed before anything is saved
- search and filtering
- collection value, cost, profit, and growth tracking
- one-click export of the whole collection, photos included
- install-to-home-screen support

## Project structure

- `worker/index.js` — the complete website and application logic
- `supabase/setup.sql` — database, storage, and privacy policies
- `supabase/tests/` — optional checks for the row-level-security policies
- `test/` — rendering, scan limits, export archives, and error reporting
- `.github/workflows/test.yml` — runs those checks on every pull request
- `wrangler.toml` — configuration for independent Cloudflare Workers hosting
- `.dev.vars.example` — local environment-variable template

## Supabase setup

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/setup.sql`.
4. In **Authentication → URL Configuration**, set the Site URL and redirect
   URLs to the address where you deploy the app.

The SQL enables row-level security so signed-in users can only access their own
cards and photo folder. It is safe to re-run at any time, and you should re-run
it after pulling changes — the card scanner refuses to run until the
`scan_events` table it meters against exists, and error reporting is silently
skipped until `error_events` does.

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

## Tests

```bash
npm test
```

This renders every route, syntax-checks the client script the worker inlines,
exercises the scan endpoint's daily limit against a mocked Supabase and OpenAI,
parses a generated export archive back the way `unzip` does, and checks that
error reporting stays bounded. No network access or API keys needed.

The same suite runs on every pull request and every push to `main` via
`.github/workflows/test.yml`.

The policy tests under `supabase/tests/` are optional and need a scratch
PostgreSQL database — never point them at your real project:

```bash
psql "$SCRATCH_DB" -f supabase/tests/stub-supabase.sql
psql "$SCRATCH_DB" -f supabase/setup.sql
psql "$SCRATCH_DB" -f supabase/tests/policies.test.sql
```

They confirm that collectors cannot read each other's cards, cannot write rows
owned by someone else, and cannot clear their own scan counter.

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
