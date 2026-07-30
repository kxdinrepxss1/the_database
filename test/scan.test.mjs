// Exercises /api/scan-card against a mocked Supabase + OpenAI.
import worker from "../worker/index.js";

const SUPA = "https://example.supabase.co";
const env = {
  SUPABASE_URL: SUPA,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  OPENAI_API_KEY: "sk-test",
};

const PNG = "data:image/jpeg;base64,AAAA";
let calls;

function mockFetch({ scanCount = 0, tableMissing = false, logFails = false, openaiCard = null }) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push((opts.method || "GET") + " " + u.replace(SUPA, ""));
    if (u.includes("/auth/v1/user"))
      return new Response(JSON.stringify({ id: "user-abc", email: "a@b.c" }), { status: 200 });
    if (u.includes("/rest/v1/scan_events?")) {
      if (tableMissing) return new Response('{"message":"relation does not exist"}', { status: 404 });
      return new Response("[]", { status: 200, headers: { "content-range": `0-0/${scanCount}` } });
    }
    if (u.includes("/rest/v1/scan_events"))
      return new Response("", { status: logFails ? 401 : 201 });
    if (u.includes("api.openai.com"))
      return new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify(openaiCard || { player: "Aaron Judge", year: "2024", set: "Topps Chrome", number: "#50", parallel: "Base", sport: "Baseball", team: "New York Yankees", grade: "Raw", serial_number: "", confidence: "high" }) }] }],
      }), { status: 200 });
    throw new Error("unexpected fetch: " + u);
  };
}

const scan = (extraEnv = {}) => worker.fetch(new Request("https://x/api/scan-card", {
  method: "POST",
  headers: { authorization: "Bearer token-xyz", "content-type": "application/json" },
  body: JSON.stringify({ front: PNG }),
}), { ...env, ...extraEnv });

let failed = false;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: got ${got}, want ${want}`);
};

// 1. Under the limit -> succeeds and returns the card.
mockFetch({ scanCount: 3 });
let res = await scan();
check("under limit", res.status, 200);
const body = await res.json();
check("returns identified player", body.card && body.card.player, "Aaron Judge");
check("logged the scan before calling OpenAI",
  calls.indexOf("POST /rest/v1/scan_events") < calls.findIndex(c => c.includes("openai")), true);

// 2. At the limit -> 429, and OpenAI is never called.
mockFetch({ scanCount: 25 });
res = await scan();
check("at default limit of 25", res.status, 429);
check("no OpenAI call when rate limited", calls.some(c => c.includes("openai")), false);
check("no scan logged when rate limited", calls.includes("POST /rest/v1/scan_events"), false);

// 3. Over the limit.
mockFetch({ scanCount: 99 });
check("over limit", (await scan()).status, 429);

// 4. Configurable limit.
mockFetch({ scanCount: 5 });
check("custom SCAN_DAILY_LIMIT=5 blocks at 5", (await scan({ SCAN_DAILY_LIMIT: "5" })).status, 429);
mockFetch({ scanCount: 4 });
check("custom SCAN_DAILY_LIMIT=5 allows at 4", (await scan({ SCAN_DAILY_LIMIT: "5" })).status, 200);

// 5. scan_events table not created yet -> fail closed, no OpenAI spend.
mockFetch({ tableMissing: true });
res = await scan();
check("missing table fails closed", res.status, 503);
check("no OpenAI call when table missing", calls.some(c => c.includes("openai")), false);

// 6. Logging the scan fails -> refuse rather than spend unmetered.
mockFetch({ logFails: true });
res = await scan();
check("unloggable scan refused", res.status, 503);
check("no OpenAI call when logging fails", calls.some(c => c.includes("openai")), false);

// 7. The 24h window is passed to Supabase.
mockFetch({ scanCount: 0 });
await scan();
const countCall = calls.find(c => c.includes("scan_events?select=id"));
check("count query filters by user", countCall.includes("user_id=eq.user-abc"), true);
check("count query filters by created_at", countCall.includes("created_at=gte."), true);

console.log(failed ? "\nFAILED" : "\nAll scan-limit checks passed");
process.exit(failed ? 1 : 0);
