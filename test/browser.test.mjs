// Runs the app in a real browser and fails on any uncaught error.
//
// The other suites only parse the client script, so they cannot catch a
// reference to a variable that no longer exists — that is a runtime failure,
// not a syntax one. This suite exercises the signed-out path end to end, which
// needs no backend: cards save to localStorage and every render path runs.
//
// The worker is served over HTTP rather than from files, so routing, the
// manifest and the service worker all behave as they do in production.
//
// Not part of `npm test` because it needs a browser. CI runs it as its own job.
import worker from "../worker/index.js";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// SUPABASE_URL is filled in once the server has a port: the mock Supabase is
// served from the same origin as the app, so the client talks to it normally.
const env = { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "test-key" };

// Minimal stand-in for the Supabase endpoints the client uses, plus a switch
// for making writes fail so the outbox can be observed holding on to them.
const backend = { cards: [], snapshots: [], profiles: [], takenHandles: [], patches: [], publicCards: [], publicQueries: [], publicProfiles: [], collectorQueries: [], cardQueries: [], accountDeletes: 0, photoDeletes: [], failDelete: false, reports: [], failReport: false, interests: [], follows: [], followQueries: [], failWrites: false, noSnapshotTable: false, writeAttempts: 0, signCalls: 0 };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.c" };

async function supabase(req, url, body) {
  if (url.pathname.startsWith("/auth/v1/user")) return [200, USER];
  if (url.pathname.startsWith("/auth/v1/token")) return [200, { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER }];
  if (url.pathname === "/rest/v1/collector_interests") {
    if (req.method === "GET") {
      const id = decodeURIComponent((url.search.match(/user_id=eq\.([^&]+)/) || [])[1] || "");
      return [200, backend.interests.filter((w) => w.user_id === id)];
    }
    if (req.method === "POST") {
      const row = JSON.parse(body);
      backend.interests.push({ ...row, id: "want-" + backend.interests.length, created_at: new Date().toISOString() });
      return [201, null];
    }
    if (req.method === "DELETE") {
      const id = decodeURIComponent((url.search.match(/id=eq\.([^&]+)/) || [])[1] || "");
      backend.interests = backend.interests.filter((w) => w.id !== id);
      return [204, null];
    }
  }
  if (url.pathname === "/rest/v1/collector_follows") {
    const one = (re) => decodeURIComponent((url.search.match(re) || [])[1] || "");
    if (req.method === "GET") {
      backend.followQueries.push(url.search);
      const follower = one(/follower_id=eq\.([^&]+)/), followed = one(/followed_id=eq\.([^&]+)/);
      // The real table's policy only returns rows the reader is a side of, so
      // the mock refuses to answer a query that names neither.
      if (!follower && !followed) return [403, { message: "row-level security" }];
      return [200, backend.follows.filter((f) =>
        (!follower || f.follower_id === follower) && (!followed || f.followed_id === followed))];
    }
    if (req.method === "POST") {
      const row = JSON.parse(body);
      if (row.follower_id === row.followed_id) return [400, { message: "collector_follows_not_self" }];
      backend.follows = backend.follows
        .filter((f) => !(f.follower_id === row.follower_id && f.followed_id === row.followed_id))
        .concat({ ...row, created_at: new Date().toISOString() });
      return [201, null];
    }
    if (req.method === "DELETE") {
      const follower = one(/follower_id=eq\.([^&]+)/), followed = one(/followed_id=eq\.([^&]+)/);
      backend.follows = backend.follows.filter((f) =>
        !(f.follower_id === follower && f.followed_id === followed));
      return [204, null];
    }
  }
  if (url.pathname === "/rest/v1/reports") {
    if (backend.failReport) return [500, { message: "could not file" }];
    backend.reports.push(JSON.parse(body || "{}"));
    return [201, null];
  }
  if (url.pathname === "/rest/v1/rpc/delete_own_account") {
    backend.accountDeletes++;
    if (backend.failDelete) return [500, { message: "could not delete" }];
    backend.cards = []; backend.profiles = []; backend.snapshots = [];
    return [204, null];
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/storage/v1/object/card-photos/")) {
    backend.photoDeletes.push(url.pathname.replace("/storage/v1/object/card-photos/", ""));
    return [200, {}];
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    let parsed = {}; try { parsed = JSON.parse(body || "{}"); } catch {}
    // The signed URL names the file it points at, so a test can tell whether
    // the page asked for a thumbnail or the full photo. Real signed URLs do
    // the same; they carry the object path plus a token.
    const sign = (path) => "/photo.jpg?p=" + encodeURIComponent(path) + "&token=x";
    if (Array.isArray(parsed.paths)) {
      backend.signCalls++;
      return [200, parsed.paths.map((path) => ({ path, signedURL: sign(path) }))];
    }
    backend.signCalls++;
    return [200, { signedURL: sign(url.pathname.replace("/storage/v1/object/sign/card-photos/", "")) }];
  }
  if (url.pathname.startsWith("/storage/v1/")) return [200, {}];
  if (url.pathname === "/rest/v1/collection_snapshots") {
    // What Supabase actually returns when setup.sql has not been re-run.
    if (backend.noSnapshotTable) return [404, { message: "Could not find the table 'public.collection_snapshots' in the schema cache" }];
    if (req.method === "GET") return [200, backend.snapshots];
    if (req.method === "POST") {
      const rows = JSON.parse(body);
      backend.snapshots = backend.snapshots.concat(Array.isArray(rows) ? rows : [rows]);
      return [201, null];
    }
  }
  if (url.pathname === "/rest/v1/public_cards") {
    backend.publicQueries.push(url.search);
    const handle = (url.search.match(/handle=eq\.([^&]+)/) || [])[1];
    const or = (url.search.match(/or=\(([^)]*)\)/) || [])[1] || "";
    let rows = backend.publicCards;
    if (handle) rows = rows.filter((r) => r.handle === decodeURIComponent(handle));
    const inList = (url.search.match(/handle=in\.\(([^)]*)\)/) || [])[1];
    if (inList) {
      const wanted = decodeURIComponent(inList).replace(/"/g, "").split(",");
      rows = rows.filter((r) => wanted.includes(r.handle));
    }
    if (or) {
      // Mirror PostgREST closely enough to be worth testing against. or=(...)
      // is a list of alternatives: a bare predicate, or an and(...) group whose
      // parts must all hold. A mock that only read the player term let a
      // team-only wantlist entry through as a match on everything.
      const predicate = (row, part) => {
        const like = part.match(/^(\w+)\.ilike\.(.*)$/);
        if (like) return String(row[like[1]] || "").toLowerCase()
          .includes(decodeURIComponent(like[2]).replace(/\*/g, "").toLowerCase());
        const eq = part.match(/^(\w+)\.eq\.(.*)$/);
        if (eq) return String(row[eq[1]] || "") === eq[2];
        return true;
      };
      // Split on commas that are not inside a nested group.
      const split = (text) => {
        const out = []; let depth = 0, current = "";
        for (const ch of text) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) { out.push(current); current = ""; continue; }
          current += ch;
        }
        if (current) out.push(current);
        return out;
      };
      const alternatives = split(decodeURIComponent(or));
      rows = rows.filter((r) => alternatives.some((alt) => alt.startsWith("and(")
        ? split(alt.slice(4, -1)).every((part) => predicate(r, part))
        : predicate(r, alt)));
    }
    // PostgREST honours the order it was given; without this the feed's
    // grouping was being tested against whatever order the fixture was in.
    if (/order=created_at\.desc/.test(url.search)) {
      rows = rows.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    }
    return [200, rows];
  }
  if (url.pathname === "/rest/v1/collector_profiles") {
    if (req.method === "GET") {
      if (url.search.includes("is_public=eq.true")) {
        backend.collectorQueries.push(url.search);
        // In the real database this is enforced by the policy, not the query.
        // Honouring it here means a client that stopped asking would be caught.
        let rows = url.search.includes("is_listed=eq.true")
          ? backend.publicProfiles.filter((p) => p.is_listed !== false)
          : backend.publicProfiles;
        const or = (url.search.match(/or=\(([^)]*)\)/) || [])[1] || "";
        if (or) {
          const term = decodeURIComponent((or.match(/handle\.ilike\.([^,]*)/) || [])[1] || "")
            .replace(/\*/g, "").toLowerCase();
          rows = rows.filter((p) => (p.handle + " " + (p.display_name || "")).toLowerCase().includes(term));
        }
        return [200, rows];
      }
      // The feed resolves followed ids to handles, and the follow button
      // resolves a handle back to an id. Both read public profiles only.
      const inList = (url.search.match(/user_id=in\.\(([^)]*)\)/) || [])[1];
      if (inList) {
        const wanted = decodeURIComponent(inList).replace(/"/g, "").split(",");
        return [200, backend.publicProfiles.filter((p) => wanted.includes(p.user_id))];
      }
      const byHandle = decodeURIComponent((url.search.match(/handle=eq\.([^&]+)/) || [])[1] || "");
      if (byHandle) return [200, backend.publicProfiles.filter((p) => p.handle === byHandle)];
      const id = decodeURIComponent((url.search.match(/user_id=eq\.([^&]+)/) || [])[1] || "");
      return [200, backend.profiles.filter((p) => p.user_id === id)];
    }
    if (req.method === "POST") {
      const row = JSON.parse(body);
      if (backend.takenHandles.includes(row.handle)) {
        return [409, { message: 'duplicate key value violates unique constraint "collector_profiles_handle_key"' }];
      }
      backend.profiles = backend.profiles.filter((p) => p.user_id !== row.user_id).concat(row);
      return [201, [row]];
    }
  }
  if (url.pathname === "/rest/v1/cards") {
    if (req.method === "PATCH") {
      const patch = JSON.parse(body);
      backend.cards = backend.cards.map((c) => ({ ...c, ...patch }));
      backend.patches.push(patch);
      return [204, null];
    }
    if (req.method === "GET") {
      backend.cardQueries.push(url.search);
      // PostgREST applies the filters it is given, so this mock does too. A
      // client that stops asking for its own rows gets everybody's, which is
      // exactly the failure this reproduces.
      const owner = decodeURIComponent((url.search.match(/user_id=eq\.([^&]+)/) || [])[1] || "");
      return [200, owner ? backend.cards.filter((c) => c.user_id === owner) : backend.cards];
    }
    if (req.method === "POST") {
      backend.writeAttempts++;
      if (backend.failWrites) return [500, { message: "backend unavailable" }];
      const row = JSON.parse(body);
      backend.cards = backend.cards.filter((c) => c.id !== row.id).concat(row);
      return [201, null];
    }
    if (req.method === "DELETE") {
      backend.writeAttempts++;
      if (backend.failWrites) return [500, { message: "backend unavailable" }];
      const id = decodeURIComponent((url.search.match(/id=eq\.([^&]+)/) || [])[1] || "");
      backend.cards = backend.cards.filter((c) => c.id !== id);
      return [204, null];
    }
  }
  return null;
}

// Some environments ship a Chromium that predates the installed Playwright.
// Prefer whatever is already on disk over failing or downloading another copy.
function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) return undefined;
  const exe = join(root, dir, "chrome-linux", "chrome");
  return existsSync(exe) ? exe : undefined;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let body = "";
  for await (const chunk of req) body += chunk;

  if (url.pathname === "/__test/fail") {
    backend.failWrites = url.searchParams.get("on") === "1";
    res.writeHead(200).end("ok");
    return;
  }
  const mocked = await supabase(req, url, body);
  if (mocked) {
    const [status, payload] = mocked;
    res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(payload === null ? "" : JSON.stringify(payload));
    return;
  }
  // The port matters: the worker builds redirect targets from request.url, so
  // dropping it sent /scan and /pricing to port 80 instead of back here.
  const response = await worker.fetch(new Request("http://" + (req.headers.host || "127.0.0.1") + req.url), env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
env.SUPABASE_URL = origin;

let failed = false;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

const browser = await chromium.launch({ executablePath: preinstalledChromium() });

// A fresh context per scenario, so localStorage never leaks between them.
async function open(route) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  // The browser asks for /favicon.ico unprompted and the worker has no icon
  // route; that 404 is noise, not an application error.
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon/i.test(m.text()) || /Failed to load resource/.test(m.text())) return;
    errors.push(m.text());
  });
  await page.goto(origin + route);
  await page.waitForTimeout(500);
  return { context, page, errors };
}

// Every route must load clean.
for (const route of ["/", "/collection", "/account", "/reset-password"]) {
  const { context, page, errors } = await open(route);
  check(`${route} loads without errors`, errors, []);
  await context.close();
}

// The full add-a-card path, signed out: save, render, price, and re-add.
{
  const { context, page, errors } = await open("/collection");

  await page.click("#addCard");
  await page.fill('[name="player"]', "Chris Sale");
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps Chrome");
  await page.fill('[name="parallel"]', "Refractor");
  await page.fill('[name="price"]', "42.50");
  await page.click(".submit-card");
  await page.waitForTimeout(400);

  check("card was saved and rendered", await page.locator(".catalog-card").count(), 1);
  check("initials derive from the player name",
    (await page.locator(".initials").first().textContent()).trim(), "CS");
  // Price now lives on the card record rather than a parallel map.
  check("price shows on the card",
    (await page.locator(".price-tag strong").first().textContent()).trim(), "$42.50");
  check("card persisted to storage", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards") || "[]").length), 1);
  check("price persisted on the card itself", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards") || "[]")[0].currentValue), 42.5);
  check("the retired price map is not recreated", await page.evaluate(() =>
    localStorage.getItem("the-database-prices")), null);
  check("new ids are uuids", await page.evaluate(() =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.parse(localStorage.getItem("the-database-cards"))[0].id)), true);

  // Adding the same card again must warn rather than silently duplicate.
  await page.click("#addCard");
  await page.fill('[name="player"]', "Chris Sale");
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps Chrome");
  await page.fill('[name="parallel"]', "Refractor");
  await page.click(".submit-card");
  await page.waitForTimeout(300);
  check("duplicate is challenged", await page.locator("#duplicateWarning.show").count(), 1);
  check("nothing saved while the warning stands", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards")).length), 1);

  // Confirming goes through.
  await page.click(".submit-card");
  await page.waitForTimeout(400);
  check("confirmed duplicate is saved", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards")).length), 2);

  check("no uncaught errors during the whole flow", errors, []);
  await context.close();
}

// Pricing now happens inline on the collection grid.
{
  const { context, page, errors } = await open("/collection");
  await page.evaluate(() => {
    localStorage.setItem("the-database-cards", JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111", player: "Aaron Judge", year: "2024",
      sport: "Baseball", set: "Topps", number: "#1", parallel: "Base", grade: "Raw",
      team: "NYY", quantity: 1, currentValue: 10, initials: "AJ", color: "blue",
    }]));
  });
  await page.reload();
  await page.waitForTimeout(400);

  check("prices are not editable until asked for",
    await page.locator("[data-price-id]").count(), 0);
  await page.click("#priceMode");
  await page.waitForTimeout(250);
  check("existing price loads into the inline input",
    await page.locator("[data-price-id]").first().inputValue(), "10");

  await page.fill("[data-price-id]", "25");
  await page.locator("[data-price-id]").blur();
  await page.waitForTimeout(300);
  check("edited price is written to the card", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards"))[0].currentValue), 25);
  // Typing in the price box must not open the card detail modal.
  check("the card modal did not open", await page.locator("#backdrop.open").count(), 0);
  // Totals should follow without the grid re-rendering underneath the input.
  check("the collection total follows the edit",
    (await page.locator("#portfolio").textContent()).trim(), "$25.00");

  await page.click("#priceMode");
  await page.waitForTimeout(250);
  check("leaving price mode restores the display",
    (await page.locator(".price-tag strong").first().textContent()).trim(), "$25.00");
  check("no errors on the pricing path", errors, []);
  await context.close();
}

// A collection saved under the old scheme must carry its prices forward.
{
  const { context, page, errors } = await open("/collection");
  await page.evaluate(() => {
    localStorage.setItem("the-database-cards", JSON.stringify([
      { id: "aaaaaaaa-1111-4111-8111-111111111111", player: "Legacy One", year: "2023",
        sport: "Baseball", set: "Topps", number: "#9", parallel: "Base", grade: "Raw",
        team: "NYY", quantity: 1, initials: "LO", color: "blue" },
    ]));
    localStorage.setItem("the-database-prices",
      JSON.stringify({ "aaaaaaaa-1111-4111-8111-111111111111": 77.25 }));
  });
  await page.reload();
  await page.waitForTimeout(400);
  check("legacy price folded onto the card", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards"))[0].currentValue), 77.25);
  check("legacy price map removed", await page.evaluate(() =>
    localStorage.getItem("the-database-prices")), null);
  check("migrated price is displayed",
    (await page.locator(".price-tag strong").first().textContent()).trim(), "$77.25");
  check("no errors during the upgrade", errors, []);
  await context.close();
}

// --- The outbox: signed in, with a backend that can be made to fail ---------
async function signedIn(route) {
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(origin + route);
  await page.waitForTimeout(600);
  return { context, page, errors };
}

const addCard = async (page, player, sport) => {
  await page.click("#addCard");
  await page.fill('[name="player"]', player);
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps Chrome");
  if (sport) await page.selectOption('[name="sport"]', sport);
  await page.click(".submit-card");
  await page.waitForTimeout(500);
};
// Account settings live in collapsed sections now, so a test has to open one
// the way a person would. Idempotent: opening an already-open section is a
// no-op rather than a toggle that closes it.
const openSection = (page, name) => page.evaluate((wanted) => {
  const summary = [...document.querySelectorAll(".account-section > summary")]
    .find((s) => s.textContent.toLowerCase().includes(wanted.toLowerCase()));
  if (summary && !summary.parentElement.open) summary.click();
}, name);

const queued = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem("the-database-outbox") || "[]").length);

// A save reaches the backend and leaves the queue empty.
{
  backend.cards = []; backend.failWrites = false;
  const { context, page, errors } = await signedIn("/collection");
  await addCard(page, "Aaron Judge");
  check("card reached the backend", backend.cards.length, 1);
  check("queue drains after a successful save", await queued(page), 0);
  check("no errors on the happy path", errors, []);
  await context.close();
}

// A failing backend must not lose the card.
{
  backend.cards = []; backend.failWrites = true;
  const { context, page } = await signedIn("/collection");
  await addCard(page, "Chris Sale");

  check("nothing reached the backend", backend.cards.length, 0);
  check("the save is held in the queue", await queued(page), 1);
  check("the card is still visible to the user", await page.locator(".catalog-card").count(), 1);
  check("the indicator reports unsent work",
    (await page.locator("#syncStatus").textContent()).includes("unsaved"), true);

  // The queue must survive a reload — this is the whole point of it.
  await page.reload();
  await page.waitForTimeout(600);
  check("queue survives a reload", await queued(page), 1);

  // Recover the backend; the pending save should go through by itself.
  backend.failWrites = false;
  await page.evaluate(() => fetch("/__test/fail?on=0"));
  await page.reload();
  await page.waitForTimeout(1200);
  check("recovered backend receives the held save", backend.cards.length, 1);
  check("queue empties once it lands", await queued(page), 0);
  await context.close();
}

// Repeated edits to one card collapse instead of piling up.
{
  backend.cards = []; backend.failWrites = true;
  const { context, page } = await signedIn("/collection");
  await addCard(page, "Juan Soto");
  for (const price of ["10", "20", "30"]) {
    await page.click(".catalog-card");
    await page.waitForTimeout(200);
    await page.click(".edit-card");
    await page.fill('[name="price"]', price);
    await page.click(".submit-card");
    await page.waitForTimeout(300);
  }
  check("one entry per card, not one per edit", await queued(page), 1);
  check("the queued entry holds the latest value", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-outbox"))[0].card.currentValue), 30);
  await context.close();
}

// Deleting a card that never synced cancels its pending save.
{
  backend.cards = []; backend.failWrites = true;
  const { context, page } = await signedIn("/collection");
  await addCard(page, "Gerrit Cole");
  check("save is pending", await queued(page), 1);
  await page.click(".catalog-card");
  await page.waitForTimeout(200);
  await page.click(".remove-card");
  await page.click(".confirm-remove");
  await page.waitForTimeout(400);
  check("delete replaces the pending save", await queued(page), 1);
  check("the queued entry is the delete", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-outbox"))[0].kind), "delete");
  await context.close();
}

// --- Value history follows the collector between devices --------------------

// A device with existing local history carries it up on first sign-in.
{
  backend.cards = []; backend.snapshots = []; backend.failWrites = false;
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
    localStorage.setItem("the-database-history", JSON.stringify([
      { time: Date.parse("2026-07-01T00:00:00Z"), total: 100 },
      { time: Date.parse("2026-07-15T00:00:00Z"), total: 250 },
    ]));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(origin + "/");
  await page.waitForTimeout(800);

  check("existing local history is uploaded", backend.snapshots.length, 2);
  check("uploaded history keeps its values",
    backend.snapshots.map((s) => Number(s.total)), [100, 250]);
  check("uploaded history keeps its timestamps",
    backend.snapshots.map((s) => s.created_at.slice(0, 10)), ["2026-07-01", "2026-07-15"]);
  check("no errors carrying history up", errors, []);
  await context.close();
}

// A fresh device adopts the history already on the server.
{
  backend.cards = [];
  backend.snapshots = [
    { total: 500, created_at: "2026-07-02T00:00:00Z" },
    { total: 900, created_at: "2026-07-20T00:00:00Z" },
  ];
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(origin + "/");
  await page.waitForTimeout(800);

  check("server history is adopted locally", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-history")).map((h) => h.total)), [500, 900]);
  check("nothing is re-uploaded when the server already has history",
    backend.snapshots.length, 2);
  // Growth is measured against the earliest point, so it reflects the whole
  // tracked period rather than restarting on this device. With no cards loaded
  // the collection is worth nothing, so it reads as a fall from that baseline.
  check("growth is measured from the earliest server point",
    (await page.locator("#growthValue").textContent()).trim(), "-$500.00");
  check("the chart is drawn from the server history", await page.evaluate(() =>
    document.getElementById("growthLine").getAttribute("d").split("L").length), 2);
  check("no errors adopting history", errors, []);
  await context.close();
}

// --- Structured storage locations -------------------------------------------
{
  const { context, page, errors } = await open("/collection");

  const add = async (player, container, section, slot) => {
    await page.click("#addCard");
    await page.fill('[name="player"]', player);
    await page.fill('[name="year"]', "2024");
    await page.fill('[name="set"]', "Topps");
    await page.fill('[name="container"]', container);
    await page.fill('[name="section"]', section);
    await page.fill('[name="slot"]', slot);
    await page.click(".submit-card");
    await page.waitForTimeout(350);
  };
  await add("Aaron Judge", "Binder 2", "Page 4", "Slot 3");
  await add("Juan Soto", "Binder 2", "Page 9", "Slot 1");
  await add("Shohei Ohtani", "Monster Box A", "Row 3", "");

  check("all three cards saved", await page.locator(".catalog-card").count(), 3);
  check("location parts are stored separately", await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("the-database-cards")).find((x) => x.player === "Aaron Judge");
    return [c.container, c.section, c.slot];
  }), ["Binder 2", "Page 4", "Slot 3"]);

  // Filtering by container is the point of the exercise.
  const options = await page.locator("#containerFilter option").allTextContents();
  check("containers are listed with counts", options,
    ["All locations", "Binder 2 (2)", "Monster Box A (1)"]);

  await page.selectOption("#containerFilter", "Binder 2");
  await page.waitForTimeout(250);
  check("filtering by container narrows the grid", await page.locator(".catalog-card").count(), 2);
  await page.selectOption("#containerFilter", "Monster Box A");
  await page.waitForTimeout(250);
  check("a second container filters independently", await page.locator(".catalog-card").count(), 1);

  // Narrow to nothing so the empty state, and its clear button, appear.
  await page.fill("#search", "nothing matches this");
  await page.waitForTimeout(250);
  check("over-filtering shows the empty state", await page.locator("#empty:not(.hidden)").count(), 1);
  await page.click("#clear");
  await page.waitForTimeout(250);
  check("clearing filters restores everything", await page.locator(".catalog-card").count(), 3);
  check("clearing resets the container filter",
    await page.locator("#containerFilter").inputValue(), "All locations");

  // Searching should find a card by where it lives.
  await page.fill("#search", "page 9");
  await page.waitForTimeout(250);
  check("search finds a card by its section", await page.locator(".catalog-card").count(), 1);
  await page.fill("#search", "monster box");
  await page.waitForTimeout(250);
  check("search finds a card by its container", await page.locator(".catalog-card").count(), 1);
  await page.fill("#search", "");
  await page.waitForTimeout(250);

  // Previously used values are offered so entries stay consistent.
  await page.click("#addCard");
  check("containers are suggested", await page.locator("#containerOptions option").count(), 2);
  check("sections are suggested", await page.locator("#sectionOptions option").count(), 3);
  await page.click(".close");

  check("no errors across the location flow", errors, []);
  await context.close();
}

// Locations typed before the fields were split must carry over.
{
  const { context, page, errors } = await open("/collection");
  await page.evaluate(() => {
    localStorage.setItem("the-database-cards", JSON.stringify([
      { id: "aaaaaaaa-2222-4222-8222-222222222222", player: "Legacy Comma", year: "2023",
        sport: "Baseball", set: "Topps", number: "#1", parallel: "Base", grade: "Raw",
        team: "NYY", quantity: 1, location: "Binder 7, Page 2", initials: "LC", color: "blue" },
      { id: "bbbbbbbb-2222-4222-8222-222222222222", player: "Legacy Slash", year: "2023",
        sport: "Baseball", set: "Topps", number: "#2", parallel: "Base", grade: "Raw",
        team: "NYY", quantity: 1, location: "Box A / Row 3 / Slot 9", initials: "LS", color: "red" },
      { id: "cccccccc-2222-4222-8222-222222222222", player: "Legacy Plain", year: "2023",
        sport: "Baseball", set: "Topps", number: "#3", parallel: "Base", grade: "Raw",
        team: "NYY", quantity: 1, location: "Shoebox", initials: "LP", color: "gold" },
    ]));
  });
  await page.reload();
  await page.waitForTimeout(500);

  const split = await page.evaluate(() => JSON.parse(localStorage.getItem("the-database-cards"))
    .map((c) => [c.container, c.section, c.slot]));
  check("comma-separated text is split", split[0], ["Binder 7", "Page 2", ""]);
  check("slash-separated text is split", split[1], ["Box A", "Row 3", "Slot 9"]);
  check("a bare container is left as one", split[2], ["Shoebox", "", ""]);
  check("the original text is preserved", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards"))[0].location), "Binder 7, Page 2");
  check("migrated containers populate the filter",
    await page.locator("#containerFilter option").allTextContents(),
    ["All locations", "Binder 7 (1)", "Box A (1)", "Shoebox (1)"]);
  check("no errors during the location upgrade", errors, []);
  await context.close();
}

// Deploying without re-running setup.sql must not look like a data problem.
{
  backend.cards = [{ id: "dddddddd-3333-4333-8333-333333333333", user_id: USER.id,
    player: "Aaron Judge",
    year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1 }];
  backend.snapshots = []; backend.failWrites = false; backend.noSnapshotTable = true;

  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  await page.goto(origin + "/collection");
  await page.waitForTimeout(800);

  check("cards still load without the snapshots table",
    await page.locator(".catalog-card").count(), 1);
  await page.goto(origin + "/account");
  await page.waitForTimeout(800);
  check("no alarming sync message about the collection",
    (await page.locator("#syncMessage").textContent()).trim(), "");
  backend.noSnapshotTable = false;
  await context.close();
}

// --- Photo loading must not gate the collection ------------------------------
// Signing used to run one request per photo, in sequence, before anything
// rendered: a 100-card collection took ten seconds to show a single card.
{
  backend.snapshots = []; backend.failWrites = false; backend.noSnapshotTable = false;
  backend.signCalls = 0;
  backend.cards = Array.from({ length: 30 }, (_, i) => ({
    id: `${String(i).padStart(8, "0")}-4444-4444-8444-444444444444`,
    user_id: USER.id, player: `Player ${i}`, year: 2024, sport: "Baseball",
    card_set: "Topps", card_number: `#${i}`, parallel: "Base", grade: "Raw", quantity: 1,
    front_image_path: `${USER.id}/${i}-front.jpg`, back_image_path: `${USER.id}/${i}-back.jpg`,
  }));

  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  await page.goto(origin + "/collection");
  await page.waitForTimeout(900);

  check("all cards render", await page.locator(".catalog-card").count(), 30);
  // 60 photos across 30 cards must not mean 60 requests.
  check("photos are signed in bulk, not one at a time", backend.signCalls <= 2, true);
  check("photos are attached", await page.locator(".card-art.has-photo").count() > 0, true);
  check("signed urls are cached for reuse", await page.evaluate(() =>
    Object.keys(JSON.parse(localStorage.getItem("the-database-signed") || "{}")).length), 60);
  // Off-screen images should not be fetched until scrolled to.
  check("images are lazily loaded", await page.evaluate(() =>
    [...document.querySelectorAll(".card-photo")].every((i) => i.loading === "lazy")), true);

  // Revisiting must reuse the cache rather than re-signing everything.
  const before = backend.signCalls;
  await page.goto(origin + "/account");
  await page.waitForTimeout(900);
  check("navigating does not re-sign photos", backend.signCalls - before, 0);
  await context.close();
}

// --- Sorting by value from the dropdown --------------------------------------
{
  const { context, page, errors } = await open("/collection");
  const add = async (player, price) => {
    await page.click("#addCard");
    await page.fill('[name="player"]', player);
    await page.fill('[name="year"]', "2024");
    await page.fill('[name="set"]', "Topps");
    if (price) await page.fill('[name="price"]', price);
    await page.click(".submit-card");
    await page.waitForTimeout(300);
  };
  await add("Cheap One", "5");
  await add("Dear One", "500");
  await add("Middling One", "50");
  await add("Unpriced One", "");

  const order = async () => (await page.locator(".card-info h3").allTextContents()).map((t) => t.trim());

  check("the dropdown offers both families of value sort",
    await page.locator("#sort option").allTextContents(),
    ["Recently added", "Player A–Z", "Card value, high to low", "Card value, low to high",
     "Total value, high to low", "Total value, low to high"]);

  await page.selectOption("#sort", "Card value, high to low");
  await page.waitForTimeout(250);
  check("card value high to low", await order(),
    ["Dear One", "Middling One", "Cheap One", "Unpriced One"]);

  await page.selectOption("#sort", "Card value, low to high");
  await page.waitForTimeout(250);
  check("card value low to high", await order(),
    ["Cheap One", "Middling One", "Dear One", "Unpriced One"]);

  // A stack of cheap cards should outrank a single dear one only by total.
  await page.click("#addCard");
  await page.fill('[name="player"]', "Stacked One");
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps");
  await page.fill('[name="quantity"]', "20");
  await page.fill('[name="price"]', "100");
  await page.click(".submit-card");
  await page.waitForTimeout(350);

  await page.selectOption("#sort", "Card value, high to low");
  await page.waitForTimeout(250);
  check("by card value the stack sits below the dearest single card",
    (await order()).slice(0, 2), ["Dear One", "Stacked One"]);

  await page.selectOption("#sort", "Total value, high to low");
  await page.waitForTimeout(250);
  check("by total value the stack comes first", (await order())[0], "Stacked One");

  await page.selectOption("#sort", "Player A–Z");
  await page.waitForTimeout(250);
  check("the existing sorts still work", await order(),
    ["Cheap One", "Dear One", "Middling One", "Stacked One", "Unpriced One"]);

  check("no errors while sorting", errors, []);
  await context.close();
}

// --- Opting in to a public showcase -----------------------------------------
{
  backend.cards = [
    { id: "cccccccc-5555-4555-8555-555555555551", user_id: USER.id, player: "Aaron Judge",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1, visibility: "private" },
    { id: "cccccccc-5555-4555-8555-555555555552", user_id: USER.id, player: "Juan Soto",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1, visibility: "public" },
  ];
  backend.profiles = []; backend.takenHandles = ["taken"]; backend.patches = [];
  backend.snapshots = []; backend.noSnapshotTable = false;

  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(origin + "/account");
  await page.waitForTimeout(800);

  // Nothing is shared until it is asked for.
  // The account page is five collapsed sections rather than seven screens of
  // scrolling, so settings have to be opened before they can be reached.
  check("settings start collapsed", await page.locator("#sharePublic").isVisible(), false);
  check("and the page fits in a couple of screens",
    await page.evaluate(() => document.querySelector("#signedIn").scrollHeight) < 1400, true);
  await openSection(page, "Public showcase");
  check("opening a section reveals it", await page.locator("#sharePublic").isVisible(), true);
  check("sharing starts off", await page.locator("#sharePublic").isChecked(), false);
  check("values start hidden", await page.locator("#shareValues").isChecked(), false);
  check("no public link before opting in",
    (await page.locator("#shareUrl").textContent()).trim(), "");

  // A public collection needs a handle worth putting in a URL.
  await page.check("#sharePublic");
  await page.fill("#shareHandle", "no");
  await page.click("#saveShare");
  await page.waitForTimeout(300);
  check("a too-short handle is refused",
    (await page.locator("#shareMessage").textContent()).includes("3 to 30"), true);
  check("nothing was saved", backend.profiles.length, 0);

  await page.fill("#shareHandle", "has spaces");
  await page.click("#saveShare");
  await page.waitForTimeout(300);
  check("a handle with spaces is refused", backend.profiles.length, 0);

  // A handle someone else already holds must fail cleanly, not silently.
  await page.fill("#shareHandle", "taken");
  await page.click("#saveShare");
  await page.waitForTimeout(400);
  check("a taken handle is reported plainly",
    (await page.locator("#shareMessage").textContent()).includes("already taken"), true);

  await page.fill("#shareHandle", "kadin");
  await page.fill("#shareName", "Kadin R");
  await page.click("#saveShare");
  await page.waitForTimeout(500);
  check("the profile is saved", backend.profiles.length, 1);
  check("it is marked public", backend.profiles[0].is_public, true);
  check("values stay opted out", backend.profiles[0].show_values, false);
  check("the public link is shown",
    (await page.locator("#shareUrl").textContent()).includes("/c/kadin"), true);

  // Sharing and being listed are separate decisions. Sharing on its own gives
  // a link; it must not put somebody on a public page beside their own
  // collection's value without them saying so.
  check("listing starts off", await page.locator("#shareListed").isChecked(), false);
  check("sharing alone does not list", backend.profiles[0].is_listed, false);
  check("and the app says the link is the only way in",
    (await page.locator("#shareMessage").textContent()).includes("link"), true);

  await page.check("#shareListed");
  await page.click("#saveShare");
  await page.waitForTimeout(500);
  check("ticking it lists them", backend.profiles[0].is_listed, true);
  check("and it stays shared", backend.profiles[0].is_public, true);

  // Listing an unshared collection would put an empty page in the directory.
  await page.uncheck("#sharePublic");
  await page.click("#saveShare");
  await page.waitForTimeout(500);
  check("unsharing also unlists", backend.profiles[0].is_listed, false);

  await page.check("#sharePublic");
  await page.click("#saveShare");
  await page.waitForTimeout(500);

  // Bulk sharing goes out as one request, not one per card.
  await page.click("#shareAll");
  await page.waitForTimeout(400);
  check("sharing every card is a single request", backend.patches.length, 1);
  check("it marks them public", backend.patches[0].visibility, "public");

  await page.click("#shareNone");
  await page.waitForTimeout(400);
  check("unsharing is also one request", backend.patches.length, 2);
  check("it marks them private", backend.patches[1].visibility, "private");

  check("no errors across the sharing flow", errors, []);
  await context.close();
}

// A card's own shared flag round-trips through the form.
{
  backend.cards = []; backend.profiles = []; backend.patches = [];
  const { context, page, errors } = await open("/collection");
  await page.click("#addCard");
  check("cards are not shared by default",
    await page.locator('[name="shared"]').isChecked(), false);
  await page.fill('[name="player"]', "Shared Card");
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps");
  await page.check('[name="shared"]');
  await page.click(".submit-card");
  await page.waitForTimeout(400);
  check("the shared flag is stored on the card", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards"))[0].shared), true);

  await page.click(".catalog-card");
  await page.waitForTimeout(250);
  await page.click(".edit-card");
  await page.waitForTimeout(250);
  check("editing shows the card as shared",
    await page.locator('[name="shared"]').isChecked(), true);
  check("no errors on the card sharing path", errors, []);
  await context.close();
}

// --- Browsing other collectors' shared cards --------------------------------
const PUBLIC_ROWS = [
  { id: "dddddddd-6666-4666-8666-666666666661", handle: "kadin", display_name: "Kadin R",
    player: "Aaron Judge", year: 2024, sport: "Baseball", card_set: "Topps Chrome",
    card_number: "#1", team: "Yankees", parallel: "Refractor", grade: "PSA 9", quantity: 1,
    current_value: 450, front_image_path: "u/1-front.jpg", created_at: "2026-07-01T00:00:00Z",
    storage_container: "SECRETBINDER", storage_slot: "SECRETSLOT",
    purchase_price: 99999, notes: "SECRETNOTE", user_id: "SECRETOWNER" },
  { id: "dddddddd-6666-4666-8666-666666666662", handle: "kadin", display_name: "Kadin R",
    player: "Juan Soto", year: 2024, sport: "Baseball", card_set: "Topps", card_number: "#2",
    team: "Yankees", parallel: "Base", grade: "Raw", quantity: 1,
    current_value: null, front_image_path: "u/2-front.jpg", created_at: "2026-07-02T00:00:00Z" },
  { id: "dddddddd-6666-4666-8666-666666666663", handle: "someone", display_name: "Someone Else",
    player: "Shohei Ohtani", year: 2024, sport: "Baseball", card_set: "Bowman", card_number: "#3",
    team: "Dodgers", parallel: "Base", grade: "Raw", quantity: 1,
    current_value: null, front_image_path: "u/3-front.jpg", created_at: "2026-07-03T00:00:00Z" },
];

// The search page, signed out, which is how most visitors will arrive.
{
  backend.publicCards = PUBLIC_ROWS; backend.publicQueries = []; backend.signCalls = 0;
  backend.collectorQueries = [];
  backend.publicProfiles = [
    { handle: "kadin", display_name: "Kadin R", is_listed: true },
    { handle: "someone", display_name: "Someone Else", is_listed: true },
    // Shared by link, but not listed. The directory must not show them.
    { handle: "bylink", display_name: "Link Only", is_listed: false },
  ];
  const { context, page, errors } = await open("/search");

  // The page is a directory before it is a search box: an empty discovery page
  // tells a visitor there is nothing here.
  check("collectors are listed before anything is typed",
    await page.locator(".collector-card").count(), 2);
  check("the heading says so",
    (await page.locator("#collectorHeading").textContent()).includes("sharing right now"), true);
  check("card results are not shown without a term",
    await page.locator("#cardHeading.hidden").count(), 1);
  // Located by handle, not by position: the directory orders by activity, so
  // asserting on .first() would be testing the fixture's dates.
  check("a collector shows their shared card count",
    (await page.locator(".collector-card", { hasText: "@kadin" }).locator("small").textContent())
      .includes("2 shared cards"), true);

  // Searching by collector name is the point of the page.
  await page.fill("#publicSearch", "kadin");
  await page.waitForTimeout(600);
  check("searching finds the collector", await page.locator(".collector-card").count(), 1);
  check("it is the right one",
    (await page.locator(".collector-card b").first().textContent()).trim(), "Kadin R");

  await page.fill("#publicSearch", "someone");
  await page.waitForTimeout(600);
  check("searching by handle works too",
    (await page.locator(".collector-card b").first().textContent()).trim(), "Someone Else");

  // Clicking a collector opens their showcase.
  await page.locator(".collector-card").first().click();
  await page.waitForTimeout(700);
  check("a collector opens their page", page.url().endsWith("/c/someone"), true);
  await page.goBack();
  await page.waitForTimeout(600);

  await page.fill("#publicSearch", "judge");
  await page.waitForTimeout(600);
  check("cards still match underneath", await page.locator("#publicGrid .catalog-card").count(), 1);
  check("the card heading appears with a term",
    await page.locator("#cardHeading.hidden").count(), 0);
  check("the owner's handle is shown",
    (await page.locator("#publicGrid .meta span").first().textContent()).trim(), "@kadin");
  check("a shared value is displayed",
    (await page.locator("#publicGrid .price-tag strong").first().textContent()).trim(), "$450.00");

  // Searching reads the public view and nothing else.
  check("the directory asks for listed profiles, not merely shared",
    backend.collectorQueries.every((q) => q.includes("is_listed=eq.true")), true);
  check("collector search only ever asks for shared profiles",
    backend.collectorQueries.every((q) => q.includes("is_public=eq.true")), true);

  await page.fill("#publicSearch", "yankees");
  await page.waitForTimeout(600);
  check("searching by team works", await page.locator("#publicGrid .catalog-card").count(), 2);

  await page.fill("#publicSearch", "nobody at all");
  await page.waitForTimeout(600);
  check("no matches shows the empty state", await page.locator("#publicEmpty:not(.hidden)").count(), 1);

  check("no errors while searching", errors, []);
  await context.close();
}

// A collector's showcase page.
{
  backend.publicCards = PUBLIC_ROWS; backend.publicQueries = [];
  const { context, page, errors } = await open("/c/kadin");

  check("only that collector's cards are shown",
    await page.locator("#showcaseGrid .catalog-card").count(), 2);
  check("the query is scoped to the handle",
    backend.publicQueries[0].includes("handle=eq.kadin"), true);
  check("the collector is named",
    (await page.locator("#showcaseName").textContent()).trim(), "Kadin R");
  check("the count is shown",
    (await page.locator("#showcaseMeta").textContent()).includes("2 shared cards"), true);

  // Defence in depth: even when the backend hands over fields the real view
  // would never return, the client must not render them. Checking the whole
  // document would be meaningless — it ships the private collection form too,
  // whose placeholder text mentions binders — so this checks what was drawn.
  const drawn = await page.locator("#showcaseGrid").innerHTML();
  for (const secret of ["SECRETBINDER", "SECRETSLOT", "99999", "SECRETNOTE", "SECRETOWNER"]) {
    check(`${secret} is not rendered on a public page`, drawn.includes(secret), false);
  }
  // And the private cards table is never touched from a public page.
  check("a public page never reads the cards table",
    backend.publicQueries.length > 0 && backend.patches.length === 0, true);
  check("no errors on the showcase", errors, []);
  await context.close();
}

// --- Reporting a collection ---------------------------------------------------
// The directory lists every collector who opts in, and handles are checked for
// shape but not for meaning. Somebody has to be able to say so, and the person
// who notices first is usually not signed in.
{
  backend.publicCards = PUBLIC_ROWS; backend.reports = []; backend.failReport = false;
  const { context, page, errors } = await open("/c/kadin");
  await page.waitForFunction(() => document.querySelectorAll("#showcaseGrid .catalog-card").length > 0);

  check("the form is not in the way until asked",
    await page.locator("#reportBox").isVisible(), false);
  await page.click("#reportCollection");
  check("asking opens it", await page.locator("#reportBox").isVisible(), true);

  await page.selectOption("#reportReason", "offensive");
  await page.fill("#reportDetail", "the handle is a slur");
  await page.click("#sendReport");
  await page.waitForFunction(() => document.querySelector("#reportBox").classList.contains("hidden"));

  check("one report is filed", backend.reports.length, 1);
  check("it names the collection reported", backend.reports[0].reported_handle, "kadin");
  check("it carries the reason", backend.reports[0].reason, "offensive");
  check("and what was written", backend.reports[0].detail, "the handle is a slur");
  // Signed out, so there is nobody to attribute it to. Putting a user id here
  // would be the only way a report could be filed in somebody else's name.
  check("a signed-out report names no reporter", backend.reports[0].reporter_user_id, null);
  check("the visitor is thanked rather than promised an outcome",
    (await page.locator("#reportCollection").textContent()).includes("Thank you"), true);
  check("and cannot file the same one twice",
    await page.locator("#reportCollection").isDisabled(), true);
  check("no errors while reporting", errors, []);
  await context.close();
}

// A report that does not send must say so, not swallow it.
{
  backend.publicCards = PUBLIC_ROWS; backend.reports = []; backend.failReport = true;
  const { context, page, errors } = await open("/c/kadin");
  await page.waitForSelector("#reportCollection");
  await page.click("#reportCollection");
  await page.click("#sendReport");
  await page.waitForFunction(() => document.querySelector("#reportMessage").textContent.length > 0);
  check("a failed report says so",
    (await page.locator("#reportMessage").textContent()).includes("could not be sent"), true);
  check("the form stays open to retry", await page.locator("#reportBox").isVisible(), true);
  check("and nothing was recorded as filed", backend.reports.length, 0);
  check("no errors on a failed report", errors, []);
  await context.close();
  backend.failReport = false;
}

// An unknown or unshared handle must not confirm whether the collector exists.
{
  backend.publicCards = PUBLIC_ROWS;
  const { context, page, errors } = await open("/c/nobodyhere");
  check("an unknown handle shows the empty state",
    await page.locator("#showcaseEmpty:not(.hidden)").count(), 1);
  check("it does not claim the collector is missing",
    (await page.locator("#showcaseEmptyText").textContent()).includes("not shared any cards"), true);
  check("no errors on an unknown handle", errors, []);
  await context.close();
}

// --- Recency ------------------------------------------------------------------
// A collection nobody has touched in a year and one added to yesterday looked
// identical, and only one of them is worth opening. Dates are relative to now,
// so these checks cannot rot into passing on a fixed calendar.
{
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  backend.publicCards = [
    { id: "ffffffff-7777-4777-8777-777777777771", handle: "stale", display_name: "Stale Steve",
      player: "Old Card", year: 2020, sport: "Baseball", card_set: "Topps", card_number: "#1",
      parallel: "Base", grade: "Raw", quantity: 1, created_at: daysAgo(400) },
    { id: "ffffffff-7777-4777-8777-777777777772", handle: "active", display_name: "Active Amy",
      player: "New Card", year: 2026, sport: "Baseball", card_set: "Topps", card_number: "#2",
      parallel: "Base", grade: "Raw", quantity: 1, created_at: daysAgo(1) },
    { id: "ffffffff-7777-4777-8777-777777777773", handle: "active", display_name: "Active Amy",
      player: "Older Card", year: 2024, sport: "Baseball", card_set: "Topps", card_number: "#3",
      parallel: "Base", grade: "Raw", quantity: 1, created_at: daysAgo(120) },
  ];
  // Deliberately listed stale-first, so ordering by activity has to be the
  // client's doing rather than an accident of the fixture.
  backend.publicProfiles = [
    { handle: "stale", display_name: "Stale Steve" },
    { handle: "active", display_name: "Active Amy" },
  ];
  backend.publicQueries = []; backend.collectorQueries = [];

  const { context, page, errors } = await open("/search");
  await page.waitForFunction(() => document.querySelectorAll(".collector-card").length === 2);

  const first = await page.locator(".collector-card").first().textContent();
  check("the collector who added something recently is listed first",
    first.includes("Active Amy"), true);
  check("their entry says when", first.includes("added yesterday"), true);
  check("they are flagged as recently active",
    await page.locator(".collector-card").first().locator(".fresh-dot").count(), 1);

  // Past a month it becomes a date rather than a count, which reads as
  // information instead of a verdict on how long someone has been away.
  const stale = await page.locator(".collector-card").last().textContent();
  const staleYear = String(new Date(Date.now() - 400 * 86400000).getFullYear());
  check("a dormant collection shows a date", stale.includes(staleYear), true);
  check("and does not count the months", /months? ago|year/.test(stale), false);
  check("and carries no recent flag",
    await page.locator(".collector-card").last().locator(".fresh-dot").count(), 0);
  check("recency costs no extra request", backend.publicQueries.length, 1);
  check("no errors on the directory", errors, []);
  await context.close();

  const showcase = await open("/c/active");
  await showcase.page.waitForFunction(
    () => document.querySelectorAll("#showcaseGrid .catalog-card").length === 2);
  const meta = await showcase.page.locator("#showcaseMeta").textContent();
  check("the showcase dates itself", meta.includes("last added yesterday"), true);
  check("and counts what is new", meta.includes("1 new"), true);
  check("only the recent card is badged",
    await showcase.page.locator("#showcaseGrid .fresh").count(), 1);
  check("no errors on the showcase", showcase.errors, []);
  await showcase.context.close();
}

// --- The wantlist -------------------------------------------------------------
// What somebody is hunting is more sensitive than what they own, so the list is
// never published. It is read by its owner and turned into an ordinary search
// here in the browser; nothing about it reaches the server except a query that
// looks like any other.
{
  backend.cards = []; backend.interests = []; backend.snapshots = [];
  backend.noSnapshotTable = false; backend.publicQueries = [];
  backend.publicCards = PUBLIC_ROWS;
  backend.publicProfiles = [{ handle: "kadin", display_name: "Kadin R", is_listed: true }];

  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/account`);
  await page.waitForFunction(() => !document.querySelector("#signedIn").classList.contains("hidden"));

  await openSection(page, "Wantlist");
  check("the wantlist starts empty",
    await page.locator("#wantEmpty:not(.hidden)").count(), 1);
  check("and says the list is never published",
    /never published/i.test(await page.locator("#wantForm").locator("xpath=..").textContent()), true);

  await page.fill("#wantPlayer", "Aaron Judge");
  await page.fill("#wantSet", "Topps Chrome");
  await page.click("#wantForm button");
  await page.waitForSelector(".want-row");
  check("an entry is saved", backend.interests.length, 1);
  check("under the right owner", backend.interests[0].user_id, USER.id);
  check("and shown back", await page.locator(".want-row").count(), 1);

  // Matching happens on the search page, against the public view only.
  backend.publicQueries = [];
  await page.goto(`${origin}/search`);
  await page.waitForSelector("#wantHeading:not(.hidden)");
  await page.waitForFunction(() => document.querySelectorAll("#wantGrid .catalog-card").length > 0);
  check("a matching shared card is found",
    await page.locator("#wantGrid .catalog-card").count(), 1);
  check("the match is the right card",
    (await page.locator("#wantGrid .catalog-card h3").textContent()).includes("Aaron Judge"), true);
  // The whole privacy claim rests on this: the wantlist becomes a search.
  check("matching reads the public view, never the cards table",
    backend.publicQueries.length > 0 && backend.patches.length === 0, true);
  check("and asks for it in one request, not one per entry",
    backend.publicQueries.filter((q) => q.includes("or=(and(")).length, 1);

  // Removing an entry has to remove its matches too.
  await page.goto(`${origin}/account`);
  await page.waitForFunction(() => !document.querySelector("#signedIn").classList.contains("hidden"));
  await openSection(page, "Wantlist");
  await page.waitForSelector(".want-row button");
  await page.click(".want-row button");
  await page.waitForFunction(() => document.querySelectorAll(".want-row").length === 0);
  check("removing an entry deletes it", backend.interests.length, 0);

  await page.goto(`${origin}/search`);
  await page.waitForTimeout(700);
  check("with nothing wanted, the section is hidden",
    await page.locator("#wantHeading.hidden").count(), 1);
  check("no errors around the wantlist", errors, []);
  await context.close();
}

// --- Importing a spreadsheet --------------------------------------------------
// Collectors already keep spreadsheets, and until now that was a reason not to
// use the app rather than a way into it. Nothing is written until the preview
// has been seen and confirmed.
{
  backend.cards = []; backend.failWrites = false; backend.snapshots = [];
  backend.noSnapshotTable = false;

  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/account`);
  await page.evaluate((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#signedIn").classList.contains("hidden"));

  await openSection(page, "Your cards");
  // Columns deliberately out of order, oddly named, with an extra one.
  const csv = [
    "Nickname,Card #,Player Name,Qty,Yr,Card Set,Paid",
    "judgey,#1,Aaron Judge,2,2024,Topps Chrome,300",
    "sotoshow,50,Juan Soto,,2024,Topps,",
    ",,,,,,",
  ].join("\r\n");
  await page.setInputFiles("#importFile", {
    name: "collection.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector("#importPanel:not(.hidden)");

  const summary = await page.locator("#importSummary").textContent();
  check("the preview counts the cards", summary.includes("2 cards ready"), true);
  check("and says a blank row was skipped", summary.includes("1 row skipped"), true);
  check("the unused column is named",
    (await page.locator("#importIgnored").textContent()).includes("Nickname"), true);
  check("nothing is added before confirming", backend.cards.length, 0);
  check("and the collection is still empty",
    await page.evaluate(() => JSON.parse(localStorage.getItem("the-database-cards") || "[]").length), 0);

  // Backing out has to leave everything alone.
  await page.click("#cancelImport");
  check("cancelling closes the preview", await page.locator("#importPanel").isVisible(), false);
  check("and writes nothing", backend.cards.length, 0);

  await page.setInputFiles("#importFile", {
    name: "collection.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  await page.waitForSelector("#importPanel:not(.hidden)");
  await page.click("#confirmImport");
  await page.waitForFunction(() => document.querySelector("#importPanel").classList.contains("hidden"));
  await page.waitForTimeout(900);

  check("both cards reach the backend", backend.cards.length, 2);
  const judge = backend.cards.find((c) => c.player === "Aaron Judge");
  check("the odd column names were understood", !!judge, true);
  check("quantity came across", judge.quantity, 2);
  check("so did purchase price", Number(judge.purchase_price), 300);
  check("and the card number", judge.card_number, "#1");
  check("imported cards are private", judge.visibility, "private");
  check("the message says what happened",
    (await page.locator("#importMessage").textContent()).includes("2 cards added"), true);

  // A file with no player column cannot be guessed at, and must say so rather
  // than importing a pile of blanks.
  await page.setInputFiles("#importFile", {
    name: "bad.csv", mimeType: "text/csv",
    buffer: Buffer.from("Set,Year\r\nTopps,2024"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#importMessage").textContent.includes("Player"));
  check("a file with no player column is refused, not half-imported",
    backend.cards.length, 2);
  check("the preview stays shut", await page.locator("#importPanel").isVisible(), false);
  check("no errors through the import", errors, []);
  await context.close();
}

// --- Bulk actions ---------------------------------------------------------------
// An import lands hundreds of cards with no storage location on any of them,
// and the location is the reason the app exists. Editing them one at a time is
// not a real option, so selection has to work on whatever the filters show.
{
  backend.cards = [
    { id: "e1111111-4444-4444-8444-444444444444", user_id: USER.id, player: "Aaron Judge",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1, visibility: "private" },
    { id: "e2222222-4444-4444-8444-444444444444", user_id: USER.id, player: "Juan Soto",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1, visibility: "private" },
    { id: "e3333333-4444-4444-8444-444444444444", user_id: USER.id, player: "Shohei Ohtani",
      year: 2023, card_set: "Bowman", parallel: "Base", grade: "Raw", quantity: 1, visibility: "private" },
  ];
  backend.failWrites = false; backend.snapshots = []; backend.noSnapshotTable = false;

  const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  await page.goto(origin + "/collection");
  await page.waitForFunction(() => document.querySelectorAll(".catalog-card").length === 3);

  const rowFor = (player) => backend.cards.find((c) => c.player === player);

  check("the bulk bar is hidden until asked for",
    await page.locator("#bulkBar").isVisible(), false);
  check("tiles carry no selection marker yet", await page.locator(".pick").count(), 0);

  await page.click("#selectMode");
  await page.waitForTimeout(200);
  check("selecting shows the bar", await page.locator("#bulkBar").isVisible(), true);
  check("and a checkbox on every tile", await page.locator(".pick").count(), 3);
  check("nothing is selected to start",
    (await page.locator("#bulkCount").textContent()), "0 selected");
  check("so the actions are disabled",
    await page.locator("#bulkEdit").isDisabled(), true);

  // A tile click must select rather than open the card, or selecting is
  // impossible on a phone where there is no modifier key.
  await page.locator(".catalog-card").first().click();
  await page.waitForTimeout(150);
  check("clicking a tile selects it", await page.locator("#bulkCount").textContent(), "1 selected");
  check("and does not open the card", await page.locator("#backdrop.open").count(), 0);
  check("the tile shows as picked", await page.locator(".catalog-card.picked").count(), 1);
  check("the actions come alive", await page.locator("#bulkEdit").isDisabled(), false);
  await page.locator(".catalog-card").first().click();
  await page.waitForTimeout(150);
  check("clicking again deselects", await page.locator("#bulkCount").textContent(), "0 selected");

  // Select all applies to what the filters are showing, not the whole
  // collection: narrowing first is how a big import gets split into piles.
  await page.selectOption("#setFilter", "Topps");
  await page.waitForTimeout(250);
  check("filtering narrows the grid", await page.locator(".catalog-card").count(), 2);
  await page.click("#bulkAll");
  await page.waitForTimeout(200);
  check("select all takes only what is shown",
    await page.locator("#bulkCount").textContent(), "2 selected");

  await page.click("#bulkEdit");
  await page.waitForSelector("#bulkForm");
  await page.fill('[name="container"]', "Binder 9");
  await page.fill('[name="section"]', "Page 1");
  await page.selectOption('[name="collectionStatus"]', "For sale");
  await page.click("#bulkForm .primary");
  await page.waitForTimeout(900);

  check("both selected cards get the container",
    [rowFor("Aaron Judge").storage_container, rowFor("Juan Soto").storage_container],
    ["Binder 9", "Binder 9"]);
  check("and the section",
    [rowFor("Aaron Judge").storage_section, rowFor("Juan Soto").storage_section],
    ["Page 1", "Page 1"]);
  check("and the collection type", rowFor("Juan Soto").collection_status, "For sale");
  check("the card that was filtered out is untouched",
    rowFor("Shohei Ohtani").storage_container || null, null);
  check("the bar says what happened",
    (await page.locator("#bulkMessage").textContent()).includes("2 cards updated"), true);

  await page.selectOption("#setFilter", "All sets");
  await page.waitForTimeout(250);
  check("the new container is offered as a filter",
    await page.locator("#containerFilter option").allTextContents(),
    ["All locations", "Binder 9 (2)"]);
  check("the selection survives the filter change",
    await page.locator("#bulkCount").textContent(), "2 selected");

  // A blank field must leave each card's own value alone, so a second pass can
  // set the slot without wiping the container that was just set.
  await page.click("#bulkNone");
  await page.waitForTimeout(150);
  await page.locator('.catalog-card[data-id="e1111111-4444-4444-8444-444444444444"]').click();
  await page.waitForTimeout(150);
  await page.click("#bulkEdit");
  await page.waitForSelector("#bulkForm");
  await page.fill('[name="slot"]', "Slot 4");
  await page.click("#bulkForm .primary");
  await page.waitForTimeout(900);
  check("a blank field keeps what the card already had",
    rowFor("Aaron Judge").storage_container, "Binder 9");
  check("and the field that was filled in is set", rowFor("Aaron Judge").storage_slot, "Slot 4");
  check("the other card is left alone", rowFor("Juan Soto").storage_slot || null, null);

  // Submitting an empty form would otherwise queue a write per card for nothing.
  await page.click("#bulkEdit");
  await page.waitForSelector("#bulkForm");
  await page.click("#bulkForm .primary");
  await page.waitForTimeout(200);
  check("an empty form is refused", await page.locator("#bulkError.show").count(), 1);
  check("and the form stays open", await page.locator("#bulkForm").count(), 1);
  await page.click("#bulkForm .close2");
  await page.waitForTimeout(200);

  // Sharing in bulk is the other half: an import arrives private, and a
  // collector who wants a public page should not click through 300 cards.
  await page.click("#bulkAll");
  await page.waitForTimeout(150);
  await page.click("#bulkShare");
  await page.waitForTimeout(900);
  check("every card is shared", backend.cards.every((c) => c.visibility === "public"), true);
  await page.click("#bulkUnshare");
  await page.waitForTimeout(900);
  check("and can be taken back down", backend.cards.every((c) => c.visibility === "private"), true);

  // Removal is the one that cannot be undone, so it asks first.
  await page.click("#bulkNone");
  await page.waitForTimeout(150);
  await page.locator('.catalog-card[data-id="e3333333-4444-4444-8444-444444444444"]').click();
  await page.waitForTimeout(150);
  await page.click("#bulkDelete");
  await page.waitForSelector("#bulkConfirm");
  check("nothing is deleted before confirming", backend.cards.length, 3);
  await page.click(".modal .close2");
  await page.waitForTimeout(200);
  check("backing out deletes nothing", backend.cards.length, 3);

  await page.click("#bulkDelete");
  await page.waitForSelector("#bulkConfirm");
  await page.click("#bulkConfirm");
  await page.waitForTimeout(900);
  check("confirming removes the selected card", backend.cards.length, 2);
  check("and it is the right one", rowFor("Shohei Ohtani") || null, null);
  check("the grid shrinks with it", await page.locator(".catalog-card").count(), 2);
  check("the selection is emptied afterwards",
    await page.locator("#bulkCount").textContent(), "0 selected");

  // Leaving select mode has to give the tiles back.
  await page.click("#selectMode");
  await page.waitForTimeout(200);
  check("the bar goes away", await page.locator("#bulkBar").isVisible(), false);
  check("the checkboxes go with it", await page.locator(".pick").count(), 0);
  await page.locator(".catalog-card").first().click();
  await page.waitForTimeout(300);
  check("and a tile opens the card again", await page.locator("#backdrop.open").count(), 1);
  await page.click(".modal .close");
  await page.waitForTimeout(200);

  // Pricing and selecting both take over the tile, so only one can be on.
  await page.click("#selectMode");
  await page.waitForTimeout(150);
  await page.click("#priceMode");
  await page.waitForTimeout(250);
  check("turning on pricing turns off selecting",
    await page.locator("#bulkBar").isVisible(), false);
  check("and the price inputs are back", await page.locator(".tile-price").count(), 2);
  await page.click("#selectMode");
  await page.waitForTimeout(250);
  check("and selecting turns pricing back off", await page.locator(".tile-price").count(), 0);

  check("no errors across the bulk flow", errors, []);
  await context.close();
}

// --- The Add page folded into the collection ------------------------------------
// Two doors into one card form, one of them a whole tab in the navigation.
// Adding a card belongs on the page the cards are on.
{
  const { context, page, errors } = await open("/collection");

  const scan = await page.goto(origin + "/scan");
  check("the old Add route lands on the collection",
    new URL(page.url()).pathname, "/collection");
  check("and it is a redirect, not a 404", scan.status() < 400, true);
  await page.waitForTimeout(500);

  check("the mobile nav carries no Add tab",
    await page.locator('.mobile-nav a[href="/scan"]').count(), 0);
  check("nor does the header nav",
    await page.locator('header nav a[href="/scan"]').count(), 0);

  // Without a key there is nothing to choose between, so the button goes
  // straight to the form rather than asking a question with one real answer.
  await page.click("#addCard");
  await page.waitForSelector("#manualForm");
  check("adding a card opens the form directly",
    await page.locator('#manualForm [name="player"]').count(), 1);
  check("and never promises a scanner this deployment has not got",
    (await page.locator(".modal-copy").textContent()).includes("Scan"), false);

  // The photo-first capture was the one thing the Add page had that the form
  // does not, so it has to survive the page going away.
  check("the form offers the camera", await page.locator("#photoFirst").isVisible(), true);
  await page.click("#photoFirst");
  await page.waitForSelector("#chooseFront");
  check("which opens the photo capture", await page.locator("#scanFront").count(), 1);
  check("and will not continue without a photo",
    await page.locator("#manualScan").isDisabled(), true);

  // A 1x1 PNG is enough: the point is that a chosen photo carries into the form.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64");
  await page.setInputFiles("#scanFront", { name: "front.png", mimeType: "image/png", buffer: png });
  await page.waitForFunction(() => !document.querySelector("#manualScan").disabled);
  await page.click("#manualScan");
  await page.waitForSelector("#manualForm");
  check("continuing lands in the card form", await page.locator("#manualForm").count(), 1);
  check("with the photo already attached",
    await page.locator("#frontPreview.show").count(), 1);

  await page.fill('[name="player"]', "Camera Path");
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps");
  await page.click(".submit-card");
  await page.waitForTimeout(600);
  check("and the card saves", await page.locator(".catalog-card").count(), 1);
  check("with its photo", await page.evaluate(() =>
    !!JSON.parse(localStorage.getItem("the-database-cards"))[0].photo), true);

  // Editing an existing card must not offer to start over from photos.
  await page.locator(".catalog-card").first().click();
  await page.waitForTimeout(250);
  await page.click(".edit-card");
  await page.waitForSelector("#manualForm");
  check("editing does not offer the camera", await page.locator("#photoFirst").count(), 0);
  await page.click(".close");

  check("no errors through the folded add flow", errors, []);
  await context.close();
}

// --- Telling a collector why their feed is empty ---------------------------------
// Cards are private by default and imports force it, which is right. It also
// means somebody can add three hundred cards, follow people, and get an empty
// feed with nothing anywhere saying why.
{
  const mine = (n, shared) => Array.from({ length: n }, (_, i) => ({
    id: "n" + i + "111111-1111-4111-8111-111111111111", user_id: USER.id,
    player: "Card " + i, year: 2024, card_set: "Topps", parallel: "Base",
    grade: "Raw", quantity: 1, visibility: shared ? "public" : "private",
  }));
  const load = async () => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1100 } });
    await context.addInitScript((user) => {
      localStorage.setItem("the-database-session", JSON.stringify({
        access_token: "t", refresh_token: "r",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user,
      }));
    }, USER);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    await page.goto(origin + "/collection");
    await page.waitForTimeout(900);
    return { context, page, errors };
  };

  backend.failWrites = false; backend.snapshots = []; backend.noSnapshotTable = false;
  backend.patches = []; backend.profiles = [];

  // Nothing to say about two cards, and saying it would just be nagging.
  backend.cards = mine(2, false);
  {
    const { context, page } = await load();
    check("no nudge on a nearly empty collection",
      await page.locator("#shareNudge").isVisible(), false);
    await context.close();
  }

  // Sharing cards while the profile switch is off changes nothing visible, so
  // that switch has to be what is asked for first.
  backend.cards = mine(8, false);
  {
    const { context, page, errors } = await load();
    check("a collection with nothing shared is told so",
      await page.locator("#shareNudge").isVisible(), true);
    check("and counted", (await page.locator("#nudgeTitle").textContent()), "8 cards, none shared.");
    check("with the profile switch off, that is what it asks for",
      (await page.locator("#nudgeAction").textContent()).trim(), "Set up my page");
    check("and it says why sharing cards first would do nothing",
      (await page.locator("#nudgeText").textContent()).includes("switched off"), true);
    check("nothing is shared by showing the notice",
      backend.cards.filter((c) => c.visibility === "public").length, 0);
    await page.click("#nudgeAction");
    await page.waitForTimeout(600);
    check("it leads to the account page", new URL(page.url()).pathname, "/account");
    check("no errors with the profile off", errors, []);
    await context.close();
  }

  // With the page live, the fix is one click.
  backend.profiles = [{ user_id: USER.id, handle: "collector", display_name: "A Collector",
    is_public: true, is_listed: false, show_values: false }];
  {
    const { context, page, errors } = await load();
    check("with a live page, it offers to share them",
      (await page.locator("#nudgeAction").textContent()).trim(), "Share all 8");
    check("and says what is never shared",
      (await page.locator("#nudgeText").textContent()).includes("never shared"), true);
    await page.click("#nudgeAction");
    await page.waitForTimeout(900);
    check("one click shares the collection",
      backend.cards.every((c) => c.visibility === "public"), true);
    check("in one request rather than one per card", backend.patches.length, 1);
    check("and the notice goes once there is nothing to say",
      await page.locator("#shareNudge").isVisible(), false);
    check("no errors sharing from the notice", errors, []);
    await context.close();
  }

  // Already sharing, so there is nothing to point out.
  backend.cards = mine(8, true);
  {
    const { context, page } = await load();
    check("no nudge once cards are shared",
      await page.locator("#shareNudge").isVisible(), false);
    await context.close();
  }

  // Waving it away has to stick, or it becomes nagging.
  backend.cards = mine(8, false);
  {
    const { context, page, errors } = await load();
    check("the notice can be waved away", await page.locator("#shareNudge").isVisible(), true);
    await page.click("#nudgeDismiss");
    check("which hides it", await page.locator("#shareNudge").isVisible(), false);
    await page.reload();
    await page.waitForTimeout(900);
    check("and it stays gone", await page.locator("#shareNudge").isVisible(), false);
    check("still without having shared anything",
      backend.cards.filter((c) => c.visibility === "public").length, 0);
    check("no errors dismissing", errors, []);
    await context.close();
  }

  backend.cards = []; backend.profiles = []; backend.patches = [];
}

// --- The feed -------------------------------------------------------------------
// One column, newest first. Three sources merge into it -- collectors you
// follow, cards you are hunting, players and teams you watch -- because three
// separate lists is a report, not a feed. All three read public_cards, which is
// the only thing that decides what is visible, and the two lists are never
// published.
{
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const THIRD = "aaaa9999-9999-4999-8999-999999999999";
  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  const pubCard = (id, handle, player, when, extra = {}) => ({
    id, handle, display_name: handle === "boxbreaker" ? "Box Breaker" : "Other Collector",
    player, year: 2024, sport: "Baseball", card_set: "Topps", card_number: "#" + id,
    team: "New York Yankees", parallel: "Base", grade: "Raw", quantity: 1,
    created_at: when, ...extra,
  });

  backend.cards = []; backend.interests = []; backend.follows = [];
  backend.followQueries = []; backend.publicQueries = [];
  backend.failWrites = false; backend.snapshots = []; backend.noSnapshotTable = false;
  backend.publicProfiles = [
    { user_id: OTHER, handle: "boxbreaker", display_name: "Box Breaker", is_public: true, is_listed: true },
    { user_id: THIRD, handle: "quietone", display_name: "Other Collector", is_public: true, is_listed: true },
  ];
  // One sitting at the scanner, then a separate one two hours earlier, plus a
  // single card from somebody else.
  backend.publicCards = [
    pubCard("f1", "boxbreaker", "Aaron Judge", t(3)),
    pubCard("f2", "boxbreaker", "Juan Soto", t(6)),
    pubCard("f3", "boxbreaker", "Gerrit Cole", t(11)),
    pubCard("f4", "boxbreaker", "Old Card", t(150)),
    pubCard("f5", "quietone", "Shohei Ohtani", t(20), { team: "Los Angeles Dodgers" }),
  ];

  // Signed out, the feed explains itself rather than looking broken.
  {
    const { context, page, errors } = await open("/feed");
    check("signed out, the feed asks you to sign in",
      await page.locator("#feedSignedOut").isVisible(), true);
    check("and shows no posts", await page.locator("#feedPosts").isVisible(), false);
    check("no follow request is made while signed out", backend.followQueries.length, 0);
    check("no errors on the signed-out feed", errors, []);
    await context.close();
  }

  const signedIn = async (route) => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    await context.addInitScript((user) => {
      localStorage.setItem("the-database-session", JSON.stringify({
        access_token: "t", refresh_token: "r",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user,
      }));
    }, USER);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    await page.goto(origin + route);
    await page.waitForTimeout(900);
    return { context, page, errors };
  };

  // Following nobody and listing nothing is not the same as having a feed that
  // came back empty, and only one of them is the collector's to fix.
  {
    const { context, page, errors } = await signedIn("/feed");
    check("an unconfigured feed says how to start",
      await page.locator("#feedEmpty").isVisible(), true);
    check("and does not claim your follows are quiet",
      await page.locator("#feedQuiet").isVisible(), false);
    check("no errors on the empty feed", errors, []);
    await context.close();
  }

  // Follow from the collector's own page, which is where you find them.
  {
    const { context, page, errors } = await signedIn("/c/boxbreaker");
    check("a signed-in visitor is offered a follow",
      await page.locator("#followCollector").isVisible(), true);
    check("the page says following is private",
      (await page.locator("#followNote").textContent()).includes("only you can see who you follow"), true);
    await page.click("#followCollector");
    await page.waitForTimeout(600);
    check("following is recorded", backend.follows.length, 1);
    check("against the signed-in collector", backend.follows[0].follower_id, USER.id);
    check("and points at the collector being viewed", backend.follows[0].followed_id, OTHER);
    check("the button reflects it",
      (await page.locator("#followCollector").textContent()).trim(), "Following");
    await page.click("#followCollector");
    await page.waitForTimeout(600);
    check("clicking again unfollows", backend.follows.length, 0);
    check("no errors through following", errors, []);
    await context.close();
  }

  backend.follows = [
    { follower_id: USER.id, followed_id: OTHER, created_at: t(1000) },
    { follower_id: USER.id, followed_id: THIRD, created_at: t(900) },
  ];
  // Somebody else's follow, which this collector must never see.
  backend.follows.push({ follower_id: THIRD, followed_id: OTHER, created_at: t(500) });

  {
    const { context, page, errors } = await signedIn("/feed");
    await page.waitForSelector(".post");

    // A card at a time would bury everybody under one person's box break.
    const posts = await page.evaluate(() => [...document.querySelectorAll(".post")].map((p) => ({
      who: p.querySelector(".post-who b").textContent,
      caption: p.querySelector(".post-caption b").textContent,
      shots: p.querySelectorAll(".post-shot").length,
    })));
    check("cards added together become one post", posts.length, 3);
    check("the sitting at the scanner is grouped", posts[0].caption, "Added 3 cards");
    check("under the collector who added them", posts[0].who, "Box Breaker");
    check("and every card in it is there to swipe through", posts[0].shots, 3);
    check("a different collector is its own post", posts[1].who, "Other Collector");
    // Three posts all stamped "today" would say nothing about which is newest,
    // which is the one thing a feed is for.
    check("a post says how long ago, not just what day",
      /minutes? ago|hours? ago|just now/.test(
        await page.locator(".post .post-who small").first().textContent()), true);
    check("and so is the same collector two hours earlier", posts[2].caption, "Old Card");
    check("a single card is captioned by name, not counted", posts[1].caption, "Shohei Ohtani");

    // Nothing to explain when the post is simply from somebody you follow.
    check("no reason chip on a plain follow", await page.locator(".post-reason").count(), 0);

    check("the follow query names the signed-in collector",
      backend.followQueries.every((q) => q.includes("follower_id=eq.") || q.includes("followed_id=eq.")), true);
    check("every read of the cards table is scoped to the reader",
      backend.cardQueries.every((q) => q.includes(encodeURIComponent(USER.id))), true);
    check("no errors on the follow feed", errors, []);
    await context.close();
  }

  // Wantlist and watchlist matches, which are searches and nothing else: no row
  // is written anywhere recording that a match happened.
  backend.interests = [
    { id: "w1", user_id: USER.id, kind: "wanted", player: "Shohei Ohtani", created_at: t(10) },
    // A team the followed collector deals in, so a post arrives by two routes
    // at once and the merge is exercised rather than assumed.
    { id: "w2", user_id: USER.id, kind: "watching", team: "New York Yankees", created_at: t(10) },
  ];
  {
    const { context, page, errors } = await signedIn("/feed");
    await page.waitForSelector(".post-reason");
    const reasons = await page.evaluate(() => [...document.querySelectorAll(".post")].map((p) => ({
      who: p.querySelector(".post-who b").textContent,
      chip: p.querySelector(".post-reason") ? p.querySelector(".post-reason").textContent : "",
    })));
    check("a match says why it is in the feed",
      reasons.find((r) => r.who === "Other Collector").chip, "On your wantlist");
    check("and a watched team says so too",
      reasons.some((r) => r.chip === "You watch this"), true);
    // The old page listed the same card again under each heading it matched.
    // One card is one post however many ways it arrived.
    check("a card matched twice is still shown once",
      await page.evaluate(() => [...document.querySelectorAll(".post-shot")]
        .map((s) => s.getAttribute("aria-label"))
        .filter((v, i, all) => all.indexOf(v) !== i).length), 0);

    // The whole privacy claim in one check: what was sent was a search, and it
    // carried no hint of who was searching.
    const searches = backend.publicQueries.filter((q) => q.includes("or=("));
    check("interests leave as a search, not a list", searches.length > 0, true);
    check("and the search says nothing about who is asking",
      searches.every((q) => !q.includes(USER.id)), true);
    check("nothing about the wantlist is written down",
      backend.interests.length, 2);
    check("no errors with interests", errors, []);
    await context.close();
  }

  // A followed collector's private card must never reach the feed. public_cards
  // is what enforces that, and the client must not be reaching around it.
  {
    backend.cards = [{ id: "secret", user_id: OTHER, player: "Not Yours", visibility: "private" }];
    const { context, page, errors } = await signedIn("/feed");
    await page.waitForSelector(".post");
    const text = await page.locator("#feedPosts").textContent();
    check("a followed collector's private card is not in the feed",
      text.includes("Not Yours"), false);
    check("and the feed never asked the cards table for it",
      backend.cardQueries.some((q) => q.includes(OTHER)), false);
    check("no errors on the privacy pass", errors, []);
    await context.close();
    backend.cards = [];
  }

  // Followers are the one list only its owner may see.
  {
    backend.follows.push({ follower_id: THIRD, followed_id: USER.id, created_at: t(30) });
    const { context, page, errors } = await signedIn("/account");
    await openSection(page, "Your feed");
    await page.waitForTimeout(700);
    check("the owner is told how many follow them",
      (await page.locator("#followerLine").textContent()).includes("1 collector follows you"), true);
    check("who they follow is listed", await page.locator("#followList .want-row").count(), 2);
    check("every followers query is scoped to the reader",
      backend.followQueries.filter((q) => q.includes("followed_id=eq."))
        .every((q) => q.includes(encodeURIComponent(USER.id))), true);

    await page.click("#followList [data-unfollow]");
    await page.waitForTimeout(700);
    check("and can be undone from here",
      backend.follows.filter((f) => f.follower_id === USER.id).length, 1);
    check("no errors on the account feed section", errors, []);
    await context.close();
  }

  // The prompt shown once to a new account, which opens the real controls
  // rather than keeping a second copy of them.
  {
    backend.follows = []; backend.interests = [];
    const { context, page, errors } = await signedIn("/account");
    check("a new account is offered feed setup",
      await page.locator("#feedSetup").isVisible(), true);
    await page.click("#setupSkip");
    check("which can be dismissed", await page.locator("#feedSetup").isVisible(), false);
    await page.reload();
    await page.waitForTimeout(900);
    check("and stays dismissed", await page.locator("#feedSetup").isVisible(), false);
    check("no errors on the setup prompt", errors, []);
    await context.close();
  }

  backend.publicCards = []; backend.publicProfiles = []; backend.follows = []; backend.interests = [];
}

// --- The first thirty seconds -------------------------------------------------
// Somebody arriving with nothing was shown "No cards found -- try another player
// or clear the filters" and a Clear filters button. They had not searched and
// had set no filters, so the app opened by telling them they had already got it
// wrong. An empty collection and a filter that matched nothing are different
// problems and only one of them is the visitor's doing.
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${origin}/collection`);
  await page.waitForSelector("#empty:not(.hidden)");
  check("an empty collection says so",
    (await page.locator("#emptyTitle").textContent()).trim(), "Your collection is empty");
  check("it does not blame filters nobody set",
    /filter/i.test(await page.locator("#emptyText").textContent()), false);
  check("Clear filters is not offered when nothing is filtered",
    await page.locator("#clear").isVisible(), false);
  check("a way to start is", await page.locator("#emptyAdd").isVisible(), true);
  // The button has to work, not just be there.
  await page.click("#emptyAdd");
  check("and it opens the card form", await page.locator("#manualForm").count(), 1);
  await page.keyboard.press("Escape");

  // The home page opened with a chart of nothing and four dashes, which reads
  // as broken rather than as new.
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => !document.querySelector("#firstRun").classList.contains("hidden"));
  check("the home page offers a first step", await page.locator("#firstRun").isVisible(), true);
  check("and hides a dashboard with nothing to show",
    await page.locator("#dashboard").isVisible(), false);

  // Once there is a collection, both revert to the normal thing.
  await page.goto(`${origin}/collection`);
  await addCard(page, "Aaron Judge");
  check("the empty state goes away", await page.locator("#empty").isVisible(), false);
  await page.fill("#search", "nobody named this");
  await page.waitForTimeout(300);
  check("a search that matches nothing says that instead",
    (await page.locator("#emptyTitle").textContent()).trim(), "No cards found");
  check("and offers Clear filters again", await page.locator("#clear").isVisible(), true);
  check("without offering to add a first card",
    await page.locator("#emptyAdd").isVisible(), false);

  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.querySelector("#firstRun").classList.contains("hidden"));
  check("the home dashboard returns once there are cards",
    await page.locator("#dashboard").isVisible(), true);
  check("no errors through the first run", errors, []);
  await context.close();
}

// --- Sport tabs -------------------------------------------------------------
// The tabs were four names typed into the markup while the card form offered
// five sports, so a hockey card could be saved and then never filtered for.
// They are built from the collection now, so the two cannot drift apart.
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/collection`);

  const tabs = () => page.evaluate(() =>
    [...document.querySelectorAll("#tabs button")].map((b) => b.textContent.trim()));

  check("an empty collection offers only All", await tabs(), ["All"]);

  await addCard(page, "Lionel Messi", "Soccer");
  check("adding a soccer card gives it a tab", await tabs(), ["All", "Soccer"]);

  await addCard(page, "Connor Bedard", "Hockey");
  check("hockey is filterable too, which it never was",
    (await tabs()).includes("Hockey"), true);

  await addCard(page, "Aaron Judge", "Baseball");
  await addCard(page, "Juan Soto", "Baseball");
  // Two baseball cards against one of everything else, so the busiest sport
  // should lead.
  const ordered = await tabs();
  check("All comes first", ordered[0], "All");
  check("then the sport with the most cards", ordered[1], "Baseball");
  check("no sport nobody owns is offered", ordered.includes("Basketball"), false);

  // The tab has to actually filter, not just exist.
  await page.click('#tabs button[data-sport="Soccer"]');
  await page.waitForTimeout(300);
  check("picking soccer shows only the soccer card",
    await page.locator("#grid .catalog-card").count(), 1);
  check("and it is the right one",
    (await page.locator("#grid .catalog-card h3").textContent()).includes("Messi"), true);
  check("the tab is marked active",
    await page.locator('#tabs button[data-sport="Soccer"].active').count(), 1);

  // Back via the All tab, not the Clear button: that one lives inside the empty
  // state and is hidden whenever the filter actually matched something.
  await page.click('#tabs button[data-sport="All"]');
  await page.waitForTimeout(300);
  check("All brings everything back",
    await page.locator("#grid .catalog-card").count(), 4);
  check("and All is the active tab again",
    await page.locator('#tabs button[data-sport="All"].active').count(), 1);
  check("no errors around the tabs", errors, []);
  await context.close();
}

// --- Photo bandwidth ----------------------------------------------------------
// Signed URLs expire, and when one is reissued its token changes, so the
// browser treats the photo as a new file and downloads it again. At two hours
// that meant a hundred-card collection re-fetching 24MB of images two or three
// times a day, which is most of a free tier for one person.
{
  backend.cards = Array.from({ length: 6 }, (_, i) => ({
    id: `bbbbbbbb-9999-4999-8999-99999999999${i}`, user_id: USER.id,
    player: `Player ${i}`, year: 2024, card_set: "Topps", parallel: "Base",
    grade: "Raw", quantity: 1,
    front_image_path: `${USER.id}/${i}-front.jpg`,
    front_thumb_path: `${USER.id}/${i}-front-thumb.jpg`,
  }));
  backend.snapshots = []; backend.noSnapshotTable = false; backend.signCalls = 0;

  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/collection`);
  await page.waitForFunction(() => document.querySelectorAll("#grid .card-photo").length > 0);

  // The grid draws tiles about 300px wide. Asking for the full photo there is
  // the whole cost problem.
  const gridSources = await page.evaluate(() =>
    [...document.querySelectorAll("#grid .card-photo")].map((i) => i.getAttribute("src")));
  check("every tile draws the thumbnail",
    gridSources.every((src) => src.includes("-front-thumb.jpg")), true);
  check("no tile draws the full photo",
    gridSources.some((src) => /\d-front\.jpg/.test(src)), false);

  // The detail view is where somebody actually looks at the card.
  await page.click(".catalog-card");
  await page.waitForSelector(".detail-art .card-photo");
  const detail = await page.locator(".detail-art .card-photo").getAttribute("src");
  check("the card itself opens the full photo", detail.includes("-front-thumb.jpg"), false);
  await page.keyboard.press("Escape");

  // A cached URL must survive a reload, or the cache is doing nothing.
  const before = backend.signCalls;
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#grid .card-photo").length > 0);
  check("a reload signs nothing again", backend.signCalls, before);

  const cached = await page.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem("the-database-signed") || "{}"))
      .map((v) => v.expires));
  const days = (Math.min(...cached) - Date.now()) / 86400000;
  check("signed URLs are kept for days, not hours", days > 5, true);
  check("no errors while loading photos", errors, []);
  await context.close();
}

// --- Sold-price lookup --------------------------------------------------------
// 130point takes no search term in its address, so the terms go to the
// clipboard and the site is opened for pasting. If the copy silently fails the
// visitor arrives at an empty search box with nothing to paste, so what is
// actually checked here is that something reached the clipboard.
{
  const context = await browser.newContext({
    viewport: { width: 900, height: 1100 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/collection`);
  await addCard(page, "Aaron Judge", { set: "Topps Chrome", year: "2024" });

  await page.click(".catalog-card");
  await page.waitForSelector(".comp-panel");
  const shown = (await page.locator("#compTerms").textContent()).trim();
  check("the search terms are shown, not hidden in a link", shown, "2024 Topps Chrome Aaron Judge");
  check("130point is offered",
    await page.locator('.comp-panel a[href*="130point.com"]').count(), 1);
  check("it opens in a new tab rather than losing the collection",
    await page.locator('.comp-panel a[href*="130point.com"]').getAttribute("target"), "_blank");
  check("eBay is kept as a fallback",
    await page.locator('.comp-panel a[href*="ebay.com"]').count(), 1);

  await page.locator(".copy-terms").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check("the terms reach the clipboard", copied, "2024 Topps Chrome Aaron Judge");
  check("the button says so",
    (await page.locator(".copy-terms").textContent()).includes("Copied"), true);
  // The label has to come back, or a second card cannot be copied.
  await page.waitForFunction(() =>
    document.querySelector(".copy-terms").textContent.includes("Copy search terms"));
  check("and goes back to its label", true, true);

  await page.keyboard.press("Escape");

  // The same pair on the grid, where prices are actually set.
  await page.click("#priceMode");
  await page.waitForSelector(".comp-copy");
  await page.evaluate(() => navigator.clipboard.writeText("nothing"));
  await page.locator(".comp-copy").first().click();
  const fromGrid = await page.evaluate(() => navigator.clipboard.readText());
  check("copying works from the pricing grid too", fromGrid, "2024 Topps Chrome Aaron Judge");
  // Tapping either action must not open the card underneath.
  check("copying does not open the card", await page.locator("#modal").isVisible(), false);
  check("no errors around the lookup", errors, []);
  await context.close();
}

// --- Leaving -----------------------------------------------------------------
// Somebody who cannot delete their account is stuck with it, and export alone
// is not a way out. The safeguard is typing the word, so most of this is about
// what happens when it is not typed.
{
  backend.cards = [
    { id: "aaaaaaaa-8888-4888-8888-888888888881", user_id: USER.id, player: "Aaron Judge",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1,
      front_image_path: `${USER.id}/one-front.jpg`, back_image_path: `${USER.id}/one-back.jpg` },
  ];
  backend.profiles = [{ user_id: USER.id, handle: "leaver", is_public: true }];
  backend.snapshots = []; backend.noSnapshotTable = false;
  backend.accountDeletes = 0; backend.photoDeletes = []; backend.failDelete = false;

  // Deliberately not addInitScript: that reinstates the session on every
  // navigation, so the page the user lands on after deleting would be signed
  // in again and the check below would be testing the harness, not the app.
  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/account`);
  await page.evaluate((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  await page.reload();
  await page.waitForFunction(() => !document.querySelector("#signedIn").classList.contains("hidden"));

  await openSection(page, "Leaving");
  check("the confirmation is not shown until asked",
    await page.locator("#deleteConfirm").isVisible(), false);
  await page.locator("#deleteAccount").click();
  check("asking opens it", await page.locator("#deleteConfirm").isVisible(), true);
  check("it says what will go",
    (await page.locator("#deleteCount").textContent()).includes("1 card"), true);
  check("the button starts dead", await page.locator("#deleteForReal").isDisabled(), true);

  // The near-misses matter more than the hit: this is the only safeguard.
  for (const typed of ["delete", "DELETE ME", "DELET"]) {
    await page.locator("#deleteWord").fill(typed);
    check(`"${typed}" does not arm the button`,
      await page.locator("#deleteForReal").isDisabled(), true);
  }
  await page.locator("#deleteWord").fill("DELETE");
  check("the exact word arms it", await page.locator("#deleteForReal").isDisabled(), false);

  // Backing out must leave everything alone.
  await page.locator("#deleteCancel").click();
  check("cancelling closes it", await page.locator("#deleteConfirm").isVisible(), false);
  check("and deletes nothing", backend.accountDeletes, 0);

  await page.locator("#deleteAccount").click();
  check("reopening clears the typed word",
    await page.locator("#deleteWord").inputValue(), "");

  await page.locator("#deleteWord").fill("DELETE");
  await page.locator("#deleteForReal").click();
  await page.waitForFunction(() => location.pathname === "/");

  check("the account was deleted once", backend.accountDeletes, 1);
  // Storage files hang off no cascade, so the client has to remove them.
  check("both photos were removed", backend.photoDeletes.length, 2);
  check("the visitor is told it worked",
    await page.locator("#goodbye:not(.hidden)").count(), 1);
  check("the goodbye is not left in the address bar",
    new URL(page.url()).search, "");
  // An empty array written back by a fresh page load is not leftover data, so
  // this asks whether anything still holds content rather than whether a key
  // exists at all.
  const leftover = await page.evaluate(() =>
    ["the-database-cards", "the-database-session", "the-database-history",
      "the-database-outbox", "the-database-signed", "the-database-prices"]
      .filter((k) => {
        const raw = localStorage.getItem(k);
        if (!raw) return false;
        try { const v = JSON.parse(raw); return Object.keys(v || {}).length > 0; }
        catch { return true; }
      }));
  check("nothing is left on the device", leftover, []);
  check("no errors while leaving", errors, []);
  await context.close();
}

// A failed deletion must say so rather than look like it worked.
{
  backend.cards = []; backend.profiles = []; backend.snapshots = [];
  backend.accountDeletes = 0; backend.photoDeletes = []; backend.failDelete = true;

  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/account`);
  await page.waitForFunction(() => !document.querySelector("#signedIn").classList.contains("hidden"));
  await openSection(page, "Leaving");
  await page.locator("#deleteAccount").click();
  await page.locator("#deleteWord").fill("DELETE");
  await page.locator("#deleteForReal").click();
  await page.waitForFunction(() => document.querySelector("#deleteMessage").textContent.length > 0);

  check("the failure is reported",
    (await page.locator("#deleteMessage").textContent()).length > 0, true);
  check("the page did not pretend to leave", new URL(page.url()).pathname, "/account");
  check("the session survives so it can be retried",
    await page.evaluate(() => !!localStorage.getItem("the-database-session")), true);
  check("and the button is offered again",
    await page.locator("#deleteForReal").isDisabled(), false);
  check("no errors on a failed delete", errors, []);
  await context.close();
  backend.failDelete = false;
}

// --- A collection must never contain somebody else's cards -------------------
// Row-level security is what keeps collectors apart, but policies are OR'd
// together: one stray permissive policy in the project and this query comes
// back with everybody's rows. A tester saw exactly that — another collector's
// cards, purchase prices included, sitting in his own collection. The client
// asks only for its own rows so a database mistake cannot paint them in.
{
  backend.cards = [
    { id: "eeeeeeee-6666-4666-8666-666666666661", user_id: USER.id, player: "My Own Card",
      year: 2024, card_set: "Topps", parallel: "Base", grade: "Raw", quantity: 1,
      current_value: 10 },
    { id: "eeeeeeee-6666-4666-8666-666666666662", user_id: "99999999-9999-4999-8999-999999999999",
      player: "Somebody Elses Card", year: 2024, card_set: "Topps", parallel: "Base",
      grade: "Raw", quantity: 1, current_value: 1426, purchase_price: 575.5,
      storage_container: "Their Binder", notes: "their private note" },
  ];
  backend.snapshots = []; backend.failWrites = false; backend.noSnapshotTable = false;
  backend.cardQueries = [];

  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  await context.addInitScript((user) => {
    localStorage.setItem("the-database-session", JSON.stringify({
      access_token: "t", refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user,
    }));
  }, USER);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${origin}/collection`);
  await page.waitForFunction(() => document.querySelectorAll("#grid .catalog-card").length > 0);

  check("the collection asks only for its owner's rows",
    backend.cardQueries.every((q) => q.includes(`user_id=eq.${USER.id}`)), true);
  check("only the collector's own card is shown",
    await page.locator("#grid .catalog-card").count(), 1);
  const grid = await page.locator("#grid").innerHTML();
  check("another collector's card is not in the collection",
    grid.includes("Somebody Elses Card"), false);
  check("their storage location never arrives", grid.includes("Their Binder"), false);
  // The header total is what the tester actually noticed: a value that was not his.
  check("the total counts only the collector's own cards",
    (await page.locator("#count").textContent()).includes("1"), true);
  check("no errors while loading the collection", errors, []);
  await context.close();
}

await browser.close();
server.close();
console.log(failed ? "\nFAILED" : "\nAll browser checks passed");
process.exit(failed ? 1 : 0);
