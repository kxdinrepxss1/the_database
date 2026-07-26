# The Database

The Database is a mobile-friendly sports-card collection app that is awesome. It supports:

- collector accounts through Supabase
- private cloud-synced collections
- front and back card photos
- manual card entry, editing, pricing, and removal
- search and filtering
- collection value, cost, profit, and growth tracking
- install-to-home-screen support

## Project structure

- `worker/index.js` — the complete website and application logic
- `supabase/setup.sql` — database, storage, and privacy policies
- `wrangler.toml` — configuration for independent Cloudflare Workers hosting
- `.dev.vars.example` — local environment-variable template

## Supabase setup

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/setup.sql`.
4. In **Authentication → URL Configuration**, set the Site URL and redirect
   URLs to the address where you deploy the app.

The SQL enables row-level security so signed-in users can only access their own
cards and photo folder.

## Run locally

Copy `.dev.vars.example` to `.dev.vars`, then enter your Supabase project URL
and publishable key.

```bash
npx wrangler dev
```

Open the local address Wrangler prints.

## Deploy independently

This source is already compatible with Cloudflare Workers:

```bash
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler deploy
```

Wrangler will create a public `workers.dev` address. A custom domain can be
connected later from the Cloudflare dashboard.

## Security notes

- Do not put a Supabase service-role key in this app.
- The Supabase publishable key is intended for browser clients; row-level
  security is what protects each collection.
- `.dev.vars` is excluded from Git by `.gitignore`.

