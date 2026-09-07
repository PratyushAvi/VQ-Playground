// Quantizer dropdown plus one input per param the chosen family accepts.
//
// Both the family list and each family's param names come from the wasm
// registry, so this stays correct as vq-bench gains methods.

import type { Quantizer } from "../lib/types";
import { shapeOf } from "../lib/params";

type Props = {
  quantizers: Quantizer[];
  selected: string;
  params: Record<string, string>;
  onSelect: (key: string) => void;
  onParamChange: (param: string, value: string) => void;
};

export function MethodPicker({
  quantizers,
  selected,
  params,
  onSelect,
  onParamChange,
}: Props) {
  const family = quantizers.find((q) => q.key === selected);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Quantizer</span>
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm
                     focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
        >
          {quantizers.map((q) => (
            <option key={q.key} value={q.key}>
              {q.family}
            </option>
          ))}
        </select>
      </label>

      {family && (
        <p className="font-mono text-xs leading-relaxed text-slate-500">{family.describe}</p>
      )}

      {family?.params.length === 0 && (
        <p className="text-sm text-slate-500">This quantizer takes no parameters.</p>
      )}

      {family?.params.map((param) => {
        const shape = shapeOf(param);
        return (
          <label key={param} className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              {param}
              <span className="ml-2 font-normal text-slate-400">{shape.hint}</span>
            </span>

            {shape.kind === "choice" ? (
              <select
                value={params[param] ?? ""}
                onChange={(e) => onParamChange(param, e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm
                           focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
              >
                {shape.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                inputMode={shape.kind === "int" ? "numeric" : "text"}
                value={params[param] ?? ""}
                onChange={(e) => onParamChange(param, e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm
                           focus:border-slate-500 focus:ring-1 focus:ring-slate-500 focus:outline-none"
              />
            )}

            {shape.kind === "int" && (
              <span className="mt-1 block text-xs text-slate-400">
                one value, or a comma-separated sweep
                {shape.max !== undefined && ` (${shape.min}-${shape.max})`}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
