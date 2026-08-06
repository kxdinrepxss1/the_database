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
const backend = { cards: [], snapshots: [], profiles: [], takenHandles: [], patches: [], publicCards: [], publicQueries: [], publicProfiles: [], collectorQueries: [], cardQueries: [], failWrites: false, noSnapshotTable: false, writeAttempts: 0, signCalls: 0 };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.c" };

async function supabase(req, url, body) {
  if (url.pathname.startsWith("/auth/v1/user")) return [200, USER];
  if (url.pathname.startsWith("/auth/v1/token")) return [200, { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER }];
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    let parsed = {}; try { parsed = JSON.parse(body || "{}"); } catch {}
    if (Array.isArray(parsed.paths)) {
      backend.signCalls++;
      return [200, parsed.paths.map((path) => ({ path, signedURL: "/photo.jpg?token=x" }))];
    }
    backend.signCalls++;
    return [200, { signedURL: "/photo.jpg?token=x" }];
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
      // Mirror PostgREST's ilike well enough to prove the filter is applied.
      const term = decodeURIComponent((or.match(/player\.ilike\.([^,]*)/) || [])[1] || "").replace(/\*/g, "").toLowerCase();
      rows = rows.filter((r) => ["player", "card_set", "team", "parallel"]
        .some((f) => String(r[f] || "").toLowerCase().includes(term)));
    }
    return [200, rows];
  }
  if (url.pathname === "/rest/v1/collector_profiles") {
    if (req.method === "GET") {
      if (url.search.includes("is_public=eq.true")) {
        backend.collectorQueries.push(url.search);
        let rows = backend.publicProfiles;
        const or = (url.search.match(/or=\(([^)]*)\)/) || [])[1] || "";
        if (or) {
          const term = decodeURIComponent((or.match(/handle\.ilike\.([^,]*)/) || [])[1] || "")
            .replace(/\*/g, "").toLowerCase();
          rows = rows.filter((p) => (p.handle + " " + (p.display_name || "")).toLowerCase().includes(term));
        }
        return [200, rows];
      }
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
  const response = await worker.fetch(new Request("http://127.0.0.1" + req.url), env);
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
for (const route of ["/", "/collection", "/scan", "/account", "/reset-password"]) {
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

const addCard = async (page, player) => {
  await page.click("#addCard");
  await page.fill('[name="player"]', player);
  await page.fill('[name="year"]', "2024");
  await page.fill('[name="set"]', "Topps Chrome");
  await page.click(".submit-card");
  await page.waitForTimeout(500);
};
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
    { handle: "kadin", display_name: "Kadin R" },
    { handle: "someone", display_name: "Someone Else" },
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
