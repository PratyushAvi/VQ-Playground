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

// --- Landing page ---
await page.waitForSelector("svg[role=img]", { timeout: 30000 });
const landingSeries = await page.locator("figure ul li").allInnerTexts();
check("landing plots the published results", landingSeries.length === 5, landingSeries.join(", "));
check(
  "nav links out to the project",
  (await page.locator('a[href="https://www.vq-bench.com"]').count()) > 0 &&
    (await page.locator('a[href="https://github.com/pinecone-io/vq-bench"]').count()) > 0,
  "missing external links",
);

await page.getByRole("button", { name: "Open the playground" }).click();
await page.waitForSelector("select", { timeout: 30000 });
check("the playground opens", (await page.evaluate(() => location.hash)) === "#playground", "wrong hash");

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

// --- Custom pipelines ---
// Back to the sample dataset, so the composed chain is compared against the
// built-in on identical vectors.
await page.locator("text=/back to the sample dataset/").click();
await page.waitForTimeout(200);

await page.getByRole("button", { name: "Built-in" }).click();
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForSelector('tbody tr:has-text("MinMax (b=4)")', { timeout: 120000 });
const builtinRow = await page.locator("tbody tr").first().innerText();

// The same quantizer, composed by hand from primitives.
await page.getByRole("button", { name: "Compose" }).click();
await page.waitForSelector("text=/An empty pipeline/", { timeout: 10000 });
await page.locator("select").last().selectOption("minmax");
await page.waitForTimeout(150);
await page.locator("select").last().selectOption("cast_uint");
await page.waitForTimeout(200);
check("stages can be added", await page.locator("ol li").count() === 2, "expected 2 stages");

await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForSelector('tbody tr:has-text("custom")', { timeout: 120000 });
const composedRow = await page.locator("tbody tr").first().innerText();

// Same numbers, different label: proof the chain runs vq-bench's own stages.
const numbers = (row) => row.replace(/\s+/g, " ").trim().split(" ").filter((t) => /^[\d.e-]+$/.test(t));
check(
  "a composed pipeline reproduces the built-in exactly",
  numbers(builtinRow).join() === numbers(composedRow).join(),
  `built-in ${numbers(builtinRow).join()} vs composed ${numbers(composedRow).join()}`,
);

// A bad stage param is refused, in vq-bench's own words. (Dim compatibility is
// all `Pipeline::new` checks -- a chain with no rounder, or two, is unusual but
// genuinely runnable, so the UI hints rather than blocking.)
const bits = page.locator("ol li").last().locator("input");
await bits.fill("99");
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForSelector("text=/Config rejected/", { timeout: 60000 });
const stageError = await page.locator("li.font-mono").first().innerText();
check(
  "a bad stage param names the stage and the reason",
  /stage 1/.test(stageError) && /b must be in 1\.\.=8/.test(stageError),
  stageError,
);

// --- The benchmark overlay ---
await page.locator("text=/back to the sample dataset/").click().catch(() => {});
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Built-in" }).click();
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.locator('input[inputmode="numeric"]').first().fill("2, 4, 6");
await page.getByRole("button", { name: /^run$/i }).click();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, null, { timeout: 120000 });
await page.waitForSelector("text=/Against the benchmark/", { timeout: 20000 });

const overlay = await page.locator("figure ul li").allInnerTexts();
check(
  "the overlay plots your run against the published curves",
  overlay.length === 6 && overlay.some((t) => /your run/.test(t)),
  overlay.join(", "),
);

// The overlay must be optional: unchecking leaves only the reader's own curve.
await page.locator('input[type="checkbox"]').first().uncheck();
await page.waitForTimeout(200);
const alone = await page.locator("figure ul li").allInnerTexts();
check("the overlay can be turned off", alone.length === 1, alone.join(", "));

check("no console or page errors", problems.length === 0, problems.join("; "));

await browser.close();

process.exit(failed === 0 ? 0 : 1);
