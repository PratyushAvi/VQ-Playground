// The landing page: what this is on the left, what the benchmark found on the
// right. The plot is the argument -- quantizers are only interesting relative
// to what the same bit budget buys elsewhere.

import { useEffect, useState } from "react";

import { TradeoffChart, type Series } from "./TradeoffChart";
import { loadSota, shortName, type Sota } from "../lib/sota";

type Props = {
  onOpenPlayground: () => void;
};

export function Landing({ onOpenPlayground }: Props) {
  const [sota, setSota] = useState<Sota | null>(null);
  const [dataset, setDataset] = useState("arxiv-nomic-768-normalized");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadSota().then(setSota).catch(() => setFailed(true));
  }, []);

  const entry = sota?.datasets[dataset];
  const series: Series[] = entry
    ? Object.entries(entry.curves).map(([name, points]) => ({
        name,
        points: points.map((p) => ({ bits: p.bits, recall: p.recall, label: p.label })),
      }))
    : [];

  return (
    <>
    <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-2">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Vector quantizers, running in your browser
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          A playground for{" "}
          <a
            href="https://github.com/pinecone-io/vq-bench"
            target="_blank"
            rel="noreferrer"
            className="text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
          >
            vq-bench
          </a>
          , the open-source benchmark for vector quantization. Pick a quantizer, set its
          parameters, point it at some vectors, and see what the compression costs you — with
          no install, no server, and nothing leaving your machine.
        </p>

        <div className="mt-8 space-y-5">
          <Point title="It is really vq-bench">
            The Rust crate is compiled to WebAssembly and called directly. Every score comes
            from the same code the CLI runs — verified to match it exactly on identical
            inputs. Nothing is reimplemented in JavaScript.
          </Point>
          <Point title="Compose your own quantizer">
            Chain vq-bench's primitives into a pipeline of your own —{" "}
            <span className="font-mono text-xs">center → normalize → rotate → cast_angular</span>{" "}
            is E-RaBitQ, and composing it by hand reproduces it exactly. No recompile.
          </Point>
          <Point title="Bring your own vectors">
            Drop in an <span className="font-mono text-xs">.h5</span> file and it is read in
            the browser. Your data never leaves the device; there is no backend to send it to.
          </Point>
        </div>

        <div className="mt-8 flex items-center gap-4">
          <button
            onClick={onOpenPlayground}
            className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Open the playground
          </button>
          <a
            href="https://arxiv.org/abs/2608.11240"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-500 hover:text-slate-900"
          >
            Read the paper ↗
          </a>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-slate-700">
            What the benchmark found
          </h2>
          {sota && (
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

        {failed && (
          <p className="py-8 text-center text-xs text-slate-400">
            Reference results are unavailable.
          </p>
        )}
        {!failed && !sota && (
          <p className="py-8 text-center text-xs text-slate-400">Loading results…</p>
        )}
        {entry && (
          <>
            <TradeoffChart
              series={series}
              caption="recall@10 against bits per dimension — up and to the left is better"
              height={300}
            />

            {/* The curves bunch: three families sit within 0.02 recall of each
                other, which is a finding in itself but unreadable off the plot.
                The table is where the exact numbers live. */}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-800">
                the same numbers, as a table
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="py-1.5 pr-3 font-medium text-slate-700">method</th>
                      <th className="py-1.5 pr-3 text-right font-medium text-slate-700">bits/dim</th>
                      <th className="py-1.5 text-right font-medium text-slate-700">recall@10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(entry.curves)
                      .flatMap(([, points]) => points)
                      .sort((a, b) => a.bits - b.bits || b.recall - a.recall)
                      .map((point) => (
                        <tr key={point.label} className="border-b border-slate-100 last:border-0">
                          <td className="py-1.5 pr-3 text-slate-700">{point.label}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500">
                            {point.bits.toFixed(2)}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-500">
                            {point.recall.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              The five strongest families on {shortName(dataset, entry.dim)} (
              {entry.n_base.toLocaleString()} vectors), from the published{" "}
              <a
                href="https://www.vq-bench.com"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900"
              >
                vq-bench results
              </a>
              . Every curve trades size against accuracy; the interesting question is which one
              buys the most recall per bit.
            </p>
          </>
        )}
      </section>
    </div>

    <footer className="mx-auto max-w-6xl px-6 pb-12">
      <div className="border-t border-slate-200 pt-6 text-xs text-slate-500">
        <p>
          Built on{" "}
          <a href="https://github.com/pinecone-io/vq-bench" target="_blank" rel="noreferrer"
             className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
            vq-bench
          </a>{" "}
          by Ingber, Liberty and Padaki (Pinecone, UPenn). Reference results from{" "}
          <a href="https://www.vq-bench.com" target="_blank" rel="noreferrer"
             className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-900">
            vq-bench.com
          </a>
          {sota ? `, run ${sota.run}.` : "."}{" "}
          Everything on this page runs locally — no data is sent anywhere.
        </p>
      </div>
    </footer>
    </>
  );
}

function Point({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}
