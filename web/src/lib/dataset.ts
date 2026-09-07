// Loading the bundled sample dataset.
//
// Phase 1 ships one small dataset as raw typed-array files -- the same bytes
// tools/make_fixture.py writes, so the browser and the Phase 0 harness run on
// identical vectors. Phase 2 replaces this with real `.h5` parsing (h5wasm),
// which is why the return shape is the dataset itself and not a file handle.

import type { Dataset } from "./types";

type Meta = {
  n_base: number;
  n_eval: number;
  dim: number;
  cand_width: number;
};

/** The sample dataset's human-facing description, for the UI. */
export const SAMPLE_DATASET = {
  name: "sample-128",
  describe: "1,000 clustered unit vectors in 128 dimensions, 50 queries",
};

async function fetchTyped<T>(
  url: string,
  Kind: new (buffer: ArrayBuffer) => T,
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not load ${url} (${response.status})`);
  }
  return new Kind(await response.arrayBuffer());
}

export async function loadSampleDataset(): Promise<Dataset> {
  const meta: Meta = await fetch("data/meta.json").then((r) => r.json());
  const [base, evalQueries, candidates] = await Promise.all([
    fetchTyped("data/base.f32", Float32Array),
    fetchTyped("data/eval.f32", Float32Array),
    fetchTyped("data/candidates.u32", Uint32Array),
  ]);

  return {
    base,
    eval: evalQueries,
    candidates,
    dim: meta.dim,
    candWidth: meta.cand_width,
    nBase: meta.n_base,
    nEval: meta.n_eval,
  };
}
