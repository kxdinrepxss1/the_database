// Verifies the client error reporter stays bounded and never becomes a
// problem of its own.
import worker from "../worker/index.js";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" };
const html = await (await worker.fetch(new Request("https://x/"), env)).text();
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

const a = script.indexOf("const ERROR_REPORT_LIMIT");
const b = script.indexOf("async function sb(");
if (a < 0 || b < 0) throw new Error("could not locate the error reporter");
const src = script.slice(a, b);

// Build a fresh reporter with stubbed surroundings for each scenario.
function makeReporter({ signedIn = true, fetchImpl } = {}) {
  const calls = [];
  const session = signedIn ? { user: { id: "user-1", email: "a@b.c" }, access_token: "tok" } : null;
  const fetchStub = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    if (fetchImpl) return fetchImpl();
    return new Response("", { status: 201 });
  };
  const factory = new Function(
    "session", "SUPABASE_URL", "SUPABASE_KEY", "APP_VERSION", "navigator", "fetch", "authHeaders",
    src + "; return reportError;"
  );
  const reportError = factory(
    session, env.SUPABASE_URL, "k", "v11", { userAgent: "TestBrowser/1.0" }, fetchStub,
    () => ({ apikey: "k", Authorization: "Bearer tok" })
  );
  return { reportError, calls };
}

let failed = false;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// Signed out: nothing is sent. RLS would reject it anyway.
{
  const { reportError, calls } = makeReporter({ signedIn: false });
  await reportError("sync-init", new Error("boom"));
  check("signed out sends nothing", calls.length, 0);
}

// Signed in: one report, addressed correctly, carrying the build.
{
  const { reportError, calls } = makeReporter();
  await reportError("sync-init", new Error("network down"));
  check("signed in sends one report", calls.length, 1);
  check("posts to error_events", calls[0].url, `${env.SUPABASE_URL}/rest/v1/error_events`);
  check("records the context", calls[0].body.context, "sync-init");
  check("records the message", calls[0].body.message, "network down");
  check("records the user", calls[0].body.user_id, "user-1");
  check("records the build", calls[0].body.app_version, "v11");
  check("records the browser", calls[0].body.user_agent, "TestBrowser/1.0");
  // Only these fields: no card data, no photos, no prices.
  check("sends nothing beyond the error itself", Object.keys(calls[0].body).sort(),
    ["app_version", "context", "detail", "message", "user_agent", "user_id"]);
}

// The same failure repeating does not report repeatedly.
{
  const { reportError, calls } = makeReporter();
  for (let i = 0; i < 5; i++) await reportError("card-save", new Error("same failure"));
  check("identical errors are reported once", calls.length, 1);
}

// Distinct failures are each worth knowing about.
{
  const { reportError, calls } = makeReporter();
  await reportError("card-save", new Error("first"));
  await reportError("card-save", new Error("second"));
  await reportError("export", new Error("first"));
  check("distinct errors are reported separately", calls.length, 3);
}

// A failure loop cannot flood the table.
{
  const { reportError, calls } = makeReporter();
  for (let i = 0; i < 50; i++) await reportError("window", new Error("loop " + i));
  check("reporting is capped", calls.length, 10);
}

// If reporting itself fails, that must stay invisible to the user.
{
  const { reportError } = makeReporter({ fetchImpl: () => { throw new Error("supabase unreachable"); } });
  let threw = false;
  try { await reportError("window", new Error("original problem")); } catch (e) { threw = true; }
  check("a failing report never throws", threw, false);
}

// Oversized payloads are truncated rather than sent whole.
{
  const { reportError, calls } = makeReporter();
  const big = new Error("x".repeat(5000));
  big.stack = "y".repeat(9000);
  await reportError("window", big);
  check("message is bounded", calls[0].body.message.length, 500);
  check("detail is bounded", calls[0].body.detail.length, 2000);
}

// Non-Error values (common from unhandledrejection) still report.
{
  const { reportError, calls } = makeReporter();
  await reportError("promise", "a bare string rejection");
  check("string rejections report", calls[0].body.message, "a bare string rejection");
}

// Empty or absent errors are not worth a row.
{
  const { reportError, calls } = makeReporter();
  await reportError("window", undefined);
  await reportError("window", "");
  check("empty errors are ignored", calls.length, 0);
}

// The global handlers must be attached.
check("window errors are captured",
  script.includes("window.addEventListener('error',e=>reportError('window',e.error||e.message))"), true);
check("promise rejections are captured",
  script.includes("window.addEventListener('unhandledrejection',e=>reportError('promise',e.reason))"), true);

console.log(failed ? "\nFAILED" : "\nAll error-reporting checks passed");
process.exit(failed ? 1 : 0);
