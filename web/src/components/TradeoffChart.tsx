// Recall against bit budget: the rate/quality tradeoff every quantizer is
// judged on. One line per family, so the reader compares curves rather than
// reading absolute values -- a quantizer is only interesting relative to what
// the same number of bits buys elsewhere.
//
// Inline SVG rather than a charting library: the shapes are simple, and it
// keeps the dependency surface small.

import { useId, useMemo, useState } from "react";

export type Series = {
  name: string;
  points: { bits: number; recall: number; label?: string }[];
  /** Drawn heavier, above the rest -- the reader's own result. */
  emphasis?: boolean;
};

type Props = {
  series: Series[];
  /** Rendered above the plot; the chart's own caption names the metric. */
  caption?: string;
  height?: number;
};

// Categorical slots in fixed order, so a family keeps its colour when the
// series list changes. Validated for CVD separation and contrast in both
// modes; `--series-mine` is the reserved highlight for the reader's own run.
const SLOTS = 6;

/** Marker shapes, so near-identical curves stay separable without colour. */
const SHAPES = ["circle", "square", "triangle", "diamond", "cross", "circle"] as const;

/** One marker of the given shape, centred on (cx, cy). */
function Marker({ shape, cx, cy, r, fill }: {
  shape: (typeof SHAPES)[number];
  cx: number; cy: number; r: number; fill: string;
}) {
  const common = { fill, stroke: "var(--surface-1, #fff)", strokeWidth: 2 };
  switch (shape) {
    case "square":
      return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={1} {...common} />;
    case "triangle":
      return <polygon points={`${cx},${cy - r * 1.15} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}`} {...common} />;
    case "diamond":
      return <polygon points={`${cx},${cy - r * 1.2} ${cx + r * 1.2},${cy} ${cx},${cy + r * 1.2} ${cx - r * 1.2},${cy}`} {...common} />;
    case "cross":
      return <polygon points={crossPoints(cx, cy, r * 1.2)} {...common} />;
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

function crossPoints(cx: number, cy: number, r: number): string {
  const t = r * 0.42;
  return [
    [cx - t, cy - r], [cx + t, cy - r], [cx + t, cy - t], [cx + r, cy - t],
    [cx + r, cy + t], [cx + t, cy + t], [cx + t, cy + r], [cx - t, cy + r],
    [cx - t, cy + t], [cx - r, cy + t], [cx - r, cy - t], [cx - t, cy - t],
  ].map(([x, y]) => `${x},${y}`).join(" ");
}

const PAD = { top: 12, right: 16, bottom: 34, left: 42 };

export function TradeoffChart({ series, caption, height = 260 }: Props) {
  const clipId = useId();
  const [hover, setHover] = useState<{ x: number; y: number; series: string; bits: number; recall: number } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [width, setWidth] = useState(520);

  const bounds = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length === 0) return null;
    const bits = all.map((p) => p.bits);
    const recall = all.map((p) => p.recall);
    // Pad the range so end markers are not clipped by the axes.
    const loBits = Math.max(0, Math.min(...bits) - 0.5);
    const hiBits = Math.max(...bits) + 0.5;
    const loRecall = Math.max(0, Math.min(...recall) - 0.05);
    const hiRecall = Math.min(1, Math.max(...recall) + 0.05);
    return { loBits, hiBits, loRecall, hiRecall };
  }, [series]);

  if (!bounds) {
    return <p className="py-8 text-center text-xs text-slate-400">No results to plot yet.</p>;
  }

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (bits: number) =>
    PAD.left + ((bits - bounds.loBits) / (bounds.hiBits - bounds.loBits)) * plotW;
  const y = (recall: number) =>
    PAD.top + (1 - (recall - bounds.loRecall) / (bounds.hiRecall - bounds.loRecall)) * plotH;

  const xTicks = ticks(bounds.loBits, bounds.hiBits, 5);
  const yTicks = ticks(bounds.loRecall, bounds.hiRecall, 4);

  return (
    <figure className="viz-root m-0">
      {caption && <figcaption className="mb-2 text-xs text-slate-500">{caption}</figcaption>}

      <div
        ref={(node) => {
          if (node && node.clientWidth && node.clientWidth !== width) setWidth(node.clientWidth);
        }}
        className="w-full"
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={caption ?? "recall against bits per dimension"}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>

          {/* Recessive grid: present enough to read a value off, quiet enough
              that the curves stay the figure. */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-slate-200"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-slate-400 text-[10px] tabular-nums"
              >
                {t.toFixed(2)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              x={x(t)}
              y={height - PAD.bottom + 14}
              textAnchor="middle"
              className="fill-slate-400 text-[10px] tabular-nums"
            >
              {t}
            </text>
          ))}

          <text
            x={PAD.left + plotW / 2}
            y={height - 2}
            textAnchor="middle"
            className="fill-slate-500 text-[10px]"
          >
            bits per dimension
          </text>

          <g clipPath={`url(#${clipId})`}>
            {series.map((s, i) => {
              const color = s.emphasis ? "var(--series-mine)" : `var(--series-${(i % SLOTS) + 1})`;
              const shape = s.emphasis ? "circle" : SHAPES[i % SHAPES.length];
              // Dim the rest while one series is focused; several families sit
              // within 0.02 recall of each other, so this is often the only way
              // to follow a single line.
              const dimmed = focused !== null && focused !== s.name;
              const path = s.points
                .map((p, j) => `${j === 0 ? "M" : "L"}${x(p.bits)},${y(p.recall)}`)
                .join(" ");
              return (
                <g key={s.name} opacity={dimmed ? 0.18 : 1}>
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={s.emphasis ? 3 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {s.points.map((p) => (
                    <g
                      key={`${s.name}-${p.bits}`}
                      onMouseEnter={() =>
                        setHover({
                          x: x(p.bits),
                          y: y(p.recall),
                          series: p.label ?? s.name,
                          bits: p.bits,
                          recall: p.recall,
                        })
                      }
                    >
                      {/* An invisible disc widens the hit target past the mark. */}
                      <circle cx={x(p.bits)} cy={y(p.recall)} r={11} fill="transparent" />
                      <Marker
                        shape={shape}
                        cx={x(p.bits)}
                        cy={y(p.recall)}
                        r={s.emphasis ? 5.5 : 4}
                        fill={color}
                      />
                    </g>
                  ))}
                </g>
              );
            })}
          </g>

          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x}
                x2={hover.x}
                y1={PAD.top}
                y2={PAD.top + plotH}
                className="stroke-slate-300"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={hover.x} cy={hover.y} r={7} fill="none" className="stroke-slate-400" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      </div>

      {hover && (
        <p className="mt-1 text-xs text-slate-600">
          <span className="font-medium">{hover.series}</span>
          <span className="ml-2 tabular-nums text-slate-500">
            {hover.bits.toFixed(2)} bits/dim · recall@10 {hover.recall.toFixed(3)}
          </span>
        </p>
      )}

      {/* Identity is never colour alone: every series is named here. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s, i) => (
          <li
            key={s.name}
            onMouseEnter={() => setFocused(s.name)}
            onMouseLeave={() => setFocused(null)}
            className="flex cursor-default items-center gap-1.5 text-xs text-slate-600"
          >
            <svg width={13} height={13} aria-hidden className="shrink-0 overflow-visible">
              <Marker
                shape={s.emphasis ? "circle" : SHAPES[i % SHAPES.length]}
                cx={6.5}
                cy={6.5}
                r={s.emphasis ? 5 : 4.5}
                fill={s.emphasis ? "var(--series-mine)" : `var(--series-${(i % SLOTS) + 1})`}
              />
            </svg>
            <span className={s.emphasis ? "font-medium text-slate-900" : undefined}>{s.name}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Round tick values spanning `lo..hi`, at most `count` of them. */
function ticks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
    out.push(Number(t.toFixed(6)));
  }
  return out;
}
