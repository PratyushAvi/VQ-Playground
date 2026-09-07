// Choosing what to run against: the bundled sample, or a user's own `.h5`.

import { useRef, useState } from "react";
import type { LoadOptions, LoadedFile } from "../lib/h5";

// h5wasm needs the whole file resident before it can read any of it -- HDF5
// wants random access and the browser's only filesystem is in-memory. That, not
// the machine's RAM, is the ceiling: wasm32 addresses at most 4 GB.
const WARN_BYTES = 500 * 1024 * 1024;

type Props = {
  sampleName: string;
  sampleDescribe: string;
  loaded: LoadedFile | null;
  options: LoadOptions;
  busy: string | null;
  onOptionsChange: (next: LoadOptions) => void;
  onFile: (file: File) => void;
  onUseSample: () => void;
};

export function DatasetPicker({
  sampleName,
  sampleDescribe,
  loaded,
  options,
  busy,
  onOptionsChange,
  onFile,
  onUseSample,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [oversize, setOversize] = useState<string | null>(null);

  function accept(file: File | undefined) {
    if (!file) return;
    setOversize(
      file.size > WARN_BYTES
        ? `${(file.size / 1048576).toFixed(0)} MB is large for an in-browser load; ` +
          `the tab may run out of memory.`
        : null,
    );
    onFile(file);
  }

  const number = (key: "nBase" | "nEval" | "candWidth", label: string, hint: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        <span className="ml-1.5 font-normal text-slate-400">{hint}</span>
      </span>
      <input
        type="number"
        min={1}
        value={options[key]}
        onChange={(e) =>
          onOptionsChange({ ...options, [key]: Math.max(1, Number(e.target.value) || 1) })
        }
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm
                   focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-md border-2 border-dashed p-4 text-center
                    transition-colors ${
                      dragging
                        ? "border-slate-500 bg-slate-100"
                        : "border-slate-300 hover:border-slate-400"
                    }`}
      >
        <p className="text-sm text-slate-600">
          Drop an <span className="font-mono text-xs">.h5</span> here, or click to choose
        </p>
        <p className="mt-1 text-xs text-slate-400">
          base/eval or train/test layouts; stays on your device
        </p>
        <input
          ref={input}
          type="file"
          accept=".h5,.hdf5"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>

      {oversize && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{oversize}</p>
      )}

      {busy && (
        <p className="text-xs text-slate-500">
          <span className="inline-block animate-pulse">{busy}</span>
        </p>
      )}

      {loaded ? (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="font-medium text-slate-800">{loaded.summary.schema} layout</p>
          <p className="mt-0.5">
            {loaded.summary.sampledBase.toLocaleString()} of{" "}
            {loaded.summary.fileBase.toLocaleString()} base ·{" "}
            {loaded.summary.sampledEval.toLocaleString()} of{" "}
            {loaded.summary.fileEval.toLocaleString()} queries · {loaded.summary.dim}d
          </p>
          <p className="mt-0.5 text-slate-500">ground truth {loaded.summary.groundTruth}</p>
          <button
            onClick={onUseSample}
            className="mt-2 text-slate-500 underline hover:text-slate-800"
          >
            back to the sample dataset
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          using <span className="font-medium text-slate-700">{sampleName}</span> —{" "}
          {sampleDescribe}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
        {number("nBase", "n_base", "rows")}
        {number("nEval", "n_eval", "queries")}
      </div>
      {number("candWidth", "candidates", "pool width")}
      <p className="text-xs text-slate-400">
        Rows are sampled uniformly at random, seeded — the same file and settings give the
        same subset.
      </p>
    </div>
  );
}
