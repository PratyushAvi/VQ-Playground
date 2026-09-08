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
import { DatasetList } from "./components/DatasetList";
import { MethodPicker } from "./components/MethodPicker";
import { PipelineBuilder } from "./components/PipelineBuilder";
import { ResultsTable } from "./components/ResultsTable";
import { RunHistory } from "./components/RunHistory";
import { datasetUrl, loadRegistry, loadSampleDataset } from "./lib/dataset";
import {
  benchmarkEntry,
  customEntry,
  sampleEntry,
  type Entry,
  type Progress,
} from "./lib/datasets-panel";
import type { LoadOptions, LoadedFile } from "./lib/h5";
import { clearRuns, deleteRun, listRuns, saveRun, type RunRecord } from "./lib/history";
import { defaultValue, toConfigValue } from "./lib/params";
import { runner } from "./lib/runner";
import type { MethodResult, PrimitiveSpec, Quantizer, Stage } from "./lib/types";

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
  const [selectedFamily, setSelectedFamily] = useState("minmax");
  const [params, setParams] = useState<Record<string, string>>({});
  const [configText, setConfigText] = useState("");
  // Collapsed by default: the plot is the point, and the JSON is a detail most
  // sessions never need to open.
  const [configOpen, setConfigOpen] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string[]>(["sample"]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [baseUrl, setBaseUrl] = useState("");
  const [loadOptions, setLoadOptions] = useState<LoadOptions>(DEFAULT_LOAD);

  // One result set per dataset the run covered, keyed by entry id.
  const [results, setResults] = useState<Record<string, MethodResult[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  // The ids this run wrote, so the plot can tell earlier runs from the one it
  // is drawing as the subject. Ids carry a random offset to stay unique across
  // a multi-dataset run, so they do not compare reliably against a timestamp.
  const [currentRunIds, setCurrentRunIds] = useState<number[]>([]);

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
        setRuns(saved);
        // The sample is bundled, so it is ready the moment the page is. The
        // registry loads separately and may land first, so merge rather than
        // replace -- whichever arrives second must not drop the other.
        const entry = { ...sampleEntry(data.nBase, data.nEval, data.dim), dataset: data };
        setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setErrors([`startup failed: ${String(err)}`]);
      });

    // The importable list is a nicety; a failure must not block startup.
    loadRegistry()
      .then((registry) => {
        if (cancelled) return;
        setBaseUrl(registry.base_url);
        const rows = registry.datasets.map(benchmarkEntry);
        setEntries((prev) => [...prev, ...rows.filter((r) => !prev.some((e) => e.id === r.id))]);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const family = quantizers.find((q) => q.key === selectedFamily);
    if (!family) return;
    setParams(Object.fromEntries(family.params.map((p) => [p, defaultValue(p)])));
    setResults({});
    setErrors([]);
    setElapsed(null);
  }, [selectedFamily, quantizers]);

  useEffect(() => {
    setResults({});
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
        : { name: selectedFamily };
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
  }, [mode, selectedFamily, params, stages]);

  useEffect(() => {
    setConfigText(JSON.stringify(formConfig, null, 2));
  }, [formConfig]);

  const chosen = useMemo(
    () => entries.filter((e) => selected.includes(e.id)),
    [entries, selected],
  );
  // Validation needs a dimension; any loaded one will do, since each dataset is
  // validated again on its own before it runs.
  const validationDim = chosen.find((e) => e.dataset)?.dataset?.dim ?? 0;

  const validate = useCallback(
    async (config: string): Promise<string[]> => {
      try {
        const check = await runner().validate(config, validationDim);
        return check.ok ? [] : check.errors;
      } catch (err: unknown) {
        return [String(err)];
      }
    },
    [validationDim],
  );

  const report = useCallback(
    (id: string, stage: string, done: number, total: number) =>
      setProgress((prev) => ({ ...prev, [id]: { stage, done, total } })),
    [],
  );

  /**
   * Make sure an entry's vectors are in memory, reading them if not.
   *
   * Reading happens in the worker: a large parse would freeze the page, and the
   * remote reader's byte-range fetches use synchronous XHR, which browsers only
   * allow off the main thread.
   */
  const ensureLoaded = useCallback(
    async (entry: Entry): Promise<Entry> => {
      if (entry.dataset) return entry;
      const source =
        entry.source.kind === "custom"
          ? ({ kind: "file", file: entry.source.file } as const)
          : ({ kind: "url", url: datasetUrl(baseUrl, (entry.source as { remote: { name: string } }).remote.name) } as const);

      const loaded = (await runner().loadDataset(
        source,
        loadOptions,
        Comlink.proxy((stage: string, done: number, total: number) =>
          report(entry.id, stage, done, total),
        ),
      )) as LoadedFile;

      const summary =
        `${loaded.summary.sampledBase.toLocaleString()} of ` +
        `${loaded.summary.fileBase.toLocaleString()} vectors · ${loaded.summary.dim}d · ` +
        `ground truth ${loaded.summary.groundTruth}`;
      const next: Entry = { ...entry, dataset: loaded.dataset, summary };
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? next : e)));
      return next;
    },
    [baseUrl, loadOptions, report],
  );

  const onImport = useCallback(
    async (id: string) => {
      const entry = entries.find((e) => e.id === id);
      if (!entry || entry.dataset) return;
      setErrors([]);
      try {
        await ensureLoaded(entry);
        // Ticking it is the obvious next step, so do it for them.
        setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
      } catch (err: unknown) {
        setErrors([`${entry.title}: ${(err as Error).message ?? String(err)}`]);
        // Clear the bar so the row offers `import` again rather than sticking
        // on "importing…".
        setProgress((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [ensureLoaded, entries],
  );

  const onAddFile = useCallback((file: File) => {
    const entry = customEntry(file);
    // The file joins the list like any other row -- unticked, with an `import`
    // button -- so opening a 2 GB file by mistake costs nothing until asked.
    setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
  }, []);

  const onRun = useCallback(async () => {
    if (chosen.length === 0) {
      setErrors(["Select at least one dataset to run against."]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setResults({});
    setProgress({});
    const started = performance.now();
    const collected: Record<string, MethodResult[]> = {};
    const problems: string[] = [];

    try {
      // Sequential rather than parallel: one wasm worker, and running several
      // datasets at once would only interleave their progress confusingly.
      for (const entry of chosen) {
        try {
          // Only imported datasets are selectable, so this is a guard, not a
          // path the UI can reach.
          const vectors = entry.dataset;
          if (!vectors) continue;

          report(entry.id, "validating", 0, 0);
          const check = await runner().validate(configText, vectors.dim);
          if (!check.ok) {
            problems.push(...check.errors.map((e) => `${entry.title}: ${e}`));
            continue;
          }

          report(entry.id, "running", 0, 0);
          const out = await runner().run(configText, vectors);
          if (!out.ok) {
            problems.push(...out.errors.map((e) => `${entry.title}: ${e}`));
            continue;
          }
          collected[entry.id] = out.results;
          report(entry.id, "done", 1, 1);
        } catch (err: unknown) {
          problems.push(`${entry.title}: ${(err as Error).message ?? String(err)}`);
        }
      }

      const seconds = (performance.now() - started) / 1000;
      setResults(collected);
      setErrors(problems);
      setElapsed(seconds);

      // One stored run per dataset, so each carries the reference curve it
      // should be read against.
      const written: number[] = [];
      for (const [id, rows] of Object.entries(collected)) {
        const entry = entries.find((e) => e.id === id);
        const runId = Date.now() + written.length;
        written.push(runId);
        await saveRun({
          id: runId,
          config: configText,
          dataset: entry?.title ?? id,
          benchmarkDataset: entry?.benchmarkKey ?? null,
          results: rows,
          elapsedSeconds: seconds,
        });
      }
      setCurrentRunIds(written);
      setRuns(await listRuns());
    } finally {
      setBusy(false);
      // Leave the bars up: they say which datasets the results came from.
    }
  }, [chosen, configText, entries, report]);

  const ready = quantizers.length > 0 && entries.length > 0;
  const resultEntries = Object.entries(results);

  return (
    <div className="mx-auto max-w-[110rem] px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
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
                selected={selectedFamily}
                params={params}
                onSelect={setSelectedFamily}
                onParamChange={(param, value) =>
                  setParams((prev) => ({ ...prev, [param]: value }))
                }
              />
            ) : (
              <PipelineBuilder primitives={primitives} stages={stages} onChange={setStages} />
            )}
          </Panel>

          <Panel
            title="Datasets"
            aside={selected.length > 1 ? `${selected.length} selected` : undefined}
          >
            <DatasetList
              entries={entries}
              selected={selected}
              progress={progress}
              disabled={busy}
              onToggle={(id) =>
                setSelected((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                )
              }
              onImport={onImport}
              onAddFile={onAddFile}
            />

            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <SampleSize
                label="n_base"
                hint="rows"
                value={loadOptions.nBase}
                onChange={(nBase) => setLoadOptions((o) => ({ ...o, nBase }))}
              />
              <SampleSize
                label="n_eval"
                hint="queries"
                value={loadOptions.nEval}
                onChange={(nEval) => setLoadOptions((o) => ({ ...o, nEval }))}
              />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Applies when a dataset is first read. Rows are sampled uniformly at random,
              seeded — the same dataset and settings give the same subset.
            </p>
          </Panel>

          <Panel title="History">
            <RunHistory
              runs={runs}
              onRestore={(run) => {
                setConfigText(run.config);
                setResults({ [`saved:${run.id}`]: run.results });
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

        <div className="min-w-0 space-y-6">
          <button
            onClick={onRun}
            disabled={busy || !ready}
            className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium
                       text-white hover:bg-slate-700 disabled:cursor-not-allowed
                       disabled:bg-slate-300"
          >
            {busy
              ? "Running…"
              : `Run on ${selected.length} dataset${selected.length === 1 ? "" : "s"}`}
          </button>

          {errors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h2 className="text-sm font-medium text-red-800">
                {errors.length === 1 ? "A problem" : `${errors.length} problems`}
              </h2>
              <ul className="mt-2 space-y-1">
                {errors.map((error) => (
                  <li key={error} className="font-mono text-xs break-words text-red-700">
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* One results block per dataset, each named and each plotted against
              its own reference curves -- a single merged table would hide which
              dataset a number came from. */}
          {resultEntries.map(([id, rows]) => {
            const entry = entries.find((e) => e.id === id);
            const title = entry?.title ?? "saved run";
            return (
              <Panel
                key={id}
                title={title}
                aside={elapsed !== null ? `${elapsed.toFixed(2)}s total` : undefined}
              >
                <SotaOverlay
                  results={rows}
                  k={DEFAULT_KS[DEFAULT_KS.length - 1]}
                  benchmarkDataset={entry?.benchmarkKey ?? null}
                  datasetLabel={title}
                  // Everything but this run, which is drawn as the subject.
                  history={runs.filter((r) => !currentRunIds.includes(r.id))}
                />
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <ResultsTable results={rows} />
                </div>
              </Panel>
            );
          })}

          <section className="min-w-0 rounded-lg border border-slate-200 bg-white">
            <details open={configOpen} onToggle={(e) => setConfigOpen(e.currentTarget.open)}>
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-700
                                  hover:text-slate-900">
                Config
                <span className="ml-2 font-normal text-slate-400">
                  {configOpen ? "" : "the JSON this run sends to vq-bench"}
                </span>
              </summary>
              <div className="px-5 pb-5">
                <ConfigEditor value={configText} onChange={setConfigText} validate={validate} />
              </div>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A sample-size field; both are plain positive integers. */
function SampleSize({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        <span className="ml-1.5 font-normal text-slate-400">{hint}</span>
      </span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm
                   focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
      />
    </label>
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
