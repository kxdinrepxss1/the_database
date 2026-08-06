// Renders the app icons from the DB mark, and writes them into worker/index.js.
//
//   node test/build-icons.mjs
//
// Two marks, deliberately. The full one -- two overlapping cards behind the
// letters -- carries the detail that makes the logo the logo, and it holds up
// from about 64px. Below that the card outlines collapse into a smudge, so the
// favicon uses the letters alone. Nobody ever sees the two side by side, and
// the alternative is a browser tab showing grey mush.
//
// This is a vector reconstruction of the supplied artwork, not the original
// file. Replace the paths below when the source arrives; nothing else needs to
// change, and re-running this picks it up everywhere.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BLUE = "#7dd3fc", CREAM = "#f4f1e8", INK = "#0b0f0d";

// A card with two opposite corners chamfered and the other two rounded.
const card = (x, y, w, h, r, c) =>
  `M ${x + r} ${y} H ${x + w - c} L ${x + w} ${y + c} V ${y + h - r} `
  + `A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + c} L ${x} ${y + h - c} `
  + `V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;

const LETTER_D = `M 12.7 29.4 H 41 L 49.7 38 V 72.8 L 41 81.4 H 12.7 Z
                  M 24.5 40.8 H 35 L 38 43.8 V 67 L 35 70 H 24.5 Z`;
const LETTER_B = `M 50 29.4 H 80 L 88.9 38 V 48.5 L 84.2 55.4 L 88.9 62.3 V 72.8 L 80 81.4 H 50 Z
                  M 61 39.6 H 75.5 L 78.2 42.3 V 47.6 L 75.5 50.3 H 61 Z
                  M 61 60.5 H 75.5 L 78.2 63.2 V 68.5 L 75.5 71.2 H 61 Z`;

const letters = `<path fill="${CREAM}" fill-rule="evenodd" d="${LETTER_D}"/>
  <path fill="${BLUE}" fill-rule="evenodd" d="${LETTER_B}"/>`;

const MARKS = {
  // viewBox chosen to include the stroke, which sits half outside the path.
  full: { box: "-3 -3 106 111", ratio: 106 / 111, art: `
    <path d="${card(23, 0, 77, 96, 5, 14)}" fill="none" stroke="${BLUE}"
          stroke-width="3.6" stroke-linejoin="round"/>
    <path d="${card(0, 11.5, 69, 93, 5, 14)}" fill="${INK}" stroke="${CREAM}"
          stroke-width="3.6" stroke-linejoin="round"/>
    ${letters}` },
  letters: { box: "10 27 81 56", ratio: 81 / 56, art: letters },
};

function icon(size, { mark = "full", maskable = false, rounded = true, scale = null } = {}) {
  const { box, ratio, art } = MARKS[mark];
  // A maskable icon may be cropped to a circle, so its mark sits smaller.
  const fill = scale ?? (maskable ? 0.46 : 0.64);
  const height = ratio >= 1 ? size * fill / ratio : size * fill;
  const width = height * ratio;
  const radius = rounded && !maskable ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${radius.toFixed(1)}" fill="${INK}"/>`
    + `<svg x="${((size - width) / 2).toFixed(2)}" y="${((size - height) / 2).toFixed(2)}"`
    + ` width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${box}">${art}</svg>`
    + `</svg>`;
}

const wanted = [
  ["ICON_192", 192, {}],
  ["ICON_512", 512, {}],
  ["ICON_MASKABLE", 512, { maskable: true }],
  ["ICON_APPLE", 180, { rounded: false }],
  // Letters only below here: the cards do not survive the size.
  ["ICON_32", 32, { mark: "letters", rounded: false, scale: 0.78 }],
];

function preinstalledChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) return undefined;
  const exe = join(root, dir, "chrome-linux", "chrome");
  return existsSync(exe) ? exe : undefined;
}

const browser = await chromium.launch({ executablePath: preinstalledChromium() });
const page = await browser.newPage();
const out = {};
for (const [name, size, options] of wanted) {
  const svg = icon(size, options);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;padding:0}</style>${svg}`, { waitUntil: "load" });
  const png = await page.screenshot({ omitBackground: true });
  out[name] = png.toString("base64");
  console.log(`${name.padEnd(14)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`
    + `  ${options.mark === "letters" ? "letters" : "full mark"}`);
}
await browser.close();

// The SVG favicon is what a modern browser puts in the tab, so it is the
// letters too, and it stays sharp at any size for a few hundred bytes.
out.ICON_SVG = Buffer.from(
  icon(512, { mark: "letters", rounded: false, scale: 0.78 }),
).toString("base64");

const block = "const ICONS = {\n"
  + Object.entries(out).map(([k, v]) => `  ${k}: "${v}",`).join("\n")
  + "\n};\n";

const path = new URL("../worker/index.js", import.meta.url);
const source = readFileSync(path, "utf8");
const replaced = source.replace(/const ICONS = \{[\s\S]*?\n\};\n/, block);
if (replaced === source) throw new Error("ICONS block not found in worker/index.js");
writeFileSync(path, replaced);
console.log(`\nWrote ${Object.keys(out).length} icons into worker/index.js`);
