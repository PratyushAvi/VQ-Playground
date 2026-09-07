// The Phase 1 playground: pick a quantizer, set its params, run it on the
// bundled sample dataset, read the scores. Everything runs locally -- the wasm
// module and the dataset are both served from this origin.

import { useCallback, useEffect, useMemo, useState } from "react";

import { MethodPicker } from "./components/MethodPicker";
import { ResultsTable } from "./components/ResultsTable";
import { SAMPLE_DATASET, loadSampleDataset } from "./lib/dataset";
import { defaultValue, toConfigValue } from "./lib/params";
import { runner } from "./lib/runner";
import type { Dataset, MethodResult, Quantizer } from "./lib/types";

/** Metrics Phase 1 reports. Kept short so the table stays readable. */
const METRICS = ["recall", "mse_score", "mse_recon"];
const K_VALUES = [1, 10];
const SEED = 1;

export default function App() {
  const [quantizers, setQuantizers] = useState<Quantizer[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [selected, setSelected] = useState("minmax");
  const [params, setParams] = useState<Record<string, string>>({});
  const [results, setResults] = useState<MethodResult[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  // Load the registry and the sample dataset once, in parallel.
  useEffect(() => {
    let cancelled = false;
    Promise.all([runner().listQuantizers(), loadSampleDataset()])
      .then(([families, data]) => {
        if (cancelled) return;
        setQuantizers(families);
        setDataset(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors([`startup failed: ${String(err)}`]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset params to the family's defaults whenever the selection changes, and
  // drop the previous results -- they describe the old quantizer, so leaving
  // them up would label another method's numbers with this one's name.
  useEffect(() => {
    const family = quantizers.find((q) => q.key === selected);
    if (!family) return;
    setParams(Object.fromEntries(family.params.map((p) => [p, defaultValue(p)])));
    setResults(null);
    setErrors([]);
    setElapsed(null);
  }, [selected, quantizers]);

  const config = useMemo(() => {
    const method: Record<string, unknown> = { name: selected };
    for (const [param, raw] of Object.entries(params)) {
      const value = toConfigValue(param, raw);
      if (value !== undefined) method[param] = value;
    }
    return {
      methods: [method],
      metrics: METRICS,
      k: K_VALUES,
      seed: SEED,
      n_reconstruct: 200,
    };
  }, [selected, params]);

  const onRun = useCallback(async () => {
    if (!dataset) return;
    setBusy(true);
    setErrors([]);
    const started = performance.now();
    try {
      const text = JSON.stringify(config);
      // Dry-run first: catches a bad param before spending time on a run, and
      // reports it in vq-bench's own words.
      const check = await runner().validate(text, dataset.dim);
      if (!check.ok) {
        setErrors(check.errors);
        setResults(null);
        return;
      }
      const out = await runner().run(text, dataset);
      if (!out.ok) {
        setErrors(out.errors);
        setResults(null);
        return;
      }
      setResults(out.results);
      setElapsed((performance.now() - started) / 1000);
    } catch (err: unknown) {
      setErrors([String(err)]);
    } finally {
      setBusy(false);
    }
  }, [config, dataset]);

  const ready = quantizers.length > 0 && dataset !== null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">VQ-bench Playground</h1>
          <p className="mt-1 text-sm text-slate-600">
            Vector quantizers running locally in your browser, via WebAssembly.
          </p>
        </header>

        <div className="grid gap-8 md:grid-cols-[20rem_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            {ready ? (
              <>
                <MethodPicker
                  quantizers={quantizers}
                  selected={selected}
                  params={params}
                  onSelect={setSelected}
                  onParamChange={(param, value) =>
                    setParams((prev) => ({ ...prev, [param]: value }))
                  }
                />

                <div className="mt-6 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">
                    {SAMPLE_DATASET.name} — {SAMPLE_DATASET.describe}
                  </p>
                </div>

                <button
                  onClick={onRun}
                  disabled={busy}
                  className="mt-4 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium
                             text-white hover:bg-slate-700 disabled:cursor-not-allowed
                             disabled:bg-slate-300"
                >
                  {busy ? "Running…" : "Run"}
                </button>
              </>
            ) : (
              <p className="text-sm text-slate-500">Loading…</p>
            )}
          </section>

          {/* min-w-0 lets this grid column shrink below its content width, which
              is what makes the results table's own overflow-x-auto engage
              instead of the table pushing the page wide. */}
          <section className="min-w-0 space-y-4">
            {errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h2 className="text-sm font-medium text-red-800">Config rejected</h2>
                <ul className="mt-2 space-y-1">
                  {errors.map((error) => (
                    <li key={error} className="font-mono text-xs text-red-700">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {results && results.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-5">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-medium text-slate-700">Results</h2>
                  {elapsed !== null && (
                    <span className="text-xs text-slate-400">{elapsed.toFixed(2)}s</span>
                  )}
                </div>
                <ResultsTable results={results} />
              </div>
            )}

            {!results && errors.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
                <p className="text-sm text-slate-500">
                  Choose a quantizer and press Run.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
