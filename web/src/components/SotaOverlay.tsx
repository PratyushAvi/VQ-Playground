// Your results against the published vq-bench numbers.
//
// The comparison is only honest when the reference curve comes from a dataset
// resembling yours, so the dataset is chosen explicitly rather than guessed --
// and the caption says plainly that the two were measured on different vectors.

import { useEffect, useState } from "react";

import { Leaderboard } from "./Leaderboard";
import { TradeoffChart, type Series } from "./TradeoffChart";
import { loadSota, shortName, type Sota } from "../lib/sota";
import {
  DEFAULT_OVERLAY,
  loadOverlayPrefs,
  saveOverlayPrefs,
  type OverlayPrefs,
  type RunRecord,
} from "../lib/history";
import type { MethodResult } from "../lib/types";

type Props = {
  /** The rows currently in the results table. */
  results: MethodResult[];
  /** Which k the recall column reports; the reference curves are recall@10. */
  k?: number;
  /**
   * The benchmark dataset these results were produced on, when they were. The
   * overlay then defaults to *that* dataset's curves, which is the only
   * genuinely like-for-like comparison available.
   */
  benchmarkDataset?: string | null;
  /** Earlier runs on this same dataset, drawn faintly behind the current one. */
  history?: RunRecord[];
  /** Names this dataset in the history, so past runs on it can be found. */
  datasetLabel?: string;
  /** This run's own metrics, shown under the chart but not under the ranking,
   *  which already carries them alongside the published results. */
  metricsTable?: React.ReactNode;
  /** How many vectors this run scored, against the dataset's full size, so the
   *  ranking can say which rows are subsamples. */
  scale?: { sampled: number; total: number };
  /** Run the registered vq-bench quantizers on the reader's own vectors. */
  onRunBenchmarkMethods?: () => void;
  /** True while that is in flight. */
  runningBenchmarkMethods?: boolean;
  /** Whether those results are already in `results`. */
  benchmarkMethodsRun?: boolean;
  /** Shown in a grid cell rather than full width: shorter chart, tighter type. */
  compact?: boolean;
};

/** The family a method label names: `MinMax (b=4)` -> `MinMax`. */
function familyOf(label: string): string {
  return label.split(" (")[0];
}

/**
 * Merge past runs into one series per quantizer family, ordered by bit rate.
 * Points at the same bit rate keep the most recent, so re-running a setting
 * replaces its old value rather than doubling the line back on itself.
 */
function collectByFamily(
  past: { run: RunRecord; points: { bits: number; recall: number; label: string }[] }[],
): Series[] {
  const families = new Map<string, Map<number, { bits: number; recall: number; label: string }>>();
  // Oldest first, so a later run overwrites an earlier one at the same rate.
  for (const { points: rows } of [...past].reverse()) {
    for (const point of rows) {
      const family = familyOf(point.label);
      const byBits = families.get(family) ?? new Map();
      byBits.set(Number(point.bits.toFixed(4)), point);
      families.set(family, byBits);
    }
  }
  return [...families.entries()].map(([family, byBits]) => ({
    name: `${family} (earlier)`,
    points: [...byBits.values()].sort((a, b) => a.bits - b.bits),
    muted: true,
  }));
}

/** Pull `(bits, recall@k)` out of a result row, when it has both. */
function points(results: MethodResult[], k: number) {
  return results
    .map((row) => {
      const recall = (row.recall as Record<string, number> | undefined)?.[String(k)];
      return recall === undefined
        ? null
        : { bits: row.bits_per_dim, recall, label: row.label };
    })
    .filter((p): p is { bits: number; recall: number; label: string } => p !== null)
    .sort((a, b) => a.bits - b.bits);
}

export function SotaOverlay({
  results,
  k = 10,
  benchmarkDataset,
  history = [],
  datasetLabel,
  metricsTable,
  scale,
  onRunBenchmarkMethods,
  runningBenchmarkMethods = false,
  benchmarkMethodsRun = false,
  compact = false,
}: Props) {
  const [sota, setSota] = useState<Sota | null>(null);
  const [prefs, setPrefs] = useState<OverlayPrefs | null>(null);

  useEffect(() => {
    loadSota().then(setSota).catch(() => undefined);
    loadOverlayPrefs().then(setPrefs);
  }, []);

  // Persist as the reader changes it, so the overlay comes back configured.
  function update(change: Partial<OverlayPrefs>) {
    const next: OverlayPrefs = { ...(prefs ?? DEFAULT_OVERLAY), ...change };
    setPrefs(next);
    void saveOverlayPrefs(next);
  }

  const show = prefs?.show ?? true;
  const showHistory = prefs?.history ?? true;
  const view = prefs?.view ?? "chart";
  // A pinned dataset wins; otherwise follow the run's own, falling back to a
  // default only when the run came from vectors with no benchmark counterpart.
  const following = prefs?.dataset === null || prefs?.dataset === undefined;
  // The chart can honestly show your curve alone; a *ranking* of one row says
  // nothing, so the table falls back to a default dataset to rank against and
  // labels it as a different-vectors comparison.
  const fallback = view === "table" ? "arxiv-nomic-768-normalized" : null;
  const dataset = prefs?.dataset ?? benchmarkDataset ?? fallback;

  const mine = points(results, k);

  // Earlier runs on this same dataset. Only those with points to plot, and
  // never the current one -- it is drawn separately and emphasised.
  const past = datasetLabel
    ? history
        .filter((run) => run.dataset === datasetLabel)
        .map((run) => ({ run, points: points(run.results, k) }))
        .filter(({ points: p }) => p.length > 0)
        .slice(0, 40)
    : [];
  if (mine.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Run with <span className="font-mono">recall</span> in the metrics and{" "}
        <span className="font-mono">k</span> including {k} to plot against the benchmark.
      </p>
    );
  }

  const entry = dataset === null ? undefined : sota?.datasets[dataset];
  // Deliberately empty: the published curves were measured on the full base and
  // this run is a subsample, so drawing them together would compare unlike
  // things. Running those methods here instead (the button below) puts real,
  // comparable points on the chart; the published figures stay in the table as
  // a byline.
  const reference: Series[] = [];

  // Earlier runs are collapsed into one muted series per quantizer family
  // rather than one per run: sweeping `b` across several runs is the usual way
  // to explore, and each of those runs alone is a single point. Joined by
  // family they form the tradeoff curve the reader was actually building.
  const earlier: Series[] = showHistory ? collectByFamily(past) : [];

  return (
    <div>
      {onRunBenchmarkMethods && !benchmarkMethodsRun && (
        <button
          onClick={onRunBenchmarkMethods}
          disabled={runningBenchmarkMethods}
          className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-xs
                     font-medium text-slate-700 hover:border-slate-500 hover:text-slate-900
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningBenchmarkMethods
            ? "Running registered vq-bench quantizers…"
            : "Run registered vq-bench quantizers on this sub-sample"}
        </button>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md bg-slate-100 p-0.5">
          {(["chart", "table"] as const).map((option) => (
            <button
              key={option}
              onClick={() => update({ view: option })}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                view === option
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {sota && view === "table" && (
          <select
            value={following || dataset === null ? "" : dataset}
            onChange={(e) => update({ dataset: e.target.value === "" ? null : e.target.value })}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs
                       focus:border-slate-500 focus:outline-none"
          >
            <option value="">
              {benchmarkDataset
                ? `match the run (${shortName(benchmarkDataset, sota.datasets[benchmarkDataset]?.dim ?? 0)})`
                : "match the run — none published"}
            </option>
            {Object.entries(sota.datasets).map(([key, value]) => (
              <option key={key} value={key}>
                {shortName(key, value.dim)}
              </option>
            ))}
          </select>
        )}
        {past.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(e) => update({ history: e.target.checked })}
              className="rounded border-slate-300"
            />
            earlier runs ({past.length})
          </label>
        )}
        {show && following && benchmarkDataset && (
          <span className="text-xs text-slate-400">same vectors as the benchmark</span>
        )}
      </div>

      {view === "table" ? (
        <Leaderboard
          results={results}
          reference={show && entry ? Object.values(entry.curves).flat() : []}
          k={k}
          scale={scale}
          referenceScale={entry?.n_base}
        />
      ) : (
      <>
      {show && dataset === null && !compact && (
        <p className="mb-2 text-xs text-slate-500">
          These vectors have no published counterpart, so there is nothing to compare
          against by default. Pick a dataset above to plot its curves behind yours — the
          comparison then reads as shape against shape, not a like-for-like score.
        </p>
      )}

      <TradeoffChart
        series={[...reference, ...earlier, { name: "this run", points: mine, emphasis: true }]}
        caption={`recall@${k} against bits per dimension — up and to the left is better`}
        height={compact ? 230 : 340}
      />

          {metricsTable && (
            <div className="mt-5 border-t border-slate-100 pt-4">{metricsTable}</div>
          )}
      </>
      )}

      {show && entry && view === "chart" && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Reference curves are the published results on {shortName(dataset ?? "", entry.dim)} (
          {entry.n_base.toLocaleString()} vectors at {entry.dim}d).{" "}
          {compact ? null : benchmarkDataset === dataset ? (
            <>
              Your run sampled the same dataset, so the curves are directly comparable —
              though on a subsample, which usually reads a little higher than the full
              base.
            </>
          ) : (
            <>
              Your run used different vectors, so read the comparison as shape against
              shape — where your curve sits relative to the frontier — rather than as a
              like-for-like score.
            </>
          )}
        </p>
      )}
    </div>
  );
}
