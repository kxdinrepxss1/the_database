// Builds the app icons from logo.png and writes them into worker/index.js.
//
//   node test/build-icons.mjs
//
// logo.png is the brand artwork as supplied: the DB mark above the wordmark,
// drawn in the lime this app used before the accent changed. Nothing here
// edits that file. Three things happen to it on the way to an icon.
//
// It is recoloured. The lime is replaced with the app accent, matched per
// pixel so antialiased edges stay clean rather than fringing.
//
// It is cropped, twice. The wordmark is dropped: "THE DATABASE" set under the
// mark is illegible at 32px and invisible at 16px, so it belongs to a header
// or a print sheet, not an icon. And below about 64px the two card outlines
// collapse into a smudge, so the favicon and browser tab are cropped tighter
// still, to the letters alone. Nobody sees the two crops side by side.
//
// It is placed on a plate, sized so a launcher cropping to a circle cannot
// clip the mark.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE = new URL("../logo.png", import.meta.url);
const LIME = [204, 248, 48];      // measured from the artwork
const ACCENT = [0x7d, 0xd3, 0xfc];
const INK = [0x0b, 0x0f, 0x0d];

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

const built = await page.evaluate(async ({ src, LIME, ACCENT, INK, sizes }) => {
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });

  const source = document.createElement("canvas");
  source.width = img.width; source.height = img.height;
  const sctx = source.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);

  // --- Recolour ------------------------------------------------------------
  const frame = sctx.getImageData(0, 0, source.width, source.height);
  const d = frame.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // Lime and cream both run high in green. What separates them is how little
    // blue lime carries, and that ratio holds through antialiasing, so partly
    // covered edge pixels are caught by the same test as solid ones.
    if (g > 24 && b / g < 0.62 && r / g < 0.93) {
      const t = Math.max(0, Math.min(1, (g - INK[1]) / (LIME[1] - INK[1])));
      d[i] = Math.round(INK[0] + t * (ACCENT[0] - INK[0]));
      d[i + 1] = Math.round(INK[1] + t * (ACCENT[1] - INK[1]));
      d[i + 2] = Math.round(INK[2] + t * (ACCENT[2] - INK[2]));
    }
  }

  // The artwork is flat colour carrying a faint grain, invisible to look at
  // but ruinous for PNG: every flat region becomes thousands of near-identical
  // colours and compresses to nothing. Snapping anything already close to one
  // of the three brand colours onto it exactly leaves edge pixels untouched
  // and takes the 512 icon from 152 KB to a fraction of that.
  const PALETTE = [INK, [0xf4, 0xf1, 0xe8], ACCENT];
  for (let i = 0; i < d.length; i += 4) {
    for (const p of PALETTE) {
      if (Math.abs(d[i] - p[0]) <= 20 && Math.abs(d[i + 1] - p[1]) <= 20
        && Math.abs(d[i + 2] - p[2]) <= 20) {
        d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
        break;
      }
    }
  }
  sctx.putImageData(frame, 0, 0);

  // --- Close the B ---------------------------------------------------------
  // The artwork draws the B with no left stem at all: both counters run open
  // into the gap beside the D. Measured across the letter, every row through a
  // counter carries accent only on the right-hand side. That is what makes it
  // read "D3" rather than "DB", and it does it at every size, worst at 32px.
  //
  // A stem the same weight as the letter's other strokes (~54px in this
  // artwork) closes both counters and leaves them 89px wide, matching the D's
  // counter. It sits inside the letter's existing left edge, so the chamfers
  // at the top and bottom corners survive untouched.
  sctx.fillStyle = `rgb(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]})`;
  sctx.fillRect(674, 384, 54, 691 - 384 + 1);

  // --- Find the mark, and the letters inside it ----------------------------
  const px = sctx.getImageData(0, 0, source.width, source.height).data;
  const ink = (x, y) => {
    const i = (y * source.width + x) * 4;
    return (px[i] + px[i + 1] + px[i + 2]) / 3 > 45 ? 1 : 0;
  };
  // Summed-area table, so the window test below is cheap.
  const W = source.width, H = source.height;
  const sum = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      sum[(y + 1) * (W + 1) + x + 1] =
        ink(x, y) + sum[y * (W + 1) + x + 1] + sum[(y + 1) * (W + 1) + x] - sum[y * (W + 1) + x];
  const windowFull = (x, y, r) => {
    const x0 = x - r, y0 = y - r, x1 = x + r + 1, y1 = y + r + 1;
    if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) return false;
    const area = (x1 - x0) * (y1 - y0);
    const s = sum[y1 * (W + 1) + x1] - sum[y0 * (W + 1) + x1]
      - sum[y1 * (W + 1) + x0] + sum[y0 * (W + 1) + x0];
    return s === area;
  };

  function bounds(test, yFrom, yTo) {
    let left = W, right = -1, top = H, bottom = -1;
    for (let y = yFrom; y <= yTo; y++)
      for (let x = 0; x < W; x++)
        if (test(x, y)) {
          if (x < left) left = x; if (x > right) right = x;
          if (y < top) top = y; if (y > bottom) bottom = y;
        }
    return { left, right, top, bottom };
  }

  // Rows of the page that carry content, so the wordmark can be told apart
  // from the mark by the gap between them rather than by a magic number.
  const bands = []; let start = null;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) n += ink(x, y);
    const on = n > 3;
    if (on && start === null) start = y;
    if (!on && start !== null) { if (y - start > 10) bands.push([start, y - 1]); start = null; }
  }
  if (start !== null && H - start > 10) bands.push([start, H - 1]);
  const [markTop, markBottom] = bands[0];

  const mark = bounds((x, y) => ink(x, y), markTop, markBottom);

  // The card outlines are thin strokes; the letters are solid fills. A window
  // too big to fit inside a stroke, but comfortable inside a letter, separates
  // them -- except at the rounded corners and chamfers, where two strokes meet
  // and the join is briefly thick enough to survive. Those survivors are small,
  // so grouping what is left into blobs and keeping only the substantial ones
  // leaves the letters and nothing else.
  const R = 15;
  const kept = new Uint8Array(W * H);
  for (let y = markTop; y <= markBottom; y++)
    for (let x = 0; x < W; x++)
      if (windowFull(x, y, R)) kept[y * W + x] = 1;

  const seen = new Uint8Array(W * H);
  const blobs = [];
  for (let y = markTop; y <= markBottom; y++) {
    for (let x = 0; x < W; x++) {
      const start = y * W + x;
      if (!kept[start] || seen[start]) continue;
      const stack = [start]; seen[start] = 1;
      let area = 0, left = W, right = -1, top = H, bottom = -1;
      while (stack.length) {
        const j = stack.pop(), jx = j % W, jy = (j / W) | 0;
        area++;
        if (jx < left) left = jx; if (jx > right) right = jx;
        if (jy < top) top = jy; if (jy > bottom) bottom = jy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (kept[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      blobs.push({ area, left, right, top, bottom });
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  const substantial = blobs.filter((b) => b.area >= blobs[0].area * 0.3);
  // Erosion pulled every edge in by R, so push the box back out by the same.
  const letters = {
    left: Math.min(...substantial.map((b) => b.left)) - R,
    right: Math.max(...substantial.map((b) => b.right)) + R,
    top: Math.min(...substantial.map((b) => b.top)) - R,
    bottom: Math.max(...substantial.map((b) => b.bottom)) + R,
  };

  // --- Compose -------------------------------------------------------------
  function compose(size, region, fill, rounded) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = `rgb(${INK[0]},${INK[1]},${INK[2]})`;
    if (rounded) {
      const r = size * 0.22;
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.arcTo(size, 0, size, size, r); ctx.arcTo(size, size, 0, size, r);
      ctx.arcTo(0, size, 0, 0, r); ctx.arcTo(0, 0, size, 0, r); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }
    const sw = region.right - region.left + 1, sh = region.bottom - region.top + 1;
    const scale = Math.min(size * fill / sw, size * fill / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, region.left, region.top, sw, sh,
      (size - dw) / 2, (size - dh) / 2, dw, dh);
    return c.toDataURL("image/png");
  }

  // The header sits on a translucent bar that the page scrolls behind, so the
  // mark there cannot carry its own background. Every pixel is a mix of the
  // artwork's near-black and one of the two brand colours; working out which,
  // and in what proportion, turns that mix back into a colour plus an alpha.
  function onTransparent(region, height) {
    const sw = region.right - region.left + 1, sh = region.bottom - region.top + 1;
    const c = document.createElement("canvas");
    c.height = height; c.width = Math.round(height * sw / sh);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, region.left, region.top, sw, sh, 0, 0, c.width, c.height);
    const f = ctx.getImageData(0, 0, c.width, c.height), q = f.data;
    const CREAM = [0xf4, 0xf1, 0xe8];
    for (let i = 0; i < q.length; i += 4) {
      let best = null;
      for (const C of [CREAM, ACCENT]) {
        const a = [0, 1, 2].map((k) => (q[i + k] - INK[k]) / (C[k] - INK[k]));
        const mean = (a[0] + a[1] + a[2]) / 3;
        // How well one alpha explains all three channels. The wrong colour
        // needs a different alpha per channel and loses.
        const spread = Math.max(...a.map((v) => Math.abs(v - mean)));
        if (!best || spread < best.spread) best = { C, mean, spread };
      }
      const alpha = Math.max(0, Math.min(1, best.mean));
      q[i] = best.C[0]; q[i + 1] = best.C[1]; q[i + 2] = best.C[2];
      q[i + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(f, 0, 0);
    return c.toDataURL("image/png").split(",")[1];
  }

  const out = {};
  for (const [name, size, opts] of sizes) {
    const region = opts.letters ? letters : mark;
    out[name] = compose(size, region, opts.fill, opts.rounded !== false).split(",")[1];
  }
  // The header mark, at three times the largest size it is drawn at so it
  // stays sharp on dense screens. The letters rather than the whole mark: the
  // header draws it at 26px, where the card outlines are a smudge, and the
  // wordmark sits right beside it so the cards have nothing left to say.
  // Passing `mark` here instead would use the full drawing.
  out.MARK_LETTERS = onTransparent(letters, 132);
  // The whole recoloured, corrected artwork, so the changes above exist as a
  // file somebody can open rather than only as pixels inside the Worker.
  return { out, mark, letters, bands, corrected: source.toDataURL("image/png") };
}, {
  src: "data:image/png;base64," + readFileSync(SOURCE).toString("base64"),
  LIME, ACCENT, INK,
  sizes: [
    ["ICON_192", 192, { fill: 0.70 }],
    ["ICON_512", 512, { fill: 0.70 }],
    // Cropped to a circle by some launchers, so the mark sits well inside.
    ["ICON_MASKABLE", 512, { fill: 0.52, rounded: false }],
    ["ICON_APPLE", 180, { fill: 0.70, rounded: false }],
    ["ICON_32", 32, { fill: 0.80, rounded: false, letters: true }],
    ["ICON_16", 16, { fill: 0.86, rounded: false, letters: true }],
  ],
});

await browser.close();

writeFileSync(new URL("../brand/logo-app.png", import.meta.url),
  Buffer.from(built.corrected.split(",")[1], "base64"));

console.log(`mark    x ${built.mark.left}-${built.mark.right}  y ${built.mark.top}-${built.mark.bottom}`);
console.log(`letters x ${built.letters.left}-${built.letters.right}  y ${built.letters.top}-${built.letters.bottom}`);
console.log(`content bands: ${built.bands.map(([a, b]) => `${a}-${b}`).join(", ")} (the second is the wordmark, dropped)\n`);
for (const [name, data] of Object.entries(built.out))
  console.log(`${name.padEnd(14)} ${(data.length * 0.75 / 1024).toFixed(1)} KB`);

// The SVG favicon slot takes a PNG data URI: the source is a raster, so there
// is no vector to serve, and a browser asking for image/svg+xml would get a
// file it cannot draw. Serve the letters PNG at /favicon.ico only.
const out = { ...built.out };

const block = "const ICONS = {\n"
  + Object.entries(out).map(([k, v]) => `  ${k}: "${v}",`).join("\n")
  + "\n};\n";

const target = new URL("../worker/index.js", import.meta.url);
const source = readFileSync(target, "utf8");
const replaced = source.replace(/const ICONS = \{[\s\S]*?\n\};\n/, block);
if (replaced === source) throw new Error("ICONS block not found in worker/index.js");
writeFileSync(target, replaced);
console.log(`\nWrote ${Object.keys(out).length} icons into worker/index.js`);
