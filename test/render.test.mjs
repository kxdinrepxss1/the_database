// Syntax-checks the client-side script that the worker inlines into its HTML.
import worker from "../worker/index.js";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

const routes = ["/", "/collection", "/pricing", "/scan", "/account", "/reset-password"];
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
for (const [path, expect] of [["/manifest.webmanifest", 200], ["/sw.js", 200], ["/nope", 404]]) {
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

console.log(failed ? "\nFAILED" : "\nAll checks passed");
process.exit(failed ? 1 : 0);
