// Past runs, kept in IndexedDB on this device.

import type { RunRecord } from "../lib/history";

type Props = {
  runs: RunRecord[];
  onRestore: (run: RunRecord) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
};

/** The methods a run covered, short enough for one line. */
function summarize(run: RunRecord): string {
  const labels = run.results.map((r) => r.label);
  if (labels.length <= 2) return labels.join(", ");
  return `${labels[0]}, ${labels[1]} +${labels.length - 2}`;
}

export function RunHistory({ runs, onRestore, onDelete, onClear }: Props) {
  if (runs.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No saved runs yet. Every run you make is kept here, on this device.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-500">
          {runs.length} run{runs.length === 1 ? "" : "s"} on this device
        </span>
        <button onClick={onClear} className="text-xs text-slate-400 underline hover:text-red-700">
          clear all
        </button>
      </div>

      <ul className="divide-y divide-slate-100">
        {runs.map((run) => (
          <li key={run.id} className="flex items-start gap-2 py-2">
            <button
              onClick={() => onRestore(run)}
              className="min-w-0 flex-1 text-left hover:bg-slate-50"
            >
              <p className="truncate text-xs font-medium text-slate-800">{summarize(run)}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {new Date(run.id).toLocaleString()} · {run.dataset} ·{" "}
                {run.elapsedSeconds.toFixed(2)}s
              </p>
            </button>
            <button
              onClick={() => onDelete(run.id)}
              aria-label="delete run"
              className="px-1 text-xs text-slate-300 hover:text-red-700"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
