# VQ-bench Playground

A fully in-browser, offline playground for [vq-bench](https://github.com/pinecone-io/vq-bench):
pick a quantizer, set its parameters, point it at vectors, and run it client-side.

All quantization behavior comes from vq-bench itself, compiled to WebAssembly. No
quantizer or metric logic is reimplemented in JavaScript.

**Status: Phase 0 complete.** vq-bench runs in WASM and its metrics match the native
`vqb` CLI on identical inputs. There is no UI yet.

## Layout

```
vendor/vq-bench/           our fork (branch `playground`, `upstream` remote set)
  src/metrics.rs           metrics, moved out of the CLI so a library user can call them
  crates/vqb-wasm/         the WASM wrapper -- the only Rust we maintain
tools/                     Phase 0 harness: fixture generation, headless runs, parity check
web/                       (Phase 1) the playground UI
```

## Verifying Phase 0

```sh
./tools/verify_phase0.sh
```

Builds the WASM module, runs it headlessly, runs the native CLI on the same vectors,
and compares every metric. Requires `wasm-pack`, the `wasm32-unknown-unknown` Rust
target, Node, `python3` with numpy+h5py, and system HDF5 (for the native CLI only --
the WASM build needs none of it).

Individual pieces:

```sh
python3 tools/make_fixture.py         # deterministic 1000 x 128 vectors
node tools/run_wasm.mjs               # run the default config through WASM
node tools/run_wasm.mjs '{"methods":[{"name":"e_rabitq","b":[2,4]}],"metrics":["recall"]}'
```

## The WASM API

Four exported functions, kept deliberately small so UI work rarely needs a Rust rebuild:

| function | purpose |
|---|---|
| `list_quantizers()` | every family, from the live registry (15 today) |
| `list_metrics()` | every metric this build reports (9) |
| `validate_config(json, dim)` | the dry run: names, params, values -- computes nothing |
| `run(json, base, eval, dim, candidates, cand_width)` | fit, encode, score, reconstruct |

Config JSON matches the CLI's, minus `datasets` (the browser passes vectors directly).
An array-valued param sweeps, as upstream: `{"name": "minmax", "b": [2, 4, 6]}` is three runs.

## Fork changes

Kept minimal and additive so rebasing onto upstream stays cheap:

1. **`src/bin/vqb/bench.rs` → `src/metrics.rs`**, exported as `pub mod metrics`. The metric
   math was trapped inside the CLI binary. It depends only on `std` + `rand`, so it moved
   as-is; the CLI aliases it back as `crate::bench` and every call site is unchanged.
2. **faer without its `rayon` feature.** That feature pulls `spindle` → `atomic-wait`, which
   has no `wasm32-unknown-unknown` backend. All other faer defaults are kept, so native
   builds are unaffected.

Syncing upstream:

```sh
cd vendor/vq-bench && git fetch upstream && git rebase upstream/main
```

New quantizers and metrics then appear in the playground automatically, since both lists
are read from the registry rather than hardcoded.

## Notes for the next phase

- **Threading is off.** v1 is single-threaded. Worth knowing: the native CLI already calls
  `faer::set_global_parallelism(Par::Seq)`, so threads would speed up chunked *encoding*,
  not the linear algebra.
- **ITQ and OPQ differ slightly from native** (recall within ~0.03). Both run iterative
  SVD/eigen solves and then iterate on the result; x86-64 and wasm32 round differently, so
  they settle on different local optima. The gap is smaller than each method's own
  seed-to-seed spread — on native, ITQ moves 0.250/0.274/0.254 across seeds 1/2/3 while
  MinMax stays flat at 0.694. `tools/compare_parity.mjs` encodes this as a wider tolerance
  for those two families and holds every other method to near-exact agreement.
- **Datasets are still synthetic.** Real `.h5` loading (h5wasm, hyperslab reads) is Phase 2.
  The fixture is written to a registry dataset's path so the native CLI can read it; a real
  `.h5` has not been validated yet.
