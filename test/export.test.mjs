// Verifies the dependency-free ZIP writer used by the collection export.
// Structural checks only, so this runs anywhere Node does.
import worker from "../worker/index.js";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" };
const html = await (await worker.fetch(new Request("https://x/account"), env)).text();
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

// Pull the self-contained pieces out of the page and run them here.
const slice = (from, to) => {
  const a = script.indexOf(from);
  const b = script.indexOf(to);
  if (a < 0 || b < 0) throw new Error(`could not locate ${from}`);
  return script.slice(a, b);
};
const zipSrc = slice("const CRC_TABLE=", "async function photoBytes");
const csvSrc = slice("const csvCell", "async function exportCollection");
const { zipStore, crc32 } = new Function(zipSrc + "; return {zipStore, crc32};")();
const { csvCell } = new Function(csvSrc + "; return {csvCell};")();

let failed = false;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// CRC32 against the known check value for "123456789".
check("crc32 matches the standard check vector",
  crc32(new TextEncoder().encode("123456789")) >>> 0, 0xcbf43926);

// Build an archive containing text and binary-ish payloads.
const enc = new TextEncoder();
const jpegish = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 255, 128, 7, 0, 0xff, 0xd9]);
const entries = [
  { name: "collection.json", data: enc.encode(JSON.stringify({ cards: [{ player: "Aaron Judge" }] })) },
  { name: "README.txt", data: enc.encode("line one\r\nline two") },
  { name: "photos/abc-123-front.jpg", data: jpegish },
];
const bytes = new Uint8Array(await (await zipStore(entries)).arrayBuffer());

// --- Parse the archive back out, the way a real unzip would. ---
const dv = new DataView(bytes.buffer);
const eocd = bytes.length - 22;
check("end-of-central-directory signature", dv.getUint32(eocd, true), 0x06054b50);
check("entry count in EOCD", dv.getUint16(eocd + 10, true), entries.length);

const dirSize = dv.getUint32(eocd + 12, true);
const dirOffset = dv.getUint32(eocd + 16, true);
check("central directory is inside the file", dirOffset + dirSize <= eocd, true);

const dec = new TextDecoder();
let cursor = dirOffset;
const seen = [];
for (let i = 0; i < entries.length; i++) {
  check(`central header ${i} signature`, dv.getUint32(cursor, true), 0x02014b50);
  const nameLen = dv.getUint16(cursor + 28, true);
  const declaredCrc = dv.getUint32(cursor + 16, true);
  const size = dv.getUint32(cursor + 24, true);
  const localAt = dv.getUint32(cursor + 42, true);
  const name = dec.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

  // Follow the pointer into the local header and read the payload back.
  check(`local header for ${name}`, dv.getUint32(localAt, true), 0x04034b50);
  const localNameLen = dv.getUint16(localAt + 26, true);
  const extraLen = dv.getUint16(localAt + 28, true);
  const dataAt = localAt + 30 + localNameLen + extraLen;
  const payload = bytes.subarray(dataAt, dataAt + size);

  check(`${name} round-trips byte for byte`, Array.from(payload), Array.from(entries[i].data));
  check(`${name} crc is correct`, crc32(payload) >>> 0, declaredCrc >>> 0);
  check(`${name} stored uncompressed`, dv.getUint16(cursor + 10, true), 0);
  seen.push(name);
  cursor += 46 + nameLen + dv.getUint16(cursor + 30, true) + dv.getUint16(cursor + 32, true);
}
check("names preserved, including subdirectory", seen, entries.map((e) => e.name));

// Entries should carry a real date, not a placeholder epoch.
const dosDate = dv.getUint16(dirOffset + 14, true);
check("timestamps use the current year", ((dosDate >> 9) & 0x7f) + 1980, new Date().getFullYear());

// --- CSV quoting ---
check("plain value is quoted", csvCell("Aaron Judge"), '"Aaron Judge"');
check("embedded quote is doubled", csvCell('Mickey "Mick" Mantle'), '"Mickey ""Mick"" Mantle"');
check("comma is contained", csvCell("Binder 2, page 4"), '"Binder 2, page 4"');
check("newline is contained", csvCell("line one\nline two"), '"line one\nline two"');
check("null becomes empty", csvCell(null), '""');
check("zero is preserved", csvCell(0), '"0"');

// --- The export button must exist on the account page ---
check("export button rendered", html.includes('id="exportCollection"'), true);
check("export button wired", script.includes("$('#exportCollection').onclick=exportCollection"), true);

console.log(failed ? "\nFAILED" : "\nAll export checks passed");
process.exit(failed ? 1 : 0);
