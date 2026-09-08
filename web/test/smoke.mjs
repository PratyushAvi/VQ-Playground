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

await page.waitForFunction(() => document.querySelectorAll('input[type="checkbox"]').length > 5,
  null, { timeout: 20000 });
const rows = await page.locator('input[type="checkbox"]').count();
check("the sample and the benchmark datasets are listed together", rows === 11, `${rows} rows`);
const first = await page.locator("li").first().innerText();
check("the random point set is first", /random point set/.test(first), first.replace(/\s+/g, " "));

const families = await page.locator("select").first().locator("option").count();
check("registry populates the dropdown", families === 15, `${families} families`);

for (const { key, label, recall10 } of EXPECTED) {
  await page.selectOption("select", key);
  await page.waitForTimeout(200);

  // Switching families must clear the previous method's results.
  const stale = await page.locator("tbody tr").count();
  check(`${key}: previous results cleared`, stale === 0, `${stale} rows left over`);

  await page.getByRole("button", { name: /^Run on/ }).click();
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
await page.getByRole("button", { name: /^Run on/ }).click();
await page.waitForSelector("li.font-mono", { timeout: 60000 });
const message = await page.locator("li.font-mono").first().innerText();
check("invalid param reports vq-bench's reason", /b must be in 1..=8/.test(message), message);

// A sweep should produce one row per value.
await page.locator('input[inputmode="numeric"]').first().fill("2, 4, 6");
await page.getByRole("button", { name: /^Run on/ }).click();
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
await page.getByRole("button", { name: /^Run on/ }).click();
await page.waitForSelector('tbody tr:has-text("MinMax")', { timeout: 120000 });
await page.waitForSelector("text=/run.? on this device/", { timeout: 15000 });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("select", { timeout: 30000 });
const remembered = await page.locator("text=/run.? on this device/").count();
check("runs persist across a reload", remembered === 1, "history empty after reload");

// Both `.h5` layouts load, and a file with neither is refused clearly.
for (const [file, layout, truth] of [
  ["test/data/harness.h5", "harness", "from file"],
  ["test/data/vibe_no_neighbors.h5", "vibe", "brute-forced"],
]) {
  await page.getByRole("button", { name: /use your own/ }).click();
  await page.locator('input[type="file"]').setInputFiles(file);

  // The file joins the list unimported; importing is an explicit click, and
  // the row becomes tickable only once that succeeds.
  const row = page.locator("li").filter({ hasText: file.split("/").pop() }).first();
  await row.getByRole("button", { name: /^import$/ }).click();
  await page.waitForFunction(
    (name) => {
      const li = [...document.querySelectorAll("li")].find((n) => n.textContent?.includes(name));
      const box = li?.querySelector('input[type="checkbox"]');
      return box instanceof HTMLInputElement && !box.disabled;
    },
    file.split("/").pop(),
    { timeout: 300000 },
  );
  const summary = await row.innerText();
  check(
    `${layout} layout: imports, ground truth ${truth}`,
    summary.includes(truth),
    summary.replace(/\s+/g, " "),
  );

  // Only this dataset, so the run's results are unambiguous.
  await page.locator("li").first().locator('input[type="checkbox"]').uncheck();
  await page.getByRole("button", { name: /^Run on/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("table").length > 0,
    null, { timeout: 300000 });
  check(`${layout} layout: runs`, true, "");

  await row.locator('input[type="checkbox"]').uncheck();
  await page.locator("li").first().locator('input[type="checkbox"]').check();
}

await page.getByRole("button", { name: /use your own/ }).click();
await page.locator('input[type="file"]').setInputFiles("test/data/wrong.h5");
await page.locator("li").filter({ hasText: "wrong.h5" }).first()
  .getByRole("button", { name: /^import$/ }).click();
await page.waitForSelector("text=/unrecognized layout/", { timeout: 120000 });
check("an unrecognized layout is refused with a clear reason", true, "");
const badBox = page.locator("li").filter({ hasText: "wrong.h5" }).first()
  .locator('input[type="checkbox"]');
check("a dataset that failed to import stays unselectable", await badBox.isDisabled(), "it was tickable");

// --- Custom pipelines ---
// The sample dataset only, so the composed chain is compared against the
// built-in on identical vectors.
await page.locator("li").first().locator('input[type="checkbox"]').check();
await page.waitForTimeout(200);

await page.getByRole("button", { name: "Built-in" }).click();
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.getByRole("button", { name: /^Run on/ }).click();
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

await page.getByRole("button", { name: /^Run on/ }).click();
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
await page.getByRole("button", { name: /^Run on/ }).click();
await page.waitForSelector("li.font-mono", { timeout: 60000 });
const stageError = await page.locator("li.font-mono").first().innerText();
check(
  "a bad stage param names the stage and the reason",
  /stage 1/.test(stageError) && /b must be in 1\.\.=8/.test(stageError),
  stageError,
);

// --- The benchmark overlay ---
await page.getByRole("button", { name: "Built-in" }).click();
await page.selectOption("select", "minmax");
await page.waitForTimeout(200);
await page.locator('input[inputmode="numeric"]').first().fill("2, 4, 6");
await page.getByRole("button", { name: /^Run on/ }).click();
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, null, { timeout: 120000 });
// The overlay lives inside each dataset's own results panel now.
await page.waitForSelector("figure", { timeout: 20000 });

// Earlier runs in this suite are legitimately in the legend too, so assert on
// what must be there rather than an exact count.
const overlay = await page.locator("figure ul li").allInnerTexts();
check(
  "the overlay plots this run alongside earlier ones",
  overlay.some((t) => /this run/.test(t)) && overlay.some((t) => /earlier/.test(t)),
  overlay.join(", "),
);

// Both layers are optional; turning them off leaves only the current run.
// The labels name them, which is steadier than positional indexes.
await page.locator("label").filter({ hasText: "overlay published results" }).first()
  .locator("input").uncheck();
const earlierToggle = page.locator("label").filter({ hasText: "earlier runs" }).first();
if (await earlierToggle.count()) await earlierToggle.locator("input").uncheck();
await page.waitForTimeout(300);
const alone = await page.locator("figure ul li").allInnerTexts();
check("both overlay layers can be turned off", alone.length === 1, alone.join(", "));

// And the choice survives a reload, since it is stored per browser.
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll('input[type="checkbox"]').length > 5,
  null, { timeout: 30000 });
await page.getByRole("button", { name: /^Run on/ }).click();
await page.waitForSelector("figure", { timeout: 120000 });
const afterReload = await page.locator("figure ul li").allInnerTexts();
check(
  "the overlay setting persists across a reload",
  afterReload.length === 1,
  afterReload.join(", "),
);

check("no console or page errors", problems.length === 0, problems.join("; "));

await browser.close();

process.exit(failed === 0 ? 0 : 1);
