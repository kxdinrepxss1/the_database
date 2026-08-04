// Duplicate detection and collection ordering.
import worker from "../worker/index.js";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" };
const html = await (await worker.fetch(new Request("https://x/collection"), env)).text();
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

const slice = (from, to) => {
  const i = script.indexOf(from), j = script.indexOf(to);
  if (i < 0 || j < 0) throw new Error(`could not locate ${from}`);
  return script.slice(i, j);
};

let failed = false;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// --- Duplicate detection ---
const dupSrc = slice("const duplicateKey", "function openAddCard");
const collection = [
  { id: "a", player: "Cody Bellinger", year: "2024", set: "Topps Five Star", parallel: "Orange Auto /5", grade: "Raw" },
  { id: "b", player: "Ben Rice", year: "2025", set: "Topps", parallel: "Base", grade: "PSA 9" },
];
const { findDuplicate } = new Function("cards", dupSrc + "; return {findDuplicate};")(collection);

check("exact match is caught",
  findDuplicate({ player: "Cody Bellinger", year: "2024", set: "Topps Five Star", parallel: "Orange Auto /5" })?.id, "a");
check("case and spacing differences still match",
  findDuplicate({ player: "  cody BELLINGER ", year: "2024", set: "topps five star", parallel: "Orange Auto /5" })?.id, "a");
check("a different parallel is not a duplicate",
  findDuplicate({ player: "Cody Bellinger", year: "2024", set: "Topps Five Star", parallel: "Base" }), null);
check("a different year is not a duplicate",
  findDuplicate({ player: "Cody Bellinger", year: "2023", set: "Topps Five Star", parallel: "Orange Auto /5" }), null);
check("a different set is not a duplicate",
  findDuplicate({ player: "Cody Bellinger", year: "2024", set: "Topps Chrome", parallel: "Orange Auto /5" }), null);
check("an unrelated player is not a duplicate",
  findDuplicate({ player: "Aaron Judge", year: "2024", set: "Topps Five Star", parallel: "Orange Auto /5" }), null);
// Grade is excluded on purpose: a raw copy and a graded copy are different things.
check("grade does not prevent a match",
  findDuplicate({ player: "Cody Bellinger", year: "2024", set: "Topps Five Star", parallel: "Orange Auto /5", grade: "PSA 10" })?.id, "a");
check("missing fields do not crash", findDuplicate({ player: "Nobody" }), null);

// The form must ask before saving a duplicate, and only for new cards.
check("guard runs for new cards only", script.includes("if(!editing&&!duplicateAccepted)"), true);
check("second press is allowed through", script.includes("duplicateAccepted=true"), true);
check("button becomes an explicit confirmation", script.includes("button.textContent='Add anyway'"), true);
check("warning markup exists", html.includes('id="duplicateWarning"'), true);

// --- Ordering ---
// "Recently added" previously sorted on a random UUID, so ordering was arbitrary.
const sortSrc = slice("if(sort==='Player A–Z')", "$('#count')");
const sortList = new Function("list", "sort", "cardPrice", "qty", sortSrc + "; return list;");
const cardPrice = (c) => (Number(c.currentValue) > 0 ? Number(c.currentValue) : null);
const qty = (c) => Math.max(1, Number(c.quantity) || 1);
const bySort = (list, sort) => sortList(list.slice(), sort, cardPrice, qty).map((c) => c.player);

const cardsByDate = [
  { id: "zzz", player: "Oldest", createdAt: "2026-07-01T10:00:00Z" },
  { id: "aaa", player: "Newest", createdAt: "2026-07-30T10:00:00Z" },
  { id: "mmm", player: "Middle", createdAt: "2026-07-15T10:00:00Z" },
];
check("recently added is newest first",
  bySort(cardsByDate, "Recently added"), ["Newest", "Middle", "Oldest"]);
check("player sort is alphabetical",
  bySort(cardsByDate, "Player A–Z"), ["Middle", "Newest", "Oldest"]);

// Cards predating the createdAt field must still sort deterministically.
const legacy = [
  { id: "111", player: "Legacy A" },
  { id: "333", player: "Legacy C" },
  { id: "222", player: "Legacy B" },
];
check("cards without a date fall back to id order",
  bySort(legacy, "Recently added"), ["Legacy C", "Legacy B", "Legacy A"]);

// The database creation time has to survive the trip into the client.
check("createdAt is read from the row", script.includes("createdAt:r.created_at||''"), true);
check("new cards get a creation time", script.includes("createdAt:editing?(c.createdAt||''):new Date().toISOString()"), true);

// --- Value sorting ---
// Sorts on the figure shown on the card, which is price times quantity.
const valued = [
  { id: "1", player: "Cheap", currentValue: 5, quantity: 1 },
  { id: "2", player: "Dear", currentValue: 500, quantity: 1 },
  { id: "3", player: "Middling", currentValue: 50, quantity: 1 },
  { id: "4", player: "Unpriced", quantity: 1 },
];
check("value high to low", bySort(valued, "Value high to low"),
  ["Dear", "Middling", "Cheap", "Unpriced"]);
check("value low to high", bySort(valued, "Value low to high"),
  ["Cheap", "Middling", "Dear", "Unpriced"]);
// Unpriced cards sink either way: a "low to high" list opening with everything
// unpriced answers nobody's question.
check("unpriced cards stay last in both directions",
  bySort(valued, "Value low to high").at(-1), "Unpriced");

// Per-card value, so a stack of cheap cards does not outrank a single dear one.
const stacks = [
  { id: "1", player: "One at fifty", currentValue: 50, quantity: 1 },
  { id: "2", player: "Ten at ten", currentValue: 10, quantity: 10 },
];
check("quantity does not inflate a card's position", bySort(stacks, "Value high to low"),
  ["One at fifty", "Ten at ten"]);

// Ties fall back to the player name so the order does not jump around.
const ties = [
  { id: "1", player: "Zeta", currentValue: 20, quantity: 1 },
  { id: "2", player: "Alpha", currentValue: 20, quantity: 1 },
];
check("equal values break the tie by name", bySort(ties, "Value high to low"),
  ["Alpha", "Zeta"]);
check("a collection with no prices still sorts",
  bySort([{ id: "1", player: "Beta" }, { id: "2", player: "Alpha" }], "Value high to low"),
  ["Alpha", "Beta"]);

// --- Currency formatting ---
// Negative amounts previously rendered as "$-500.00". Profit and growth both
// go negative in normal use, so this is visible whenever a collection dips.
const moneySrc = slice("const money =", "const CARD_COLORS");
const { money } = new Function(moneySrc + "; return {money};")();
check("positive amounts", money(1234.5), "$1,234.50");
check("zero", money(0), "$0.00");
check("negative amounts put the sign before the symbol", money(-500), "-$500.00");
check("small negatives", money(-0.25), "-$0.25");

console.log(failed ? "\nFAILED" : "\nAll collection checks passed");
process.exit(failed ? 1 : 0);
