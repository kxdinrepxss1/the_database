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
const backend = { cards: [], snapshots: [], failWrites: false, writeAttempts: 0 };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.c" };

async function supabase(req, url, body) {
  if (url.pathname.startsWith("/auth/v1/user")) return [200, USER];
  if (url.pathname.startsWith("/auth/v1/token")) return [200, { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER }];
  if (url.pathname.startsWith("/storage/v1/")) return [200, {}];
  if (url.pathname === "/rest/v1/collection_snapshots") {
    if (req.method === "GET") return [200, backend.snapshots];
    if (req.method === "POST") {
      const rows = JSON.parse(body);
      backend.snapshots = backend.snapshots.concat(Array.isArray(rows) ? rows : [rows]);
      return [201, null];
    }
  }
  if (url.pathname === "/rest/v1/cards") {
    if (req.method === "GET") return [200, backend.cards];
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
for (const route of ["/", "/collection", "/pricing", "/scan", "/account", "/reset-password"]) {
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

// The pricing page must read and write the card's own price.
{
  const { context, page, errors } = await open("/pricing");
  await page.evaluate(() => {
    localStorage.setItem("the-database-cards", JSON.stringify([{
      id: "11111111-1111-4111-8111-111111111111", player: "Aaron Judge", year: "2024",
      sport: "Baseball", set: "Topps", number: "#1", parallel: "Base", grade: "Raw",
      team: "NYY", quantity: 1, currentValue: 10, initials: "AJ", color: "blue",
    }]));
  });
  await page.reload();
  await page.waitForTimeout(400);
  check("existing price loads into the pricing input",
    await page.locator("[data-price-id]").first().inputValue(), "10");
  await page.fill("[data-price-id]", "25");
  await page.click("[data-save-id]");
  await page.waitForTimeout(300);
  check("edited price is written to the card", await page.evaluate(() =>
    JSON.parse(localStorage.getItem("the-database-cards"))[0].currentValue), 25);
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

await browser.close();
server.close();
console.log(failed ? "\nFAILED" : "\nAll browser checks passed");
process.exit(failed ? 1 : 0);
