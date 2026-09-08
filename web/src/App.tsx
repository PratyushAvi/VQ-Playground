// The playground: build a config (by form or by hand), point it at a dataset,
// run it locally, keep the result.
//
// The form and the JSON editor are two views of one config. Editing the form
// rewrites the JSON; editing the JSON leaves the form alone, since arbitrary
// JSON has no faithful form representation.

import { useCallback, useEffect, useMemo, useState } from "react";
import * as Comlink from "comlink";

import { ConfigEditor } from "./components/ConfigEditor";
import { Landing } from "./components/Landing";
import { NavBar } from "./components/NavBar";
import { SotaOverlay } from "./components/SotaOverlay";
import { DatasetPicker } from "./components/DatasetPicker";
import { MethodPicker } from "./components/MethodPicker";
import { PipelineBuilder } from "./components/PipelineBuilder";
import { ResultsTable } from "./components/ResultsTable";
import { RunHistory } from "./components/RunHistory";
import { SAMPLE_DATASET, loadSampleDataset } from "./lib/dataset";
import { loadH5, type LoadOptions, type LoadedFile } from "./lib/h5";
import { clearRuns, deleteRun, listRuns, saveRun, type RunRecord } from "./lib/history";
import { defaultValue, toConfigValue } from "./lib/params";
import { runner } from "./lib/runner";
import type { Dataset, MethodResult, PrimitiveSpec, Quantizer, Stage } from "./lib/types";

const DEFAULT_METRICS = ["recall", "mse_score", "mse_recon"];
const DEFAULT_KS = [1, 10];
const SEED = 1;

/** Small by default: a phone could be the runtime, and a big base is slow. */
const DEFAULT_LOAD: LoadOptions = { nBase: 10000, nEval: 100, candWidth: 100, seed: SEED };

type View = "landing" | "playground";

function viewFromHash(): View {
  return window.location.hash === "#playground" ? "playground" : "landing";
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const navigate = useCallback((next: View) => {
    window.location.hash = next === "playground" ? "#playground" : "";
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <NavBar view={view} onNavigate={navigate} />
      {view === "landing" ? (
        <Landing onOpenPlayground={() => navigate("playground")} />
      ) : (
        <Playground />
      )}
    </div>
  );
}

function Playground() {
  const [quantizers, setQuantizers] = useState<Quantizer[]>([]);
  const [primitives, setPrimitives] = useState<PrimitiveSpec[]>([]);
  const [mode, setMode] = useState<"family" | "custom">("family");
  const [stages, setStages] = useState<Stage[]>([]);
  const [sample, setSample] = useState<Dataset | null>(null);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [loadOptions, setLoadOptions] = useState<LoadOptions>(DEFAULT_LOAD);
  const [loadingStage, setLoadingStage] = useState<string | null>(null);

  const [selected, setSelected] = useState("minmax");
  const [params, setParams] = useState<Record<string, string>>({});
  const [configText, setConfigText] = useState("");

  const [results, setResults] = useState<MethodResult[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);

  const dataset = loadedFile?.dataset ?? sample;
  const datasetName = loadedFile ? "local file" : SAMPLE_DATASET.name;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      runner().listQuantizers(),
      runner().listPrimitives(),
      loadSampleDataset(),
      listRuns(),
    ])
      .then(([families, stageKinds, data, saved]) => {
        if (cancelled) return;
        setQuantizers(families);
        setPrimitives(stageKinds);
        setSample(data);
        setRuns(saved);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors([`startup failed: ${String(err)}`]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset params when the family changes, and drop results that described the
  // previous quantizer.
  useEffect(() => {
    const family = quantizers.find((q) => q.key === selected);
    if (!family) return;
    setParams(Object.fromEntries(family.params.map((p) => [p, defaultValue(p)])));
    setResults(null);
    setErrors([]);
    setElapsed(null);
  }, [selected, quantizers]);

  useEffect(() => {
    setResults(null);
    setErrors([]);
    setElapsed(null);
  }, [mode]);

  /** The config the form describes -- a built-in family, or a composed chain. */
  const formConfig = useMemo(() => {
    const method: Record<string, unknown> =
      mode === "custom"
        ? {
            name: "custom",
            stages: stages.map((stage) => {
              const out: Record<string, unknown> = { name: stage.key };
              for (const [param, raw] of Object.entries(stage.params)) {
                const value = toConfigValue(param, raw);
                if (value !== undefined) out[param] = value;
              }
              return out;
            }),
          }
        : { name: selected };
    if (mode === "family") {
      for (const [param, raw] of Object.entries(params)) {
        const value = toConfigValue(param, raw);
        if (value !== undefined) method[param] = value;
      }
    }
    return {
      methods: [method],
      metrics: DEFAULT_METRICS,
      k: DEFAULT_KS,
      seed: SEED,
      n_reconstruct: 200,
    };
  }, [mode, selected, params, stages]);

  // The form drives the editor. `configText` is what actually runs, so hand
  // edits survive until the form changes again.
  useEffect(() => {
    setConfigText(JSON.stringify(formConfig, null, 2));
  }, [formConfig]);

  const validate = useCallback(
    async (config: string): Promise<string[]> => {
      if (!dataset) return [];
      try {
        const check = await runner().validate(config, dataset.dim);
        return check.ok ? [] : check.errors;
      } catch (err: unknown) {
        return [String(err)];
      }
    },
    [dataset],
  );

  const onFile = useCallback(
    async (file: File) => {
      setErrors([]);
      setResults(null);
      try {
        const loaded = await loadH5(
          file,
          {
            ...loadOptions,
            onProgress: (stage, done, total) =>
              setLoadingStage(total > 1 ? `${stage} ${done}/${total}` : stage),
          },
          // Ground truth is computed by vq-bench in the worker, never in JS.
          (base, evalQueries, dim, l) =>
            runner().topNeighbors(
              base,
              evalQueries,
              dim,
              l,
              Comlink.proxy((done: number, total: number) =>
                setLoadingStage(`ground truth ${done}/${total}`),
              ),
            ) as Promise<Uint32Array>,
        );
        setLoadedFile(loaded);
      } catch (err: unknown) {
        setErrors([`could not read ${file.name}: ${(err as Error).message ?? String(err)}`]);
      } finally {
        setLoadingStage(null);
      }
    },
    [loadOptions],
  );

  const onRun = useCallback(async () => {
    if (!dataset) return;
    setBusy(true);
    setErrors([]);
    const started = performance.now();
    try {
      const check = await runner().validate(configText, dataset.dim);
      if (!check.ok) {
        setErrors(check.errors);
        setResults(null);
        return;
      }
      const out = await runner().run(configText, dataset);
      if (!out.ok) {
        setErrors(out.errors);
        setResults(null);
        return;
      }
      const seconds = (performance.now() - started) / 1000;
      setResults(out.results);
      setElapsed(seconds);

      // Only the scores and the config that made them -- never the vectors.
      const record: RunRecord = {
        id: Date.now(),
        config: configText,
        dataset: datasetName,
        results: out.results,
        elapsedSeconds: seconds,
      };
      await saveRun(record);
      setRuns(await listRuns());
    } catch (err: unknown) {
      setErrors([String(err)]);
    } finally {
      setBusy(false);
    }
  }, [configText, dataset, datasetName]);

  const ready = quantizers.length > 0 && dataset !== null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-6">
            <Panel title="Quantizer">
              <div className="mb-3 flex gap-1 rounded-md bg-slate-100 p-0.5">
                {(["family", "custom"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setMode(option)}
                    className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                      mode === option
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {option === "family" ? "Built-in" : "Compose"}
                  </button>
                ))}
              </div>

              {!ready ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : mode === "family" ? (
                <MethodPicker
                  quantizers={quantizers}
                  selected={selected}
                  params={params}
                  onSelect={setSelected}
                  onParamChange={(param, value) =>
                    setParams((prev) => ({ ...prev, [param]: value }))
                  }
                />
              ) : (
                <PipelineBuilder
                  primitives={primitives}
                  stages={stages}
                  onChange={setStages}
                />
              )}
            </Panel>

            <Panel title="Dataset">
              <DatasetPicker
                sampleName={SAMPLE_DATASET.name}
                sampleDescribe={SAMPLE_DATASET.describe}
                loaded={loadedFile}
                options={loadOptions}
                busy={loadingStage}
                onOptionsChange={setLoadOptions}
                onFile={onFile}
                onUseSample={() => setLoadedFile(null)}
              />
            </Panel>

            <Panel title="History">
              <RunHistory
                runs={runs}
                onRestore={(run) => {
                  setConfigText(run.config);
                  setResults(run.results);
                  setElapsed(run.elapsedSeconds);
                  setErrors([]);
                }}
                onDelete={async (id) => {
                  await deleteRun(id);
                  setRuns(await listRuns());
                }}
                onClear={async () => {
                  await clearRuns();
                  setRuns([]);
                }}
              />
            </Panel>
          </div>

          {/* min-w-0 lets this column shrink below its content, so the results
              table scrolls inside its card instead of widening the page. */}
          <div className="min-w-0 space-y-6">
            <Panel title="Config">
              <ConfigEditor value={configText} onChange={setConfigText} validate={validate} />
              <button
                onClick={onRun}
                disabled={busy || !ready}
                className="mt-3 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium
                           text-white hover:bg-slate-700 disabled:cursor-not-allowed
                           disabled:bg-slate-300"
              >
                {busy ? "Running…" : "Run"}
              </button>
            </Panel>

            {errors.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h2 className="text-sm font-medium text-red-800">Config rejected</h2>
                <ul className="mt-2 space-y-1">
                  {errors.map((error) => (
                    <li key={error} className="font-mono text-xs break-words text-red-700">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {results && results.length > 0 && (
              <>
                <Panel
                  title="Results"
                  aside={elapsed !== null ? `${elapsed.toFixed(2)}s` : undefined}
                >
                  <ResultsTable results={results} />
                </Panel>

                <Panel title="Against the benchmark">
                  <SotaOverlay results={results} k={DEFAULT_KS[DEFAULT_KS.length - 1]} />
                </Panel>
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-slate-700">{title}</h2>
        {aside && <span className="text-xs text-slate-400">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
