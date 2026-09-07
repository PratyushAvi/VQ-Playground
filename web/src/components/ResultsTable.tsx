// The results table.
//
// Metric values arrive in three shapes -- plain numbers (`mse_score`), nested
// by k (`recall`), nested by temperature (`kl`) -- so columns are discovered
// from the results rather than declared up front. That way a metric added
// upstream renders without a change here.

import type { MethodResult } from "../lib/types";

type Column = { key: string; label: string; read: (row: MethodResult) => number | undefined };

/** Flatten one method's metrics into `name` / `name@k` columns. */
function columnsFor(results: MethodResult[]): Column[] {
  const columns = new Map<string, Column>();

  for (const row of results) {
    for (const [name, value] of Object.entries(row)) {
      if (name === "label") continue;

      if (typeof value === "number") {
        columns.set(name, { key: name, label: name, read: (r) => r[name] as number });
        continue;
      }
      if (value && typeof value === "object") {
        for (const inner of Object.keys(value as Record<string, unknown>)) {
          const nested = (value as Record<string, unknown>)[inner];
          // `exp_sos` nests twice (temperature, then k); show its leaves.
          if (nested && typeof nested === "object") {
            for (const leaf of Object.keys(nested as Record<string, unknown>)) {
              const key = `${name}@${inner}/${leaf}`;
              columns.set(key, {
                key,
                label: key,
                read: (r) =>
                  ((r[name] as Record<string, Record<string, number>>)?.[inner]?.[leaf]),
              });
            }
            continue;
          }
          const key = `${name}@${inner}`;
          columns.set(key, {
            key,
            label: key,
            read: (r) => (r[name] as Record<string, number>)?.[inner],
          });
        }
      }
    }
  }

  // bits_per_dim first -- it is the cost axis every other number trades against.
  const ordered = [...columns.values()];
  ordered.sort((a, b) => {
    if (a.key === "bits_per_dim") return -1;
    if (b.key === "bits_per_dim") return 1;
    return a.key.localeCompare(b.key);
  });
  return ordered;
}

/** Recall-style ratios read better as percentages; errors need exponents. */
function format(key: string, value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "--";
  if (key.startsWith("recall") || key.startsWith("sos")) return value.toFixed(3);
  if (key === "bits_per_dim") return value.toFixed(2);
  if (value !== 0 && Math.abs(value) < 1e-3) return value.toExponential(2);
  return value.toPrecision(4);
}

export function ResultsTable({ results }: { results: MethodResult[] }) {
  const columns = columnsFor(results);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left">
            <th className="py-2 pr-6 font-medium text-slate-700">method</th>
            {columns.map((c) => (
              <th key={c.key} className="py-2 pr-4 text-right font-medium text-slate-700">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((row) => (
            <tr key={row.label} className="border-b border-slate-100 last:border-0">
              <td className="min-w-48 py-2 pr-6 font-medium text-slate-900">
                {row.label}
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="py-2 pr-4 text-right tabular-nums text-slate-600"
                >
                  {format(c.key, c.read(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
