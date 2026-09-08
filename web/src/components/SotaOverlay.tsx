// Your results against the published vq-bench numbers.
//
// The comparison is only honest when the reference curve comes from a dataset
// resembling yours, so the dataset is chosen explicitly rather than guessed --
// and the caption says plainly that the two were measured on different vectors.

import { useEffect, useState } from "react";

import { TradeoffChart, type Series } from "./TradeoffChart";
import { loadSota, shortName, type Sota } from "../lib/sota";
import type { MethodResult } from "../lib/types";

type Props = {
  /** The rows currently in the results table. */
  results: MethodResult[];
  /** Which k the recall column reports; the reference curves are recall@10. */
  k?: number;
};

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

export function SotaOverlay({ results, k = 10 }: Props) {
  const [sota, setSota] = useState<Sota | null>(null);
  const [dataset, setDataset] = useState("arxiv-nomic-768-normalized");
  const [show, setShow] = useState(true);

  useEffect(() => {
    loadSota().then(setSota).catch(() => undefined);
  }, []);

  const mine = points(results, k);
  if (mine.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        Run with <span className="font-mono">recall</span> in the metrics and{" "}
        <span className="font-mono">k</span> including {k} to plot against the benchmark.
      </p>
    );
  }

  const entry = sota?.datasets[dataset];
  const reference: Series[] =
    show && entry
      ? Object.entries(entry.curves).map(([name, curve]) => ({
          name,
          points: curve.map((p) => ({ bits: p.bits, recall: p.recall, label: p.label })),
        }))
      : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
            className="rounded border-slate-300"
          />
          overlay published results
        </label>
        {show && sota && (
          <select
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs
                       focus:border-slate-500 focus:outline-none"
          >
            {Object.entries(sota.datasets).map(([key, value]) => (
              <option key={key} value={key}>
                {shortName(key, value.dim)}
              </option>
            ))}
          </select>
        )}
      </div>

      <TradeoffChart
        series={[...reference, { name: "your run", points: mine, emphasis: true }]}
        caption={`recall@${k} against bits per dimension — up and to the left is better`}
        height={280}
      />

      {show && entry && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Reference curves are the published results on{" "}
          {shortName(dataset, entry.dim)} ({entry.n_base.toLocaleString()} vectors at{" "}
          {entry.dim}d). Your run used different vectors, so read the comparison as
          shape against shape — where your curve sits relative to the frontier — rather
          than as a like-for-like score.
        </p>
      )}
    </div>
  );
}
