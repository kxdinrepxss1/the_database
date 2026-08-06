// Measures how the app behaves with a realistic collection, with latency on
// every backend call so network round-trips are visible rather than free.
import worker from "../worker/index.js";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CARDS = Number(process.argv[2] || 100);
const LATENCY = Number(process.argv[3] || 40); // ms per backend call
const env = { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "k" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "a@b.c" };

const rows = Array.from({ length: CARDS }, (_, i) => ({
  id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
  user_id: USER.id, player: `Player ${i}`, year: 2024, sport: "Baseball",
  card_set: `Set ${i % 12}`, card_number: `#${i}`, team: "NYY", parallel: "Base",
  grade: "Raw", quantity: 1, current_value: 10 + i,
  storage_container: `Binder ${i % 5}`, storage_section: `Page ${i % 9}`, storage_slot: `Slot ${i % 9}`,
  front_image_path: `${USER.id}/${i}-front.jpg`,
  back_image_path: `${USER.id}/${i}-back.jpg`,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
}));

const counts = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let body = ""; for await (const c of req) body += c;
  const tally = (k) => { counts[k] = (counts[k] || 0) + 1; };

  if (url.pathname.startsWith("/auth/v1/")) {
    tally("auth"); await sleep(LATENCY);
    return res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(url.pathname.includes("token")
        ? { access_token: "t", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER }
        : USER));
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/")) {
    await sleep(LATENCY);
    let parsed = {}; try { parsed = JSON.parse(body || "{}"); } catch {}
    if (Array.isArray(parsed.paths)) {
      tally("sign(batch)");
      return res.writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(parsed.paths.map((path) => ({ path, signedURL: "/photo.jpg?token=x" }))));
    }
    tally("sign");
    return res.writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ signedURL: "/photo.jpg?token=x" }));
  }
  if (url.pathname === "/photo.jpg") {
    tally("photo"); await sleep(LATENCY);
    // A stand-in for a real card photo: not tiny, as they are camera JPEGs.
    return res.writeHead(200, { "content-type": "image/jpeg" }).end(Buffer.alloc(120 * 1024));
  }
  if (url.pathname === "/rest/v1/collection_snapshots") {
    tally("snapshots"); await sleep(LATENCY);
    return res.writeHead(200, { "content-type": "application/json" }).end("[]");
  }
  if (url.pathname === "/rest/v1/cards") {
    tally("cards"); await sleep(LATENCY);
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(rows));
  }
  const r = await worker.fetch(new Request("http://127.0.0.1" + req.url), env);
  tally("page:" + url.pathname);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
env.SUPABASE_URL = origin;

function chrome() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const d = readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().pop();
  const exe = d && join(root, d, "chrome-linux", "chrome");
  return exe && existsSync(exe) ? exe : undefined;
}
const browser = await chromium.launch({ executablePath: chrome() });
const context = await browser.newContext({ viewport: { width: 414, height: 900 } });
await context.addInitScript((user) => {
  localStorage.setItem("the-database-session", JSON.stringify({
    access_token: "t", refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600, user,
  }));
}, USER);
const page = await context.newPage();

console.log(`\n=== ${CARDS} cards, ${LATENCY}ms per backend call ===\n`);

const started = Date.now();
await page.goto(origin + "/collection");
const domReady = Date.now() - started;

// Wait until the grid actually has content.
let firstCard = null;
for (let i = 0; i < 400; i++) {
  if (await page.locator(".catalog-card").count() > 0) { firstCard = Date.now() - started; break; }
  await sleep(50);
}
// Then until photos have been attached.
let withPhotos = null;
for (let i = 0; i < 400; i++) {
  if (await page.locator(".card-art.has-photo").count() > 0) { withPhotos = Date.now() - started; break; }
  await sleep(50);
}
await sleep(1500);
const settled = Date.now() - started;

const html = (await page.content()).length;
console.log(`page HTML served            ${(html / 1024).toFixed(0)} KB`);
console.log(`DOM ready                   ${domReady} ms`);
console.log(`first card visible          ${firstCard ?? "never"} ms`);
console.log(`first photo visible         ${withPhotos ?? "never"} ms`);
console.log(`settled                     ${settled} ms`);
console.log(`\nbackend calls:`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);

// Cost of re-rendering the grid, which happens on every search keystroke.
const renderMs = await page.evaluate(() => {
  const t = performance.now();
  for (let i = 0; i < 10; i++) render();
  return (performance.now() - t) / 10;
});
console.log(`\nrender() per call           ${renderMs.toFixed(1)} ms  (runs on every search keystroke)`);

// Navigating between tabs is a full page load in this app.
const navStart = Date.now();
Object.keys(counts).forEach((k) => delete counts[k]);
// Search replaced Pricing in the nav; this had been clicking a link that no
// longer exists, so the benchmark ended in a timeout nobody saw.
await page.click('.mobile-nav a[href="/search"]');
await page.waitForTimeout(2500);
console.log(`\nnavigating Collection -> Search took ${Date.now() - navStart} ms and repeated:`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`);

await browser.close();
server.close();
