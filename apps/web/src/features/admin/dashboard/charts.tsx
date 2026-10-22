'use client';

import { formatVnd } from '@nona/contracts';
import { useId, useState } from 'react';
import { shortVnd } from '@/lib/short-vnd';

/** Round the axis maximum up to a "nice" number so gridlines read well. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface BarPoint {
  label: string;
  value: number;
  /** Secondary text for the tooltip line (e.g. "12 đơn"). */
  hint?: string;
}

/** Vertical bar chart with gridlines, a value axis and a hover read-out. */
export function BarChart({
  data,
  format = shortVnd,
  full = formatVnd,
  height = 240,
  highlightLast = true,
}: {
  data: BarPoint[];
  format?: (n: number) => string;
  full?: (n: number) => string;
  height?: number;
  highlightLast?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  const W = 720;
  const pad = { l: 46, r: 10, t: 14, b: 28 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / Math.max(data.length, 1);
  const bw = Math.min(34, slot * 0.64);
  const every = Math.ceil(data.length / 12);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const active = hover ?? (highlightLast ? data.length - 1 : null);
  const point = active === null ? null : data[active];

  return (
    <div className="chart">
      <div className="chart-readout" aria-live="polite">
        {point ? (
          <>
            <strong>{full(point.value)}</strong>
            <span>
              {point.label}
              {point.hint ? ` · ${point.hint}` : ''}
            </span>
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Biểu đồ cột" className="chart-svg">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2f6b46" />
            <stop offset="1" stopColor="#1f3d2b" />
          </linearGradient>
          <linearGradient id={`h${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e3b865" />
            <stop offset="1" stopColor="#c8923a" />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = pad.t + ih - t * ih;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="chart-grid" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" className="chart-axis">
                {format(Math.round(max * t))}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * ih;
          const x = pad.l + i * slot + (slot - bw) / 2;
          const on = i === active;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.label}: ${full(d.value)}`}
            >
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              <rect
                x={x}
                y={pad.t + ih - Math.max(h, d.value > 0 ? 2 : 0)}
                width={bw}
                height={Math.max(h, d.value > 0 ? 2 : 0)}
                rx={Math.min(6, bw / 3)}
                fill={on ? `url(#h${id})` : `url(#g${id})`}
                opacity={active !== null && !on ? 0.82 : 1}
              />
              {i % every === 0 && (
                <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="chart-axis">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Smooth area/line chart for counts over time. */
export function AreaChart({
  data,
  height = 200,
  unit = '',
}: {
  data: BarPoint[];
  height?: number;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, '');
  const W = 720;
  const pad = { l: 34, r: 12, t: 16, b: 28 };
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const step = data.length > 1 ? iw / (data.length - 1) : 0;
  const xy = (i: number, v: number) => [pad.l + i * step, pad.t + ih - (v / max) * ih] as const;
  const line = data.map((d, i) => xy(i, d.value).join(',')).join(' L');
  const area = `M${pad.l},${pad.t + ih} L${line} L${pad.l + (data.length - 1) * step},${pad.t + ih} Z`;
  const every = Math.ceil(data.length / 8);
  const active = hover ?? data.length - 1;
  const point = data[active];
  return (
    <div className="chart">
      <div className="chart-readout" aria-live="polite">
        {point && (
          <>
            <strong>
              {point.value} {unit}
            </strong>
            <span>{point.label}</span>
          </>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label="Biểu đồ vùng"
        className="chart-svg"
      >
        <defs>
          <linearGradient id={`a${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b5442a" stopOpacity="0.32" />
            <stop offset="1" stopColor="#b5442a" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => {
          const y = pad.t + ih - t * ih;
          return (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="chart-grid" />
              <text x={pad.l - 8} y={y + 4} textAnchor="end" className="chart-axis">
                {Math.round(max * t)}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#a${id})`} />
        <path
          d={`M${line}`}
          fill="none"
          stroke="#b5442a"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {data.map((d, i) => {
          const [x, y] = xy(i, d.value);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={x - step / 2}
                y={pad.t}
                width={Math.max(step, 8)}
                height={ih}
                fill="transparent"
              />
              {i === active && (
                <>
                  <line x1={x} x2={x} y1={pad.t} y2={pad.t + ih} className="chart-cursor" />
                  <circle cx={x} cy={y} r="5" fill="#fff" stroke="#b5442a" strokeWidth="2.5" />
                </>
              )}
              {i % every === 0 && (
                <text x={x} y={height - 8} textAnchor="middle" className="chart-axis">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/** Donut with a centre total and a legend. */
export function Donut({ slices, centre }: { slices: Slice[]; centre: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label="Biểu đồ tròn" width="160" height="160">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#efe7d2" strokeWidth="22" />
        {total > 0 &&
          slices.map((s) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth="22"
                strokeDasharray={`${Math.max(len - 2, 0)} ${C}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 80 80)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="80" y="78" textAnchor="middle" className="donut-total">
          {total}
        </text>
        <text x="80" y="98" textAnchor="middle" className="donut-caption">
          {centre}
        </text>
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </li>
        ))}
        {slices.length === 0 && <li className="legend-empty">Chưa có dữ liệu</li>}
      </ul>
    </div>
  );
}

/** Tiny trend line for KPI cards. */
export function Sparkline({ values, color = '#1f3d2b' }: { values: number[]; color?: string }) {
  const W = 120;
  const H = 36;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${i * step},${H - 3 - (v / max) * (H - 8)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal ranked bars. */
export function HBars({
  rows,
}: {
  rows: { label: string; value: number; text: string; sub?: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="hbars">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="hbars-head">
            <span>
              <b>{i + 1}</b> {r.label}
            </span>
            <strong>{r.text}</strong>
          </div>
          <div className="hbars-track">
            <div
              className="hbars-fill"
              style={{ width: `${Math.max((r.value / max) * 100, 3)}%` }}
            />
          </div>
          {r.sub && <small>{r.sub}</small>}
        </li>
      ))}
      {rows.length === 0 && <li className="legend-empty">Chưa có dữ liệu</li>}
    </ol>
  );
}
