// The wasm module runs here, off the UI thread, so a slow run never freezes the
// page. Comlink turns the postMessage plumbing into plain awaited calls.

import * as Comlink from "comlink";
import init, {
  list_quantizers,
  list_metrics,
  validate_config,
  run,
} from "../wasm/vqb_wasm.js";
import wasmUrl from "../wasm/vqb_wasm_bg.wasm?url";

import type { Dataset, RunResponse, ValidationResponse } from "./types";

/** Instantiate once; every later call reuses the same module. */
const ready = init({ module_or_path: wasmUrl });

const api = {
  async listQuantizers() {
    await ready;
    return JSON.parse(list_quantizers());
  },

  async listMetrics() {
    await ready;
    return JSON.parse(list_metrics());
  },

  async validate(config: string, dim: number): Promise<ValidationResponse> {
    await ready;
    return JSON.parse(validate_config(config, dim));
  },

  async run(config: string, data: Dataset): Promise<RunResponse> {
    await ready;
    return JSON.parse(
      run(config, data.base, data.eval, data.dim, data.candidates, data.candWidth),
    );
  },
};

export type RunnerApi = typeof api;

Comlink.expose(api);
