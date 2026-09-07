// Browser smoke test for the playground. Drives the real UI in Chromium and
// checks the numbers against what Phase 0 verified against the native CLI.
//
//   npm run dev     # in one terminal
//   npm run smoke   # in another

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

// The .h5 fixtures are generated, not tracked.
const here = dirname(fileURLToPath(import.meta.url));
if (!existsSync(join(here, "data/harness.h5"))) {
  execFileSync("python3", [join(here, "data/make.py")], { stdio: "inherit" });
}

const URL = process.env.PLAYGROUND_URL ?? "http://localhost:5173/";

// Recall values pinned in Phase 0: browser wasm must agree with native `vqb`.
const EXPECTED = [
  { key: "minmax", label: "MinMax", recall10: 0.694 },
  { key: "e_rabitq", label: "E-RaBitQ", recall10: 0.796 },
  { key: "pq", label: "PQ", recall10: 0.378 },
];

let failed = 0;
function check(what, ok, detail) {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : ` -- ${detail}`}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("select", { timeout: 30000 });

const families = await page.locator("select").first().locator("option").count();
check("registry populates the dropdown", families === 15, `${families} families`);

for (const { key, label, recall10 } of EXPECTED) {
  await page.selectOption("select", key);
  await page.waitForTimeout(200);

  // Switching families must clear the previous method's results.
  const stale = await page.locator("tbody tr").count();
  check(`${key}: previous results cleared`, stale === 0, `${stale} rows left over`);

  await page.getByRole("button", { name: /^run$/i }).click();
  await page.waitForSelector(`tbody tr:has-text("${label}")`, { timeout: 180000 });

  const cells = await page.locator("tbody tr").first().locator("td").allInnerTexts();
  const actual = Number(cells.at(-1));
  check(`${key}: recall@10 matches native`, Math.abs(actual - recall10) < 1e-9,
    `got ${actual}, expected ${recall10}`);
}

// A rejected param must surface vq-bench's own message, not a crash.
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.locator('input[inputmode="numeric"]').first().fill("99");
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForSelector("text=/Config rejected/", { timeout: 60000 });
const message = await page.locator("li.font-mono").first().innerText();
check("invalid param reports vq-bench's reason", /b must be in 1..=8/.test(message), message);

// A sweep should produce one row per value.
await page.locator('input[inputmode="numeric"]').first().fill("2, 4, 6");
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3,
  null, { timeout: 120000 });
check("a swept param runs once per value", true, "3 rows");

// The page must never scroll sideways, however wide the table gets.
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("page does not overflow horizontally", overflow <= 0, `${overflow}px`);

// --- Phase 2: the editor, local files, and stored runs ---

check("config editor is present", await page.locator(".cm-content").count() === 1, "no editor");

// A run must be remembered, and survive a reload.
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForSelector('tbody tr:has-text("MinMax")', { timeout: 120000 });
await page.waitForSelector("text=/run.? on this device/", { timeout: 15000 });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("select", { timeout: 30000 });
const remembered = await page.locator("text=/run.? on this device/").count();
check("runs persist across a reload", remembered === 1, "history empty after reload");

// Both `.h5` layouts load, and a file with neither is refused clearly.
for (const [file, layout, truth] of [
  ["test/data/harness.h5", "harness layout", "from file"],
  ["test/data/vibe_no_neighbors.h5", "vibe layout", "brute-forced"],
]) {
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForSelector(`text=/${layout}/`, { timeout: 180000 });
  const summary = await page.locator(`text=/${layout}/`).locator("..").innerText();
  check(`${layout} detected, ground truth ${truth}`, summary.includes(truth), summary);

  await page.getByRole("button", { name: /^run$/i }).click();
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0,
    null, { timeout: 180000 });
  check(`${layout}: runs`, true, "");
}

await page.locator('input[type="file"]').setInputFiles("test/data/wrong.h5");
await page.waitForSelector("text=/unrecognized layout/", { timeout: 60000 });
check("an unrecognized layout is refused with a clear reason", true, "");

check("no console or page errors", problems.length === 0, problems.join("; "));

await browser.close();

process.exit(failed === 0 ? 0 : 1);
