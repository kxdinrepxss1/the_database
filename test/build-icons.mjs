// Renders the app icons from the mark already drawn in the header.
//
// The header logo is CSS: a hexagon clipped over a card and a banner. That
// cannot be exported, so this redraws the same shape as SVG and screenshots it
// at the sizes a browser asks for. Run it when the mark changes:
//
//   node test/build-icons.mjs
//
// It rewrites the ICONS block in worker/index.js with fresh base64 PNGs. The
// worker has no asset pipeline, so the bytes travel inline with the script.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Same lookup the browser suite uses: prefer a Chromium already on the machine
// over downloading one.
function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) return undefined;
  const exe = join(root, dir, "chrome-linux", "chrome");
  return existsSync(exe) ? exe : undefined;
}

const ACCENT = "#7dd3fc", DARK = "#0b0f0d", CREAM = "#f4f1e8";

// The mark, in the 38x42 box the CSS uses, so the two stay comparable.
const mark = `
  <clipPath id="hex">
    <path d="M19 0 L36.48 7.56 L36.48 30.24 L19 42 L1.52 30.24 L1.52 7.56 Z"/>
  </clipPath>
  <g clip-path="url(#hex)">
    <path d="M19 0 L36.48 7.56 L36.48 30.24 L19 42 L1.52 30.24 L1.52 7.56 Z" fill="${ACCENT}"/>
    <rect x="9" y="8" width="14" height="18" rx="2" fill="${DARK}" stroke="${CREAM}" stroke-width="2"/>
    <path d="M6 23 L11 23 L13.25 26.08 L23.75 26.08 L26 23 L31 23 L29.5 34 L7.5 34 Z" fill="${CREAM}"/>
    <rect x="15" y="29" width="8" height="3" fill="${ACCENT}"/>
  </g>`;

// A maskable icon is cropped to a circle on some launchers, so its mark has to
// sit inside the middle 80%. A plain icon can be bigger. Same drawing, two
// framings, rather than one compromise that looks small everywhere.
function icon(size, { maskable = false, rounded = true } = {}) {
  const height = size * (maskable ? 0.46 : 0.62);
  const width = height * (38 / 42);
  const x = (size - width) / 2, y = (size - height) / 2;
  const radius = rounded && !maskable ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${DARK}"/>
    <svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 38 42">${mark}</svg>
  </svg>`;
}

const wanted = [
  ["ICON_192", 192, {}],
  ["ICON_512", 512, {}],
  ["ICON_MASKABLE", 512, { maskable: true }],
  ["ICON_APPLE", 180, { rounded: false }],
  ["ICON_32", 32, { rounded: false }],
];

const browser = await chromium.launch({ executablePath: preinstalledChromium() });
const page = await browser.newPage();
const out = {};
for (const [name, size, options] of wanted) {
  const svg = icon(size, options);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0}</style>${svg}`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({ omitBackground: true });
  out[name] = png.toString("base64");
  console.log(`${name.padEnd(14)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
await browser.close();

// The favicon is served as SVG as well, which stays sharp at any size and
// costs a few hundred bytes rather than a few thousand.
out.ICON_SVG = Buffer.from(icon(512, { rounded: false })).toString("base64");

const block = "const ICONS = {\n" +
  Object.entries(out).map(([k, v]) => `  ${k}: "${v}",`).join("\n") +
  "\n};\n";

const path = new URL("../worker/index.js", import.meta.url);
const source = readFileSync(path, "utf8");
const replaced = source.replace(
  /const ICONS = \{[\s\S]*?\n\};\n/,
  block,
);
if (replaced === source) throw new Error("ICONS block not found in worker/index.js");
writeFileSync(path, replaced);
console.log(`\nWrote ${Object.keys(out).length} icons into worker/index.js`);
