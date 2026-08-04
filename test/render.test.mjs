// Syntax-checks the client-side script that the worker inlines into its HTML.
import worker from "../worker/index.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

const routes = ["/", "/collection", "/scan", "/account", "/reset-password"];
let failed = false;

for (const route of routes) {
  const res = await worker.fetch(new Request("https://x" + route), env);
  if (res.status !== 200) {
    console.log(`FAIL ${route}: status ${res.status}`);
    failed = true;
    continue;
  }
  const html = await res.text();
  const start = html.lastIndexOf("<script>");
  const end = html.lastIndexOf("</script>");
  const body = html.slice(start + 8, end);
  try {
    new Function(body);
  } catch (e) {
    console.log(`FAIL ${route}: client script syntax error: ${e.message}`);
    failed = true;
    continue;
  }
  console.log(`ok   ${route}  (${html.length} bytes, script ${body.length} bytes)`);
}

// Non-page routes
// /pricing was replaced by inline pricing; keep it pointing somewhere useful
// for anyone holding a bookmark or a cached service-worker entry.
for (const [path, expect] of [["/manifest.webmanifest", 200], ["/sw.js", 200], ["/nope", 404], ["/pricing", 302]]) {
  const res = await worker.fetch(new Request("https://x" + path), env);
  const label = res.status === expect ? "ok  " : "FAIL";
  if (res.status !== expect) failed = true;
  console.log(`${label} ${path}  (${res.status})`);
}

// Service worker script syntax
const sw = await (await worker.fetch(new Request("https://x/sw.js"), env)).text();
try {
  new Function(sw);
  console.log("ok   /sw.js script parses");
} catch (e) {
  console.log(`FAIL /sw.js syntax: ${e.message}`);
  failed = true;
}

// Scan endpoint guards
const noKey = await worker.fetch(
  new Request("https://x/api/scan-card", { method: "POST", body: "{}" }), env);
console.log(`${noKey.status === 503 ? "ok  " : "FAIL"} /api/scan-card without OPENAI_API_KEY -> ${noKey.status}`);
if (noKey.status !== 503) failed = true;

const noAuth = await worker.fetch(
  new Request("https://x/api/scan-card", { method: "POST", body: "{}" }),
  { ...env, OPENAI_API_KEY: "sk-test" });
console.log(`${noAuth.status === 401 ? "ok  " : "FAIL"} /api/scan-card without auth -> ${noAuth.status}`);
if (noAuth.status !== 401) failed = true;

// Photo capture: the scan page must work with and without OpenAI credits.
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const scanPage = async (extraEnv) =>
  (await worker.fetch(new Request("https://x/scan"), { ...env, ...extraEnv })).text();

const withoutAi = await scanPage({});
const withAi = await scanPage({ OPENAI_API_KEY: "sk-test" });

check("SCAN_AI is false without a key", withoutAi.includes("SCAN_AI=false"), true);
check("SCAN_AI is true with a key", withAi.includes("SCAN_AI=true"), true);

// capture="environment" forces the camera and hides the photo library on phones.
for (const [label, html] of [["without AI", withoutAi], ["with AI", withAi]]) {
  check(`no capture attribute ${label}`, /capture=/.test(html), false);
  check(`file inputs accept images ${label}`, (html.match(/type="file" accept="image\/\*"/g) || []).length, 4);
}

// Copy should not promise recognition the deployment cannot perform.
check("no scanner promise without a key", /suggests the card details/.test(withoutAi), false);
check("scanner promise present with a key", /suggests the card details/.test(withAi), true);
check("offers photos you already took", /photos you already took/.test(withoutAi), true);

// The manual path must survive the AI button not being rendered.
for (const [label, html] of [["without AI", withoutAi], ["with AI", withAi]]) {
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  check(`analyzeCard is guarded ${label}`, script.includes("if(analyze)analyze.onclick"), true);
  check(`manualScan always rendered ${label}`, script.includes('id="manualScan"'), true);
}

// Accent colour lives in one variable; nothing should hardcode the old lime.
check("accent variable defined once", (withoutAi.match(/--accent:#7dd3fc/g) || []).length, 1);
check("no stale lime variable", /--lime/.test(withoutAi), false);
check("no stale lime hex", /caff3d/i.test(withoutAi), false);
check("accent used via the variable", withoutAi.includes("var(--accent)"), true);

console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
